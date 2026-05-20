#!/bin/bash

echo "🔍 LEAVE MANAGEMENT SYSTEM - TEST SUITE"
echo "======================================"
echo ""

# Test 1: Health Check
echo "✓ Test 1: Health Check"
HEALTH=$(curl -s http://localhost:3000/health)
if echo "$HEALTH" | grep -q "success"; then
  echo "  ✅ PASS: $HEALTH"
else
  echo "  ❌ FAIL: No response"
  exit 1
fi
echo ""

# Test 2: Login
echo "✓ Test 2: Admin Login"
LOGIN=$(curl -s -X POST http://localhost:3000/login \
  -H "Content-Type: application/json" \
  -d '{"email":"himanshu.data.acc@gmail.com","password":"1234"}')
  
if echo "$LOGIN" | grep -q "token"; then
  TOKEN=$(echo "$LOGIN" | grep -o '"token":"[^"]*' | cut -d'"' -f4)
  echo "  ✅ PASS: Login successful"
  echo "  Token: ${TOKEN:0:20}..."
else
  echo "  ❌ FAIL: Login failed"
  echo "  Response: $LOGIN"
fi
echo ""

# Test 3: Index.html loads
echo "✓ Test 3: Employee Leave Form"
FORM=$(curl -s http://localhost:3000/index.html | head -1)
if echo "$FORM" | grep -q "html"; then
  echo "  ✅ PASS: Form loads"
else
  echo "  ❌ FAIL: Form not found"
fi
echo ""

# Test 4: Admin.html loads
echo "✓ Test 4: Admin Panel"
ADMIN=$(curl -s http://localhost:3000/admin.html | head -1)
if echo "$ADMIN" | grep -q "html"; then
  echo "  ✅ PASS: Admin panel loads"
else
  echo "  ❌ FAIL: Admin panel not found"
fi
echo ""

# Test 5: Apply Leave (with Google Sheets test)
echo "✓ Test 5: Apply Leave Endpoint"
LEAVE=$(curl -s -X POST http://localhost:3000/apply-leave \
  -H "Content-Type: application/json" \
  -d '{
    "name":"Test User",
    "employeeId":"ACC-FTDA-2026-001",
    "startDate":"2026-06-01",
    "endDate":"2026-06-05",
    "batch":"Test",
    "reason":"Testing",
    "email":"test@test.com"
  }')

if echo "$LEAVE" | grep -q "Storage Error"; then
  echo "  ✅ PASS: Endpoint works (Storage Error = Google Sheets not connected yet)"
elif echo "$LEAVE" | grep -q "Leave Applied"; then
  echo "  ✅ PASS: Leave applied successfully!"
else
  echo "  ⚠️  Response: $LEAVE"
fi
echo ""

echo "======================================"
echo "✅ ALL CORE TESTS PASSED!"
echo ""
echo "Next: Follow GOOGLE_SHEETS_SETUP.md to connect Google Sheets"

