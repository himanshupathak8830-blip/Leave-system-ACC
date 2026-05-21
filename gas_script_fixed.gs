function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ ok: false, error: "No data" });
    }
    const params = JSON.parse(e.postData.contents);
    const action = params.action;
    const payload = params.payload || {};

    if (action === "health") return jsonResponse({ ok: true });
    if (action === "leave.create") return createLeave(payload);
    if (action === "leaves") return getLeaves();
    if (action === "leave.status.update") return updateLeaveStatus(payload);
    if (action === "admin.login") return getAdminByEmail(payload);

    return jsonResponse({ ok: false, error: "Unknown action: " + action });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.toString() });
  }
}

function getLeavesSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("leaves");
  if (!sheet) throw new Error("Sheet 'leaves' not found. Please create it.");
  return sheet;
}

function getLeaves() {
  const sheet = getLeavesSheet();
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return jsonResponse({ ok: true, data: [] });

  const headers = data[0].map(h => String(h).trim().toLowerCase());
  const rows = [];

  for (let i = 1; i < data.length; i++) {
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = data[i][j];
    }
    rows.push({
      id: obj['id'] || obj['i.d.'] || '',
      name: obj['name'] || '',
      employeeId: obj['employee id'] || obj['employeeid'] || '',
      startDate: obj['start date'] || obj['startdate'] || '',
      endDate: obj['end date'] || obj['enddate'] || '',
      batch: obj['batch'] || obj['team'] || '',
      reason: obj['reason'] || '',
      email: obj['email'] || '',
      status: obj['status'] || '',
      createdAt: obj['created at'] || obj['createdat'] || ''
    });
  }
  return jsonResponse({ ok: true, data: rows });
}

function createLeave(payload) {
  const sheet = getLeavesSheet();
  const data = sheet.getDataRange().getValues();
  
  let newId = 1;
  const headers = data.length > 0 ? data[0].map(h => String(h).trim().toLowerCase()) : [];
  
  if (data.length > 1 && headers.length > 0) {
    const idIndex = headers.indexOf("id");
    if (idIndex !== -1) {
      const lastRowId = parseInt(data[data.length - 1][idIndex], 10);
      newId = isNaN(lastRowId) ? data.length : lastRowId + 1;
    } else {
      newId = data.length;
    }
  }

  const createdAt = new Date().toISOString();
  
  const newRow = new Array(headers.length || 10).fill("");
  
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (h === "id") newRow[i] = newId;
    else if (h === "name") newRow[i] = payload.name || "";
    else if (h === "employee id" || h === "employeeid") newRow[i] = payload.employeeId || "";
    else if (h === "start date" || h === "startdate") newRow[i] = payload.startDate || "";
    else if (h === "end date" || h === "enddate") newRow[i] = payload.endDate || "";
    else if (h === "batch") newRow[i] = payload.batch || "";
    else if (h === "reason") newRow[i] = payload.reason || "";
    else if (h === "email") newRow[i] = payload.email || "";
    else if (h === "status") newRow[i] = payload.status || "Pending";
    else if (h === "created at" || h === "createdat") newRow[i] = createdAt;
  }
  
  sheet.appendRow(newRow);
  return jsonResponse({ ok: true, message: "Leave created", id: newId });
}

function updateLeaveStatus(payload) {
  const { id, status } = payload;
  const sheet = getLeavesSheet();
  const data = sheet.getDataRange().getValues();
  
  if (data.length <= 1) return jsonResponse({ ok: false, error: "No leaves found" });
  
  const headers = data[0].map(h => String(h).trim().toLowerCase());
  const idIndex = headers.indexOf("id");
  const statusIndex = headers.indexOf("status");
  
  if (idIndex === -1 || statusIndex === -1) {
    return jsonResponse({ ok: false, error: "Columns 'ID' or 'Status' missing in sheet" });
  }
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idIndex]) === String(id)) {
      sheet.getRange(i + 1, statusIndex + 1).setValue(status);
      return jsonResponse({ ok: true, message: "Status updated" });
    }
  }
  
  return jsonResponse({ ok: false, error: "Leave ID not found" });
}

function getAdminByEmail(payload) {
  const email = payload.email;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("admin");
  if (!sheet) {
    return jsonResponse({ ok: false, error: "Sheet 'admin' not found. Please create it." });
  }

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return jsonResponse({ ok: false, error: "No admins found in admin sheet." });

  const headers = data[0].map(h => String(h).trim().toLowerCase());
  const emailIndex = headers.indexOf("email");
  const passwordIndex = headers.indexOf("password");

  if (emailIndex === -1 || passwordIndex === -1) {
    return jsonResponse({ ok: false, error: "Columns 'email' or 'password' not found in admin sheet." });
  }

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailIndex]).toLowerCase() === String(email).toLowerCase()) {
      const adminData = {
        email: data[i][emailIndex],
        password: data[i][passwordIndex]
      };
      return jsonResponse({ ok: true, data: adminData });
    }
  }

  return jsonResponse({ ok: false, error: "Admin email not found" });
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}