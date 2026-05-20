# Quick Start Guide - Leave Management System

## 🚀 Start Server (Localhost)

```bash
npm start
```
Server runs on: **http://localhost:3000**

## 🧪 Quick Tests

### 1. Health Check
```bash
curl http://localhost:3000/health
# Expected: {"success":true,"message":"OK"}
```

### 2. Login
```bash
curl -X POST http://localhost:3000/login \
  -H "Content-Type: application/json" \
  -d '{"email":"himanshu.data.acc@gmail.com","password":"1234"}'
# Expected: {"success":true,"message":"Login successful","token":"..."}
```

### 3. View in Browser
- **Leave Form**: http://localhost:3000/index.html
- **Admin Panel**: http://localhost:3000/admin.html

## 📋 What Works Now

✅ Server running  
✅ Authentication  
✅ User interface  
✅ API endpoints  
✅ All business logic  

## ⏳ What's Pending

⏳ Google Sheets connection (need to deploy Google Apps Script)

## 🔧 To Complete Integration

1. Open: https://drive.google.com
2. Create new Google Sheet
3. Add sheet tab "leaves" with columns: ID, Name, Employee ID, Start Date, End Date, Batch, Reason, Email, Status, Created At
4. Go to Extensions → Apps Script
5. Copy code from `gas_script_fixed.gs`
6. Deploy as "Web app" with "Who has access: Anyone"
7. Copy deployment URL
8. Update `.env`: `GOOGLE_SCRIPT_URL=https://script.google.com/macros/s/AKfycbznKWs4LkM4NnPfiPbsvIPLZBZVNrHyRMekGq5DDi4qPYO0ghPge5rwtRM651DslJM__g/exec`
9. Restart server

See `GOOGLE_SHEETS_SETUP.md` for detailed steps.

## 📞 Support

- **Setup Issues**: See `GOOGLE_SHEETS_SETUP.md`
- **Testing**: See `TEST_LOCALLY.md`
- **Full Details**: See `INTEGRATION_SUMMARY.md`
