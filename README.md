# Leave Management System (Google Sheets Edition)

A professional Node.js Express application for leave management, now migrated to use **Google Sheets** as a backend database via **Google Apps Script**.

## Features
- ✨ Google Sheets Integration (No SQL database needed)
- 🔒 Secure Admin Panel (Token-based)
- 📧 Automated Email Notifications (Nodemailer)
- 📱 Responsive UI for Leave Application
- 🚀 Vercel Compatible

## Setup Instructions

### 1. Google Sheet Setup
Create a new Google Sheet and add three tabs (sheets) with the following exact headers in the first row:

- **leaves**: `id`, `name`, `employeeId`, `startDate`, `endDate`, `batch`, `reason`, `email`, `status`, `createdAt`
- **admin**: `id`, `email`, `password`
- **email_jobs**: `id`, `type`, `payload`, `status`, `attempts`, `runAt`, `lastError`, `createdAt`, `updatedAt`

> **Note:** Add your admin email and a password (or scrypt hash) to the `admin` sheet to log in.

### 2. Google Apps Script Deployment
1. In your Google Sheet, go to **Extensions > Apps Script**.
2. Copy the code from `gas_script.gs` (provided in the migration artifacts) and paste it into the editor.
3. Click **Deploy > New Deployment**.
4. Select Type: **Web App**.
5. Set "Execute as": **Me**.
6. Set "Who has access": **Anyone**.
7. Deploy and copy the **Web App URL**.

### 3. Environment Variables
Create a `.env` file based on `.env.example`:

```env
PORT=3000
TOKEN_SECRET=your_secret_key
GOOGLE_SCRIPT_URL=https://script.google.com/macros/s/AKfycbznKWs4LkM4NnPfiPbsvIPLZBZVNrHyRMekGq5DDi4qPYO0ghPge5rwtRM651DslJM__g/exec

# Email (Gmail recommended)
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
EMAIL_FROM="Leave System <your-email@gmail.com>"

# Admin Panel
ADMIN_PANEL_URL=http://localhost:3000/admin.html
HR_NAME=HR Department
COMPANY_NAME=Your Company
```

### 4. Installation
```bash
npm install
npm start
```

## Deployment
This app is ready for deployment on **Vercel** or **Railway**.
For Vercel, ensure you add all environment variables in the Vercel Dashboard.

## License
MIT
8