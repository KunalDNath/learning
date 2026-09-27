const API_ROOT = "https://api.github.com";
const DATA_PATH = "course-state.json";
const TOKEN_LIFETIME_SECONDS = 60 * 60 * 24 * 30;

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(purgeExpiredPdfs(env));
  },
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (origin !== env.ALLOWED_ORIGIN) return json({ error: "Origin not allowed" }, 403);
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      const url = new URL(request.url);
      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({ ok: true, configured: Boolean(env.GITHUB_TOKEN && env.ADMIN_PASSWORD && env.SESSION_SECRET && env.DATA_REPO) }, 200, cors);
      }
      if (url.pathname === "/api/admin/login" && request.method === "POST") {
        const { password } = await request.json();
        if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) return json({ error: "Invalid admin password" }, 401, cors);
        return json({ token: await createToken(env.SESSION_SECRET) }, 200, cors);
      }
      if (url.pathname === "/api/state" && request.method === "GET") {
        const state = await readState(env);
        return json({ assignments: publicAssignments(state.assignments), examConfig: publicExamConfig(state.examConfig) }, 200, cors);
      }
      if (url.pathname === "/api/admin/state" && request.method === "GET") {
        await requireAdmin(request, env);
        const state = await readState(env);
        return json({ assignments: publicAssignments(state.assignments), examConfig: state.examConfig || null }, 200, cors);
      }
      if (url.pathname === "/api/admin/assignments" && request.method === "PUT") {
        await requireAdmin(request, env);
        const body = await request.json();
        if (!Array.isArray(body.assignments)) return json({ error: "assignments must be an array" }, 400, cors);
        const state = await readState(env);
        state.assignments = body.assignments;
        await writeState(env, state);
        return json({ ok: true }, 200, cors);
      }
      if (url.pathname.startsWith("/api/admin/files/") && request.method === "PUT") {
        await requireAdmin(request, env);
        if (!env.PDFS) return json({ error: "PDF storage is not configured" }, 503, cors);
        const id = decodeURIComponent(url.pathname.slice("/api/admin/files/".length));
        const length = Number(request.headers.get("Content-Length") || 0);
        if (!/^[\w-]{1,120}$/.test(id) || length > 5 * 1024 * 1024) return json({ error: "Invalid PDF or file exceeds 5 MB" }, 413, cors);
        const uploadedAt = Date.now();
        await env.PDFS.put(id, request.body, { httpMetadata: { contentType: "application/pdf" }, customMetadata: { uploadedAt: String(uploadedAt), expiresAt: String(uploadedAt + 10 * 24 * 60 * 60 * 1000) } });
        return json({ ok: true }, 200, cors);
      }
      if (url.pathname === "/api/admin/exam-config" && request.method === "PUT") {
        await requireAdmin(request, env);
        const body = await request.json();
        stateCheck(body.examConfig);
        const state = await readState(env);
        state.examConfig = body.examConfig;
        await writeState(env, state);
        return json({ ok: true }, 200, cors);
      }
      if (url.pathname.startsWith("/api/files/") && request.method === "GET") {
        const id = decodeURIComponent(url.pathname.slice("/api/files/".length));
        const file = await env.PDFS?.get(id);
        if (!file) return json({ error: "File not found or expired" }, 404, cors);
        return new Response(file.body, { headers: { ...cors, "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
      }
      return json({ error: "Not found" }, 404, cors);
    } catch (error) {
      const status = error.status || 500;
      return json({ error: status === 500 ? "Storage request failed" : error.message }, status, cors);
    }
  }
};

async function purgeExpiredPdfs(env) {
  if (!env.PDFS) return;
  let cursor;
  do {
    const page = await env.PDFS.list({ ...(cursor ? { cursor } : {}), include: ["customMetadata"], limit: 1000 });
    const expired = page.objects.filter(object => Number(object.customMetadata?.expiresAt || 0) <= Date.now()).map(object => object.key);
    if (expired.length) await env.PDFS.delete(expired);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

function stateCheck(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.questions)) {
    const error = new Error("examConfig is invalid");
    error.status = 400;
    throw error;
  }
}

function publicAssignments(assignments = []) {
  return assignments.map(item => ({
    ...item,
    questionPdf: item.questionPdf ? { id: item.questionPdf.id, name: item.questionPdf.name } : null
  }));
}

function publicExamConfig(config) {
  return config || null;
}

async function requireAdmin(request, env) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!(await verifyToken(token, env.SESSION_SECRET))) {
    const error = new Error("Admin login expired");
    error.status = 401;
    throw error;
  }
}

async function readState(env) {
  const [owner, repo] = env.DATA_REPO.split("/");
  if (!owner || !repo || !env.GITHUB_TOKEN) throw new Error("Worker storage is not configured");
  const endpoint = `${API_ROOT}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${DATA_PATH}?ref=${encodeURIComponent(env.DATA_BRANCH || "main")}`;
  const response = await fetch(endpoint, { headers: githubHeaders(env) });
  if (response.status === 404) return { assignments: [], examConfig: null };
  if (!response.ok) throw new Error(`GitHub read failed (${response.status})`);
  const file = await response.json();
  const decoded = new TextDecoder().decode(decodeBase64(file.content.replace(/\n/g, "")));
  return { ...JSON.parse(decoded), sha: file.sha };
}

async function writeState(env, state) {
  const [owner, repo] = env.DATA_REPO.split("/");
  const branch = env.DATA_BRANCH || "main";
  const endpoint = `${API_ROOT}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${DATA_PATH}`;
  const current = await fetch(`${endpoint}?ref=${encodeURIComponent(branch)}`, { headers: githubHeaders(env) });
  const sha = current.ok ? (await current.json()).sha : undefined;
  const cleanState = { assignments: (state.assignments || []).map(item => ({ ...item, questionPdf: item.questionPdf ? { id: item.questionPdf.id, name: item.questionPdf.name, uploadedAt: item.questionPdf.uploadedAt } : null })), examConfig: state.examConfig || null };
  const content = encodeBase64(new TextEncoder().encode(JSON.stringify(cleanState, null, 2)));
  const response = await fetch(endpoint, {
    method: "PUT",
    headers: { ...githubHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Update Syntax Studio course data", content, branch, ...(sha ? { sha } : {}) })
  });
  if (!response.ok) {
    const error = new Error(response.status === 409 || response.status === 422 ? "GitHub data changed at the same time; reload and retry" : `GitHub write failed (${response.status})`);
    error.status = response.status === 409 || response.status === 422 ? 409 : 502;
    throw error;
  }
}

function githubHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Syntax-Studio-Cloudflare-Worker"
  };
}

async function createToken(secret) {
  const expires = Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS;
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ role: "admin", exp: expires })));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return `${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function verifyToken(token, secret) {
  if (!token || !secret) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", key, base64UrlDecode(signature), new TextEncoder().encode(payload));
    const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
    return valid && claims.role === "admin" && claims.exp > Math.floor(Date.now() / 1000);
  } catch { return false; }
}

function encodeBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function decodeBase64(value) { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }
function base64UrlEncode(bytes) { return encodeBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function base64UrlDecode(value) { const padded = value.replace(/-/g, "+").replace(/_/g, "/"); return decodeBase64(padded + "=".repeat((4 - padded.length % 4) % 4)); }
function json(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders } });
}
