/**
 * Universal (GET/POST) Google Apps Script backend
 */
const LEAVES_SHEET = 'leaves';

function doGet(e) { return route_(e); }
function doPost(e) { return route_(e); }

function route_(e) {
  try {
    const parameter = e.parameter || {};
    const action = parameter.action || '';
    
    // Support payload from both POST body and GET query params
    let payload = {};
    if (e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else if (parameter.payload) {
      payload = JSON.parse(parameter.payload);
    }

    if (action === 'health') return json_({ ok: true, message: 'Leaves API running' });
    if (action === 'leaves') return json_({ ok: true, data: getLeaves_() });
    if (action === 'leave.create') return json_(createLeave_(payload));
    if (action === 'leave.status.update') return json_(updateLeaveStatus_(payload));

    return json_({ ok: false, error: 'Invalid action: ' + action }, 400);
  } catch (err) {
    return json_({ ok: false, error: err.message }, 500);
  }
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  return JSON.parse(e.postData.contents);
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(LEAVES_SHEET);
  if (!sh) throw new Error('Sheet not found: ' + LEAVES_SHEET);
  return sh;
}

function getLeaves_() {
  const sh = sheet_();
  const values = sh.getDataRange().getValues();
  if (!values || values.length === 0) return [];

  const headers = values[0];
  return values.slice(1).filter(function (row) {
    return row.some(function (cell) { return String(cell) !== ''; });
  }).map(function (row) {
    const obj = {};
    headers.forEach(function (header, i) {
      obj[String(header)] = row[i];
    });
    return obj;
  });
}

function nextId_() {
  const rows = getLeaves_();
  const maxId = rows.reduce(function (m, row) {
    const id = Number(row.ID || 0);
    return id > m ? id : m;
  }, 0);
  return maxId + 1;
}

function createLeave_(payload) {
  const sh = sheet_();
  const id = nextId_();

  sh.appendRow([
    id,
    payload.name || '',
    payload.employeeId || '',
    payload.startDate || '',
    payload.endDate || '',
    payload.batch || '',
    payload.reason || '',
    payload.email || '',
    payload.status || 'Pending',
    new Date().toISOString()
  ]);

  return { ok: true, id: id };
}

function updateLeaveStatus_(payload) {
  const id = Number(payload.id || 0);
  const status = String(payload.status || '').trim();
  if (!id || !status) throw new Error('id and status are required');

  const sh = sheet_();
  const values = sh.getDataRange().getValues();
  if (!values.length) throw new Error('leaves sheet is empty');

  const headers = values[0];
  const idCol = headers.indexOf('ID') + 1;
  const statusCol = headers.indexOf('Status') + 1;
  if (!idCol || !statusCol) throw new Error('ID/Status columns not found');

  for (var r = 2; r <= values.length; r++) {
    if (Number(values[r - 1][idCol - 1]) === id) {
      sh.getRange(r, statusCol).setValue(status);
      return { ok: true, id: id, status: status };
    }
  }

  throw new Error('Leave ID not found: ' + id);
}

function json_(data, code) {
  return ContentService
    .createTextOutput(JSON.stringify({ code: code || 200, ...data }))
    .setMimeType(ContentService.MimeType.JSON);
}
