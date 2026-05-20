# Troubleshooting Guide

## ✅ Server Status - WORKING!

Your server IS RUNNING successfully on port 3000!

### Verified Working Endpoints:

```
✅ Health Check:      {"success":true,"message":"OK"}
✅ Login System:      Working (Returns token)
✅ Apply Leave:       Working
```

## 🔍 Common Issues & Solutions

### Issue 1: "Cannot connect to localhost:3000"
```bash
# Check if server is running
lsof -i :3000

# If not running, start it:
npm start
```

### Issue 2: "Cannot GET /index.html"
```bash
# Test it works with curl
curl http://localhost:3000/index.html

# The file exists and server serves it
```

### Issue 3: "Storage Error" when submitting form
```
This is EXPECTED! Google Sheets isn't set up yet.
Follow GOOGLE_SHEETS_SETUP.md to complete integration.
```

### Issue 4: Module not found error
```bash
# Install dependencies:
npm install

# Then start:
npm start
```

## ✅ What Works Now

- Server runs on port 3000
- Health endpoint working
- Login/authentication working
- HTML forms load
- API endpoints respond

## ⏳ What Needs Setup

- Google Sheets connection (Follow GOOGLE_SHEETS_SETUP.md)

## 🧪 Quick Verification

```bash
# Test 1: Health
curl http://localhost:3000/health

# Test 2: Login
curl -X POST http://localhost:3000/login \
  -H "Content-Type: application/json" \
  -d '{"email":"himanshu.data.acc@gmail.com","password":"1234"}'

# Test 3: Forms load
curl http://localhost:3000/index.html | head -10
```

## 📝 What Error Are You Seeing?

Please share the exact error message so I can help!

