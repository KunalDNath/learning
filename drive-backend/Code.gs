/** Syntax Studio shared storage. Deploy as a web app that executes as you. */
function doGet(e) {
  const action = (e.parameter.action || 'state').toLowerCase();
  let result;
  try {
    if (action === 'state') {
      const state = readState_();
      result = { ok: true, state: { assignments: state.assignments || [], examConfig: state.examConfig || null } };
    }
    else if (action === 'file') result = { ok: true, file: readFile_(e.parameter.id) };
    else if (action === 'receipt') {
      const cache = CacheService.getScriptCache();
      const key = 'receipt_' + String(e.parameter.probe || '');
      const receipt = cache.get(key);
      if (receipt) cache.remove(key);
      result = { ok: true, receipt: receipt ? JSON.parse(receipt) : null };
    }
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
  let input = {};
  try {
    input = JSON.parse((e.parameter && e.parameter.payload) || (e.postData && e.postData.contents) || '{}');
    if (input.action === 'submit') {
      result = { ok: true, submission: saveSubmission_(input) };
    } else {
    if (!constantTimeEqual_(String(input.password || ''), PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD') || '')) throw new Error('Invalid admin password');
    if (input.action === 'save') {
      const state = input.state || {};
      for (const file of (input.files || [])) saveFile_(file);
      state.submissions = readState_().submissions || {};
      writeState_(state);
      result = { ok: true };
    } else if (input.action === 'getSubmissions') result = { ok: true, submissions: readState_().submissions || {} };
    else if (input.action === 'login') result = { ok: true };
    else throw new Error('Unknown action');
    }
  } catch (error) { result = { ok: false, error: error.message }; }
  if (input.probe) CacheService.getScriptCache().put('receipt_' + input.probe, JSON.stringify(result), 60);
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function readState_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('STATE_FILE_ID');
  if (!id) return { assignments: [], examConfig: null };
  return JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString() || '{}');
}

function writeState_(state) {
  const props = PropertiesService.getScriptProperties();
  const assignmentIds = new Set((state.assignments || []).map(item => item.id));
  state.submissions = Object.fromEntries(Object.entries(state.submissions || {}).filter(([id]) => assignmentIds.has(id)));
  let file = props.getProperty('STATE_FILE_ID') ? DriveApp.getFileById(props.getProperty('STATE_FILE_ID')) : null;
  if (!file) {
    const folder = getFolder_();
    file = folder.createFile('course-data.json', '{}', MimeType.PLAIN_TEXT);
    props.setProperty('STATE_FILE_ID', file.getId());
  }
  try { file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.VIEW); } catch (_) {}
  file.setContent(JSON.stringify(state));
  const liveIds = new Set((state.assignments || []).map(item => item.questionPdf && item.questionPdf.id).filter(Boolean));
  for (const question of (state.examConfig && state.examConfig.questions) || []) {
    if (question.image && question.image.id) liveIds.add(question.image.id);
  }
  const liveSubmissionIds = new Set(Object.values(state.submissions || {}).map(item => item.attachmentId).filter(Boolean));
  for (const [key, driveId] of Object.entries(props.getProperties())) {
    const isQuestion = key.startsWith('PDF_'), isSubmission = key.startsWith('SUB_');
    if ((!isQuestion && !isSubmission) || (isQuestion && liveIds.has(key.slice(4))) || (isSubmission && liveSubmissionIds.has(key.slice(4)))) continue;
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

function saveSubmission_(input) {
  const assignmentId = String(input.assignmentId || '');
  if (!/^[\w-]{1,120}$/.test(assignmentId)) throw new Error('Invalid assignment');
  const state = readState_();
  const assignment = (state.assignments || []).find(item => item.id === assignmentId);
  if (!assignment) throw new Error('Assignment not found');
  if (assignment.locked || (assignment.due && Date.now() > new Date(assignment.due).getTime())) throw new Error('The submission deadline has passed.');
  const text = String(input.text || '').trim();
  const old = (state.submissions || {})[assignmentId];
  let attachmentId = '';
  if (input.data) {
    const mimeType = String(input.mimeType || '');
    if (!['application/pdf', 'image/png', 'image/jpeg'].includes(mimeType)) throw new Error('Answer must be a PDF, PNG, or JPG.');
    const bytes = Utilities.base64Decode(input.data);
    if (bytes.length > 5 * 1024 * 1024) throw new Error('Answer attachment exceeds 5 MB.');
    attachmentId = Utilities.getUuid();
    const blob = Utilities.newBlob(bytes, mimeType, String(input.name || 'answer'));
    const file = getFolder_().createFile(blob);
    PropertiesService.getScriptProperties().setProperty('SUB_' + attachmentId, file.getId());
  }
  if (!text && !attachmentId) throw new Error('Add written work or upload a file.');
  if (old && old.attachmentId && old.attachmentId !== attachmentId) trashSubmissionFile_(old.attachmentId);
  state.submissions = state.submissions || {};
  state.submissions[assignmentId] = {
    assignmentId,
    text,
    name: String(input.name || 'Written response'),
    mimeType: String(input.mimeType || ''),
    attachmentId,
    submittedAt: Date.now()
  };
  writeState_(state);
  return { assignmentId, submittedAt: state.submissions[assignmentId].submittedAt };
}

function trashSubmissionFile_(attachmentId) {
  const props = PropertiesService.getScriptProperties(), key = 'SUB_' + attachmentId, id = props.getProperty(key);
  if (id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (_) {} props.deleteProperty(key); }
}

function readFile_(id) {
  if (!id) throw new Error('Missing file ID');
  const props = PropertiesService.getScriptProperties();
  const driveId = props.getProperty('PDF_' + id) || props.getProperty('SUB_' + id);
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
