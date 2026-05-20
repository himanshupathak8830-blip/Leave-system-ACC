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
```

Generate a token secret locally with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then add MySQL variables by referencing the MySQL service variables:

```env
MYSQLHOST=${{ MySQL.MYSQLHOST }}
MYSQLPORT=${{ MySQL.MYSQLPORT }}
MYSQLUSER=${{ MySQL.MYSQLUSER }}
MYSQLPASSWORD=${{ MySQL.MYSQLPASSWORD }}
MYSQLDATABASE=${{ MySQL.MYSQLDATABASE }}
```

If your MySQL service has a different name, replace `MySQL` with that service name.

## 4. Optional Email Variables

For approval/rejection emails, add:

```env
EMAIL_SERVICE=gmail
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_gmail_app_password
EMAIL_FROM=your_email@gmail.com
HR_NAME=HR Department
COMPANY_NAME=Analytics Career Connect
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
