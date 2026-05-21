# Storage Error Fix - Google Apps Script Deployment

## Problem
The storage error was happening because the Google Apps Script was not properly handling auto-generated IDs when new leave records were being added.

## Solution
The Apps Script needed to be completely updated to handle modern actions like `leave.create`, `leaves`, and `admin.login`. 
If you are seeing **"Storage Error: Unknown action"**, it means Google is still running an old version of your script! Google Apps Script does not auto-update when you click "Save".

## How to Deploy the Fixed Script

### Step 1: Copy the Fixed Code
The completely fixed script is inside `gas_script_fixed.gs` in your project folder.

### Step 2: Update Google Apps Script
1. Go to your Google Sheet > Extensions > Apps Script.
2. Replace the entire content of `Code.gs` with the code from your local `gas_script_fixed.gs` file.
3. Click the **Save** icon (Ctrl+S / Cmd+S).

### Step 3: Save and Deploy
1. This is the most important step: Go to **Deploy** → **New Deployment**. (Do NOT just click save)
3. Select **Type** → **Web app**
4. Add a description like "V2 Action fix"
5. Set **Execute as** → Your Google account
6. Set **Who has access** → "Anyone"
6. Click **Deploy**
7. Copy the new Deployment ID/URL

### Step 4: Update Environment Variable
1. Open `.env` file in your project
2. Update `GOOGLE_SCRIPT_URL` with the new deployment URL from step 7

### Step 5: Test
1. Run `npm start`
2. Fill the form on http://localhost:3000
3. Submit a leave application
4. Check your Google Sheet - the record should be saved with an auto-generated ID

## Key Changes Made

### Before:
```javascript
const newRow = headers.map(header => record[header] || "");
return { success: true, message: "Record added successfully", id: record.id };
```

### After:
```javascript
// Generate auto-incrementing ID
let maxId = 0;
for (let i = 1; i < allData.length; i++) {
  const id = parseInt(allData[i][0], 10);
  if (!isNaN(id) && id > maxId) {
    maxId = id;
  }
}
const newId = maxId + 1;

// Build new row with generated ID
const newRow = headers.map((header, idx) => {
  if (idx === 0) return newId; // First column is ID
  return record[header] || "";
});
return { success: true, message: "Record added successfully", id: newId };
```

## Also Improved:
- Added support for both 'id' and 'ID' column names in `handleRead()`
- Better error handling for empty sheets
- Proper ID generation that works with your existing data

## Troubleshooting

If you still see "Storage error":

1. **Check .env file** - Ensure GOOGLE_SCRIPT_URL is correctly set
2. **Verify Google Sheets** - Make sure your Google Sheet has columns matching what the server sends:
   - ID, Name, Employee ID, Start Date, End Date, Batch, Reason, Email, Status
3. **Check Google Script Logs** - In Google Apps Script editor, click View → Logs to see error details
4. **Verify Permissions** - Ensure your Google Sheet is accessible and the service account has write access
5. **Re-deploy** - After updating, make sure you deployed the new version

## Local Testing (No Google Sheets)

If you want to test without Google Sheets temporarily:
1. Comment out `GOOGLE_SCRIPT_URL` in `.env`
2. The app will show "Storage Error: No database configured" 
3. Configure a local database solution (SQLite, JSON file, etc.)

## Questions?
Check the error logs in your browser console (F12) and Google Apps Script logs for detailed error messages.
