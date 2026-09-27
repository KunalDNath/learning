/** Syntax Studio shared storage. Deploy as a web app that executes as you. */
function doGet(e) {
  const action = (e.parameter.action || 'state').toLowerCase();
  let result;
  try {
    if (action === 'state') result = { ok: true, state: readState_() };
    else if (action === 'file') result = { ok: true, file: readFile_(e.parameter.id) };
    else throw new Error('Unknown action');
  } catch (error) { result = { ok: false, error: error.message }; }
  const body = JSON.stringify(result).replace(/</g, '\\u003c');
  const callback = String(e.parameter.callback || '');
  if (callback && /^[A-Za-z_$][\w.$]*$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + body + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let result;
  try {
    const input = JSON.parse((e.parameter && e.parameter.payload) || (e.postData && e.postData.contents) || '{}');
    if (!constantTimeEqual_(String(input.password || ''), PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD') || '')) throw new Error('Invalid admin password');
    if (input.action === 'save') {
      const state = input.state || {};
      for (const file of (input.files || [])) saveFile_(file);
      writeState_(state);
      result = { ok: true };
    } else if (input.action === 'login') result = { ok: true };
    else throw new Error('Unknown action');
  } catch (error) { result = { ok: false, error: error.message }; }
  const message = JSON.stringify({ type: 'syntax-studio-drive', ...result }).replace(/</g, '\\u003c');
  return HtmlService.createHtmlOutput('<!doctype html><script>parent.postMessage(' + message + ', "*");</script>')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function readState_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('STATE_FILE_ID');
  if (!id) return { assignments: [], examConfig: null };
  return JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString() || '{}');
}

function writeState_(state) {
  const props = PropertiesService.getScriptProperties();
  let file = props.getProperty('STATE_FILE_ID') ? DriveApp.getFileById(props.getProperty('STATE_FILE_ID')) : null;
  if (!file) {
    const folder = getFolder_();
    file = folder.createFile('course-data.json', '{}', MimeType.PLAIN_TEXT);
    props.setProperty('STATE_FILE_ID', file.getId());
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  }
  file.setContent(JSON.stringify(state));
  const liveIds = new Set((state.assignments || []).map(item => item.questionPdf && item.questionPdf.id).filter(Boolean));
  for (const [key, driveId] of Object.entries(props.getProperties())) {
    if (!key.startsWith('PDF_') || liveIds.has(key.slice(4))) continue;
    try { DriveApp.getFileById(driveId).setTrashed(true); } catch (_) {}
    props.deleteProperty(key);
  }
}

function saveFile_(item) {
  if (!item || !item.id || !item.data) return;
  const props = PropertiesService.getScriptProperties();
  const key = 'PDF_' + item.id;
  const oldId = props.getProperty(key);
  if (oldId) { try { DriveApp.getFileById(oldId).setTrashed(true); } catch (_) {} }
  const bytes = Utilities.base64Decode(item.data);
  const blob = Utilities.newBlob(bytes, item.mimeType || 'application/pdf', item.name || 'question.pdf');
  const file = getFolder_().createFile(blob);
  props.setProperty(key, file.getId());
}

function readFile_(id) {
  if (!id) throw new Error('Missing file ID');
  const driveId = PropertiesService.getScriptProperties().getProperty('PDF_' + id);
  if (!driveId) throw new Error('File not found');
  const blob = DriveApp.getFileById(driveId).getBlob();
  return { name: blob.getName(), mimeType: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

function getFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FOLDER_ID');
  if (id) return DriveApp.getFolderById(id);
  const folder = DriveApp.createFolder('Syntax Studio shared data');
  props.setProperty('FOLDER_ID', folder.getId());
  return folder;
}

function constantTimeEqual_(a, b) {
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
