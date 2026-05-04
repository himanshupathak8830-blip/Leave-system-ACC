# Railway Deploy Guide

## 1. Prepare GitHub

Push this project to a GitHub repository. Do not upload a real `.env` file.

## 2. Create Railway Project

1. Open Railway.
2. Create a new project.
3. Deploy from your GitHub repository.
4. Add a MySQL database service in the same Railway project.

## 3. Add Variables To The App Service

In the Railway app service Variables tab, add:

```env
ADMIN_EMAIL=himanshu.data.acc@gmail.com
ADMIN_PASSWORD=use-a-strong-admin-password
TOKEN_SECRET=use-a-long-random-secret
APP_URL=https://your-app.up.railway.app
ADMIN_PANEL_URL=https://your-app.up.railway.app/admin.html
```

Generate a token secret locally with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then add MySQL variables by referencing the MySQL service variables:

```env
MYSQL_URL=${{ MySQL.MYSQL_URL }}
```

If your MySQL service has a different name, replace `MySQL` with that service name.

Do not set Railway database variables to local values like:

```env
MYSQLHOST=localhost
MYSQLPORT=3306
MYSQLUSER=root
MYSQLPASSWORD=8588
MYSQLDATABASE=leaveDB
```

If the app logs `Startup error: connect ECONNREFUSED ::1:3306`, the app service is still trying to connect to local MySQL. Add `MYSQL_URL=${{ MySQL.MYSQL_URL }}` to the app service Variables tab and redeploy.

## 4. Email Variables

For student OTP verification and approval/rejection emails, add:

```env
EMAIL_SERVICE=gmail
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_gmail_app_password
EMAIL_FROM=your_email@gmail.com
LEAVE_NOTIFICATION_EMAIL=your_admin_notification_email@gmail.com
HR_NAME=Faizah Waseem
HR_DEPARTMENT=HR Department
COMPANY_NAME=Analytics Career Connect
COMPANY_LOGO_URL=https://drive.google.com/thumbnail?id=1oqFkpO8Hhv7IEYeKXWq19uubuKeFHCZ9&sz=w800
EMAIL_OTP_TTL_MINUTES=10
EMAIL_VERIFICATION_TOKEN_TTL_MINUTES=30
```

## 5. Deploy

Redeploy the app service after adding variables.

Railway will run:

```bash
npm install
npm start
```

## 6. Public URLs

Students use:

```text
https://your-app.up.railway.app/
```

Admin uses:

```text
https://your-app.up.railway.app/admin.html
```

## Security Notes

- `/apply-leave` is public for students.
- `/leaves`, `/approve/:id`, and `/reject/:id` require admin login.
- Admin passwords are stored as hashes.
- The app creates the required MySQL tables automatically on first deploy.
