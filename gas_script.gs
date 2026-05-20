// gas_script.gs - Google Apps Script for Leave Management System
// Deploy as Web App: Anyone can access

function doPost(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const action = e.parameter.action || (e.postData ? JSON.parse(e.postData.contents).action : null);
    
    if (!action) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: "No action specified"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    let result;
    
    switch(action) {
      case "read":
        result = handleRead(e, ss);
        break;
      case "write":
        result = handleWrite(e, ss);
        break;
      case "update":
        result = handleUpdate(e, ss);
        break;
      case "delete":
        result = handleDelete(e, ss);
        break;
      case "login":
        result = handleLogin(e, ss);
        break;
      default:
        result = { success: false, error: "Unknown action" };
    }
    
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(error) {
    Logger.log("Error: " + error.toString());
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function handleRead(e, ss) {
  try {
    const sheetName = e.parameter.sheet || "leaves";
    const sheet = ss.getSheetByName(sheetName);
    
    if (!sheet) {
      return { success: false, error: "Sheet not found: " + sheetName };
    }
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const rows = [];
    
    for (let i = 1; i < data.length; i++) {
      const row = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]] = data[i][j];
      }
      if (row.id) rows.push(row);
    }
    
    return { success: true, data: rows };
  } catch(error) {
    return { success: false, error: error.toString() };
  }
}

function handleWrite(e, ss) {
  try {
    const sheetName = e.parameter.sheet || "leaves";
    const sheet = ss.getSheetByName(sheetName);
    
    if (!sheet) {
      return { success: false, error: "Sheet not found" };
    }
    
    const postData = JSON.parse(e.postData.contents);
    const record = postData.data;
    
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const newRow = headers.map(header => record[header] || "");
    
    sheet.appendRow(newRow);
    
    return { success: true, message: "Record added successfully", id: record.id };
  } catch(error) {
    return { success: false, error: error.toString() };
  }
}

function handleUpdate(e, ss) {
  try {
    const sheetName = e.parameter.sheet || "leaves";
    const sheet = ss.getSheetByName(sheetName);
    
    if (!sheet) {
      return { success: false, error: "Sheet not found" };
    }
    
    const postData = JSON.parse(e.postData.contents);
    const recordId = postData.id;
    const updates = postData.data;
    
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const allData = sheet.getDataRange().getValues();
    
    for (let i = 1; i < allData.length; i++) {
      if (allData[i][0] == recordId) {
        for (let col = 0; col < headers.length; col++) {
          if (updates[headers[col]] !== undefined) {
            sheet.getRange(i + 1, col + 1).setValue(updates[headers[col]]);
          }
        }
        return { success: true, message: "Record updated successfully" };
      }
    }
    
    return { success: false, error: "Record not found" };
  } catch(error) {
    return { success: false, error: error.toString() };
  }
}

function handleDelete(e, ss) {
  try {
    const sheetName = e.parameter.sheet || "leaves";
    const sheet = ss.getSheetByName(sheetName);
    
    if (!sheet) {
      return { success: false, error: "Sheet not found" };
    }
    
    const postData = JSON.parse(e.postData.contents);
    const recordId = postData.id;
    
    const allData = sheet.getDataRange().getValues();
    
    for (let i = 1; i < allData.length; i++) {
      if (allData[i][0] == recordId) {
        sheet.deleteRow(i + 1);
        return { success: true, message: "Record deleted successfully" };
      }
    }
    
    return { success: false, error: "Record not found" };
  } catch(error) {
    return { success: false, error: error.toString() };
  }
}

function handleLogin(e, ss) {
  try {
    const postData = JSON.parse(e.postData.contents);
    const email = postData.email;
    const password = postData.password;
    
    const sheet = ss.getSheetByName("admin");
    if (!sheet) {
      return { success: false, error: "Admin sheet not found" };
    }
    
    const allData = sheet.getDataRange().getValues();
    
    for (let i = 1; i < allData.length; i++) {
      if (allData[i][1] == email && allData[i][2] == password) {
        return { success: true, message: "Login successful", email: email };
      }
    }
    
    return { success: false, error: "Invalid credentials" };
  } catch(error) {
    return { success: false, error: error.toString() };
  }
}
