# Leave Management System - Complete Documentation

This repository contains the complete frontend and backend for the Leave Management System. The original documentation files have been combined below.

---

# 1. Leave Management System - Google Sheets Integration Summary

## ✅ What's Working Locally

The server is **fully functional** on localhost:3000 with all backend systems ready:

### 1. Health Check ✅
- Endpoint: `GET /health`
- Status: Working
- Response: `{"success": true, "message": "OK"}`

### 2. Authentication System ✅
- Endpoint: `POST /login`
- Status: Working
- Features:
  - Password hashing with scrypt
  - Token-based authentication (8-hour expiry)
  - Rate limiting (10 failed attempts blocked for 15 min)
  - HMAC signature verification

### 3. Frontend (HTML/JavaScript) ✅
- **Leave Application**: `/index.html` - Users can apply for leave
- **Admin Panel**: `/admin.html` - Admins can view and approve/reject leave requests
- Status: All UI files ready and served

### 4. Database Integration Ready ✅
- Google Apps Script prepared (`gas_script_fixed.gs`)
- Node.js client ready (`lib/gasClient.js`)
- API endpoints built and tested
- Status: **Waiting for Google Sheets deployment**

## 🔧 What Needs Google Sheets Setup

The system is designed to use **Google Sheets** as the database. To complete the integration:

### You need to:

1. **Create a Google Sheet** named "Leave Management System"
2. **Create a sheet tab** named "leaves" with columns:
   - A: ID
   - B: Name
   - C: Employee ID
   - D: Start Date
   - E: End Date
   - F: Batch
   - G: Reason
   - H: Email
   - I: Status
   - J: Created At

3. **Deploy Google Apps Script**:
   - Go to Google Sheet → Extensions → Apps Script
   - Paste code from `gas_script_fixed.gs`
   - Deploy as "Web app"
   - Set "Who has access:" to **"Anyone"** (critical!)
   - Copy the deployment URL

4. **Update `.env` file**:
   ```
   GOOGLE_SCRIPT_URL=https://script.google.com/macros/s/AKfycbzmOLvKdOhGJRkcAe_OAI-QWE5w40iZXW_E8oOEtzqXbq7TDD-W1dVFi0Yq3P2b7Q6XaQ/exec
   ```

## 🚀 Current Status Summary

| Component | Status | Notes |
|-----------|--------|-------|
| Node.js Server | ✅ Running | Port 3000 |
| Express Framework | ✅ Ready | CORS enabled |
| Authentication | ✅ Working | Token-based |
| Frontend Forms | ✅ Ready | HTML/JavaScript |
| API Endpoints | ✅ Ready | Fully implemented |
| Google Sheets Client | ✅ Ready | Awaiting deployment |
| Google Apps Script | ✅ Ready | Awaiting deployment |
| Email System | ⚠️ Configured | Needs verification |
| Database (Google Sheets) | ⏳ Pending | Needs setup |

## 📝 API Endpoints Ready

1. `POST /login` - Admin authentication
2. `POST /apply-leave` - Submit leave request
3. `GET /leaves` - View all leave requests (admin)
4. `PUT /approve/:id` - Approve leave (admin)
5. `PUT /reject/:id` - Reject leave (admin)
6. `GET /health` - Health check

## 🔐 Security Features Implemented

- ✅ Password hashing (scrypt)
- ✅ Token-based authentication
- ✅ Rate limiting on login
- ✅ CORS protection
- ✅ Input validation
- ✅ XSS protection headers
- ✅ Timing-safe comparisons

---

# 2. ✅ Google Sheets Integration - SUCCESSFULLY CONFIGURED!

## 🎯 What's Been Done

### ✅ 1. Google Apps Script URL Updated
- **New URL:** `https://script.google.com/macros/s/AKfycbzmOLvKdOhGJRkcAe_OAI-QWE5w40iZXW_E8oOEtzqXbq7TDD-W1dVFi0Yq3P2b7Q6XaQ/exec`
- **Location:** `.env` file
- **Status:** Updated & Ready

### ✅ 2. Google Apps Script Code Created
- **File:** `gas_script.gs`
- **Functions Included:**
  - `doPost()` - Main handler
  - `handleRead()` - Read from sheets
  - `handleWrite()` - Add new records
  - `handleUpdate()` - Update existing records
  - `handleDelete()` - Delete records
  - `handleLogin()` - Admin authentication

### ✅ 3. Server Configured
- **Framework:** Node.js + Express
- **Port:** 3000
- **Google Sheets Integration:** Enabled
- **Email Notifications:** Configured (Gmail SMTP)
- **Admin Authentication:** Token-based

### ✅ 4. Google Sheet Structure
Required 3 sheets with headers:

**Sheet 1: "leaves"**
```
id | name | employeeId | startDate | endDate | batch | reason | email | status | createdAt
```

**Sheet 2: "admin"**
```
id | email | password
```

**Sheet 3: "email_jobs"**
```
id | type | payload | status | attempts | runAt | lastError | createdAt | updatedAt
```

---

# 3. Google Sheets Integration Setup Guide

## How it Works

1. **User applies for leave** → Form sends data to `/apply-leave` endpoint
2. **Server validates data** → Checks format and required fields
3. **Server sends to Google Sheets** → Via Google Apps Script
4. **Notification email sent** → To HR for review
5. **Admin logs in** → Uses token-based authentication
6. **Admin approves/rejects** → Updates Google Sheets status
7. **Employee gets email** → Notified of decision

## Troubleshooting

### "Google Sheets returned an invalid response"
**Cause**: Google Apps Script is not properly deployed or URL is incorrect
**Fix**:
1. Check if script is deployed with "Who has access: Anyone"
2. Verify the GOOGLE_SCRIPT_URL in `.env` is correct and complete
3. Make sure the script URL ends with `/exec`
4. Re-deploy the Apps Script (Create new version)

### "Admin login required"
**Cause**: Missing or invalid authentication token
**Fix**: Make sure to login first and include `Authorization: Bearer <token>` header

### Emails not sending
**Cause**: Invalid Gmail credentials or App Password
**Fix**:
1. Use App Password instead of regular password
2. Enable "Less secure app access" if not using App Password
3. Check EMAIL_USER and EMAIL_PASS in `.env`

---

# 4. ✅ Storage Error - FIXED

## What Was the Problem?

When you were filling user information and submitting leave applications, you were getting a **"Storage error"** because:

1. The Google Apps Script (`gas_script.gs`) was trying to use a non-existent `record.id` field
2. No auto-generated ID was being created for new records
3. This caused the Google Sheets write operation to fail silently

## What Was Fixed?

### ✅ Fixed File: `gas_script.gs`

**The `handleWrite()` function now:**
- Automatically generates sequential IDs (1, 2, 3, etc.)
- Finds the highest existing ID and increments it
- Properly assigns the generated ID to the first column
- Works correctly even if the sheet is empty

## Testing the Fix

After deploying the new script:

```bash
npm start
```

Then visit http://localhost:3000 and:
1. Fill in the form with your details
2. Click "Apply Leave"
3. You should see: **"Leave Applied Successfully"** ✅
4. Check your Google Sheet - the record will be there with an auto-generated ID

---

# 5. Testing the Leave Management System Locally

## Quick Start

### 1. Start the Server
```bash
npm start
```

### 2. Test Health
```bash
curl http://localhost:3000/health
```

### 3. Test Login
```bash
curl -X POST http://localhost:3000/login \
  -H "Content-Type: application/json" \
  -d '{"email":"himanshu.data.acc@gmail.com","password":"1234"}'
```

### 4. Test Leaves (with token)
```bash
TOKEN="<token-from-login>"
curl -X GET http://localhost:3000/leaves \
  -H "Authorization: Bearer $TOKEN"
```

## Browser Testing

- **Leave Form**: http://localhost:3000/index.html
- **Admin Panel**: http://localhost:3000/admin.html
