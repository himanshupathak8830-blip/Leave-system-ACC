# Google Sheets Integration Setup Guide

## Current Status
✅ **Server**: Running successfully on localhost:3000
✅ **Health Check**: Working
✅ **Login System**: Working with admin credentials
⚠️  **Google Sheets Integration**: Requires proper deployment setup

## Project Architecture

### Technology Stack
- **Frontend**: HTML/JavaScript (in `/public`)
- **Backend**: Node.js + Express
- **Database**: Google Sheets (via Google Apps Script)
- **Email**: Nodemailer (Gmail SMTP)

### Key Files
- `server.js` - Main Express server with authentication and leave management endpoints
- `lib/gasClient.js` - Client for communicating with Google Apps Script
- `gas_script_fixed.gs` - Google Apps Script that manages Google Sheets
- `public/index.html` - Leave application form
- `public/admin.html` - Admin approval panel
- `.env` - Environment variables (credentials and URLs)

## How it Works

1. **User applies for leave** → Form sends data to `/apply-leave` endpoint
2. **Server validates data** → Checks format and required fields
3. **Server sends to Google Sheets** → Via Google Apps Script
4. **Notification email sent** → To HR for review
5. **Admin logs in** → Uses token-based authentication
6. **Admin approves/rejects** → Updates Google Sheets status
7. **Employee gets email** → Notified of decision

## Setup Instructions

### Step 1: Set up Google Apps Script

1. **Open Google Drive** → Go to https://drive.google.com
2. **Create new Google Sheet** → Name it "Leave Management System"
3. **Create a sheet named "leaves"** with columns:
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

4. **Attach Apps Script**:
   - Click "Extensions" → "Apps Script"
   - Replace the code with content from `gas_script_fixed.gs`
   - Click "Deploy" → "New Deployment"
   - Select Type: "Web app"
   - Execute as: (your Google account)
   - Who has access: **"Anyone"** (IMPORTANT!)
   - Click Deploy

5. **Copy the deployment URL** (looks like: `https://script.google.com/macros/s/AKfycb...`)

### Step 2: Configure Environment Variables

Update `.env` file with:
```
GOOGLE_SCRIPT_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
ADMIN_EMAIL=your-email@gmail.com
ADMIN_PASSWORD=your-password
TOKEN_SECRET=your-secret-key
EMAIL_USER=your-gmail@gmail.com
EMAIL_PASS=your-app-password
```

**Note**: For Gmail, use App Passwords (not your regular password)
- Enable 2FA on your Google Account
- Go to https://myaccount.google.com/apppasswords
- Select "Mail" and "Windows Computer"
- Use the generated 16-character password

### Step 3: Run Locally

```bash
npm install
npm start
```

The server will run on `http://localhost:3000`

### Step 4: Test the Integration

#### Test Health:
```bash
curl http://localhost:3000/health
```
Expected: `{"success":true,"message":"OK"}`

#### Test Login:
```bash
curl -X POST http://localhost:3000/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your-email@gmail.com","password":"your-password"}'
```

#### Test Apply Leave:
```bash
curl -X POST http://localhost:3000/apply-leave \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "employeeId": "ACC-FTDA-2026-001",
    "startDate": "2026-06-01",
    "endDate": "2026-06-05",
    "batch": "Batch-A",
    "reason": "Vacation",
    "email": "john@example.com"
  }'
```

#### Test Get Leaves (Admin Only):
```bash
TOKEN="your-token-from-login"
curl -X GET http://localhost:3000/leaves \
  -H "Authorization: Bearer $TOKEN"
```

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

## API Endpoints

### POST /login
- Request: `{email, password}`
- Response: `{success, token}`
- No auth required

### POST /apply-leave
- Request: `{name, employeeId, startDate, endDate, batch, reason, email}`
- Response: Success message
- No auth required

### GET /leaves
- Response: Array of leave records
- Requires: `Authorization: Bearer <token>` header

### PUT /approve/:id
- Request: Leave ID in URL
- Response: `{success, message}`
- Requires: Admin token

### PUT /reject/:id
- Request: Leave ID in URL
- Response: `{success, message}`
- Requires: Admin token

## Security Features

✅ Rate limiting on login attempts (10 attempts per 15 minutes per IP)
✅ Password hashing with scrypt
✅ Token-based authentication (8-hour expiry)
✅ HMAC signature verification on tokens
✅ CORS enabled
✅ XSS protection headers
✅ Input validation on all endpoints

## Production Deployment

For deploying to production:

1. **Update .env**:
   - Set proper TOKEN_SECRET (generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
   - Update ADMIN_PANEL_URL to production URL
   - Update EMAIL_FROM with your email

2. **Deploy Options**:
   - Railway.com (see DEPLOY_RAILWAY.md)
   - Vercel (see vercel.json)
   - Any Node.js hosting

3. **SSL/HTTPS**: Use in production always

4. **Database**: Google Sheets will handle all data persistence

## Next Steps

1. ✅ Set up Google Sheets and Apps Script
2. ✅ Update .env with your credentials
3. ✅ Run `npm install`
4. ✅ Test with `npm start`
5. ✅ Verify endpoints work
6. ✅ Deploy to production
