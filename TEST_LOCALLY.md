# Testing the Leave Management System Locally

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

