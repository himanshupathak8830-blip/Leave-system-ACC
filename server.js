const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const nodemailer = require("nodemailer");

loadLocalEnv();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString("hex");
const TOKEN_TTL_MS = Number(process.env.TOKEN_TTL_MS) || 8 * 60 * 60 * 1000;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const DEFAULT_COMPANY_LOGO_URL = "https://drive.google.com/thumbnail?id=1oqFkpO8Hhv7IEYeKXWq19uubuKeFHCZ9&sz=w800";
const LEAVE_RETENTION_DAYS = Math.max(1, Number.parseInt(process.env.LEAVE_RETENTION_DAYS || "7", 10) || 7);
const LEAVE_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const EMAIL_SEND_DELAY_MS = 2 * 60 * 1000;
const EMAIL_JOB_POLL_INTERVAL_MS = 30 * 1000;
const EMAIL_JOB_RETRY_DELAY_MS = 5 * 60 * 1000;
const EMAIL_JOB_MAX_ATTEMPTS = 3;
const EMAIL_SEND_TIMEOUT_MS = Math.max(5000, Number.parseInt(process.env.EMAIL_SEND_TIMEOUT_MS || "20000", 10) || 20000);
const ALLOWED_EMAIL_DOMAINS = ["gmail.com", "outlook.com", "yahoo.com"];

app.disable("x-powered-by");

app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
});

app.use(express.json({ limit: "20kb" }));
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

let db;
const loginAttempts = new Map();

function loadLocalEnv() {
    const envPath = path.join(__dirname, ".env");
    if (!fs.existsSync(envPath)) return;

    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

    lines.forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return;

        const separatorIndex = trimmed.indexOf("=");
        if (separatorIndex === -1) return;

        const key = trimmed.slice(0, separatorIndex).trim();
        let value = trimmed.slice(separatorIndex + 1).trim();

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        if (!process.env[key]) process.env[key] = value;
    });
}

function envValue(...names) {
    for (const name of names) {
        if (process.env[name]) return process.env[name];
    }

    return "";
}

function createDatabasePool() {
    const databaseUrl = envValue("MYSQL_URL", "DATABASE_URL");


    if (databaseUrl) {
        return mysql.createPool(databaseUrl);
    }

    const host = envValue("MYSQLHOST", "MYSQL_HOST", "DB_HOST") || "localhost";
    const usingRailway = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);

    if (usingRailway && ["localhost", "127.0.0.1", "::1"].includes(host)) {
        throw new Error(
            "Railway MySQL is not configured. Add MYSQL_URL=${{ MySQL.MYSQL_URL }} to the app service Variables tab, remove localhost MySQL variables, then redeploy."
        );
    }

    return mysql.createPool({
        host,
        user: envValue("MYSQLUSER", "MYSQL_USER", "DB_USER") || "root",
        password: envValue("MYSQLPASSWORD", "MYSQL_PASSWORD", "DB_PASSWORD"),
        database: envValue("MYSQLDATABASE", "MYSQL_DATABASE", "DB_NAME") || "leaveDB",
        port: Number(envValue("MYSQLPORT", "MYSQL_PORT", "DB_PORT")) || 3306,
        waitForConnections: true,
        connectionLimit: 10
    });
}



async function initializeDatabase() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS admin (
            id INT AUTO_INCREMENT PRIMARY KEY,
            email VARCHAR(100) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL
        )
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS leaves (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100),
            employeeId VARCHAR(50),
            startDate DATE,
            endDate DATE,
            team VARCHAR(50),
            reason TEXT,
            email VARCHAR(100),
            status VARCHAR(20) DEFAULT 'Pending',
            createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS email_jobs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            type VARCHAR(50) NOT NULL,
            payload LONGTEXT NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'Pending',
            attempts INT NOT NULL DEFAULT 0,
            runAt DATETIME NOT NULL,
            lastError TEXT NULL,
            createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX status_run_idx (status, runAt)
        )
    `);

    await db.execute("ALTER TABLE admin MODIFY password VARCHAR(255) NOT NULL");
    await db.execute("ALTER TABLE leaves MODIFY status VARCHAR(20) DEFAULT 'Pending'");
    await ensureLeaveCreatedAtColumn();
    await removeLegacyEmailVerificationTable();
    await cleanupExpiredLeaves();
    await cleanupOldEmailJobs();
    await createDefaultAdmin();
}

async function ensureLeaveCreatedAtColumn() {
    const [columns] = await db.execute("SHOW COLUMNS FROM leaves LIKE 'createdAt'");
    if (columns.length) return;

    await db.execute("ALTER TABLE leaves ADD COLUMN createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP");
}

async function cleanupExpiredLeaves() {
    const [result] = await db.execute(
        `DELETE FROM leaves WHERE createdAt < DATE_SUB(NOW(), INTERVAL ${LEAVE_RETENTION_DAYS} DAY)`
    );

    if (result.affectedRows > 0) {
        console.log(`Removed ${result.affectedRows} leave requests older than ${LEAVE_RETENTION_DAYS} days.`);
    }
}

async function removeLegacyEmailVerificationTable() {
    try {
        await db.execute("DROP TABLE IF EXISTS email_verifications");
    } catch (err) {
        console.log("Legacy email verification table cleanup skipped:", err.message);
    }
}

async function cleanupOldEmailJobs() {
    await db.execute(`
        DELETE FROM email_jobs
        WHERE status IN ('Sent', 'Failed')
          AND updatedAt < DATE_SUB(NOW(), INTERVAL 14 DAY)
    `);
}

async function createDefaultAdmin() {
    const [rows] = await db.execute("SELECT COUNT(*) AS total FROM admin");

    if (rows[0].total > 0) return;

    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
        console.log("No admin found. Set ADMIN_EMAIL and ADMIN_PASSWORD in Railway variables, then redeploy.");
        return;
    }

    await db.execute(
        "INSERT INTO admin (email, password) VALUES (?, ?)",
        [ADMIN_EMAIL.trim(), hashPassword(ADMIN_PASSWORD)]
    );

    console.log(`Default admin created: ${ADMIN_EMAIL.trim()}`);
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("base64url");
    const hash = crypto.scryptSync(password, salt, 64).toString("base64url");
    return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, savedPassword) {
    const saved = String(savedPassword || "");

    if (!saved.startsWith("scrypt$")) {
        return timingSafeEqualText(password, saved);
    }

    const parts = saved.split("$");
    if (parts.length !== 3) return false;

    const [, salt, savedHash] = parts;
    const hash = crypto.scryptSync(password, salt, 64);
    const savedHashBuffer = Buffer.from(savedHash, "base64url");

    return hash.length === savedHashBuffer.length && crypto.timingSafeEqual(hash, savedHashBuffer);
}

function timingSafeEqualText(left, right) {
    const leftBuffer = Buffer.from(String(left));
    const rightBuffer = Buffer.from(String(right));
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createSignedToken(payload) {
    const body = Buffer.from(JSON.stringify({
        ...payload
    })).toString("base64url");

    return `${body}.${signTokenBody(body)}`;
}

function createToken(email) {
    return createSignedToken({
        email,
        purpose: "admin",
        exp: Date.now() + TOKEN_TTL_MS
    });
}

function verifyToken(token, purpose) {
    const [body, signature] = String(token || "").split(".");
    if (!body || !signature) return null;

    const expectedSignature = signTokenBody(body);
    if (!timingSafeEqualText(signature, expectedSignature)) return null;

    try {
        const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
        if (!payload.email || Number(payload.exp) < Date.now()) return null;
        if (purpose && payload.purpose !== purpose) return null;
        return payload;
    } catch (err) {
        return null;
    }
}

function signTokenBody(body) {
    return crypto.createHmac("sha256", TOKEN_SECRET).update(body).digest("base64url");
}

function requireAdmin(req, res, next) {
    const authHeader = req.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const admin = verifyToken(token, "admin");

    if (!admin) {
        return res.status(401).json({
            success: false,
            message: "Admin login required"
        });
    }

    req.admin = admin;
    next();
}

function recordFailedLogin(key) {
    const now = Date.now();
    const current = loginAttempts.get(key);

    if (!current || current.resetAt < now) {
        loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
        return;
    }

    current.count += 1;
}

function isLoginBlocked(key) {
    const current = loginAttempts.get(key);
    if (!current) return false;

    if (current.resetAt < Date.now()) {
        loginAttempts.delete(key);
        return false;
    }

    return current.count >= 10;
}

function clearLoginAttempts(key) {
    loginAttempts.delete(key);
}

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function getTransporter() {
    const emailUser = envValue("EMAIL_USER", "SMTP_USER", "MAIL_USER");
    const emailPass = envValue("EMAIL_PASS", "SMTP_PASS", "MAIL_PASS");

    if (!emailUser || !emailPass) return null;

    const commonOptions = {
        auth: {
            user: emailUser,
            pass: emailPass
        },
        connectionTimeout: EMAIL_SEND_TIMEOUT_MS,
        greetingTimeout: EMAIL_SEND_TIMEOUT_MS,
        socketTimeout: EMAIL_SEND_TIMEOUT_MS
    };

    const smtpHost = envValue("SMTP_HOST", "EMAIL_HOST", "MAIL_HOST");
    if (smtpHost) {
        const smtpPort = Number(envValue("SMTP_PORT", "EMAIL_PORT", "MAIL_PORT")) || 587;
        const explicitSecure = envValue("SMTP_SECURE", "EMAIL_SECURE", "MAIL_SECURE").toLowerCase();

        return nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: explicitSecure ? explicitSecure === "true" : smtpPort === 465,
            ...commonOptions
        });
    }

    return nodemailer.createTransport({
        service: process.env.EMAIL_SERVICE || "gmail",
        ...commonOptions
    });
}

function getEmailFromAddress() {
    return envValue("EMAIL_FROM", "SMTP_FROM", "MAIL_FROM") || envValue("EMAIL_USER", "SMTP_USER", "MAIL_USER");
}

function getEmailError(email) {
    const trimmedEmail = normalizeEmail(email);

    if (!trimmedEmail) {
        return "Please enter your email address.";
    }

    if (trimmedEmail.startsWith("@")) {
        return "Email me @ se pehle name likho. Example: student@gmail.com";
    }

    if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(trimmedEmail)) {
        return "Please enter a valid email address. Example: student@gmail.com";
    }

    const [localPart, domain] = trimmedEmail.split("@");
    if (!ALLOWED_EMAIL_DOMAINS.includes(domain)) {
        const suggestedDomain = getClosestAllowedEmailDomain(domain);

        if (suggestedDomain) {
            return `Please check the email domain spelling. Did you mean ${localPart}@${suggestedDomain}?`;
        }

        return "Please use only @gmail.com, @outlook.com, or @yahoo.com email addresses.";
    }

    return "";
}

function getClosestAllowedEmailDomain(domain) {
    const distances = ALLOWED_EMAIL_DOMAINS
        .map((allowedDomain) => ({
            domain: allowedDomain,
            distance: getEditDistance(domain, allowedDomain)
        }))
        .sort((left, right) => left.distance - right.distance);

    const bestMatch = distances[0];
    return bestMatch && bestMatch.distance <= 2 ? bestMatch.domain : "";
}

function getEditDistance(left, right) {
    const rows = Array.from({ length: left.length + 1 }, () => []);

    for (let i = 0; i <= left.length; i += 1) rows[i][0] = i;
    for (let j = 0; j <= right.length; j += 1) rows[0][j] = j;

    for (let i = 1; i <= left.length; i += 1) {
        for (let j = 1; j <= right.length; j += 1) {
            const cost = left[i - 1] === right[j - 1] ? 0 : 1;
            rows[i][j] = Math.min(
                rows[i - 1][j] + 1,
                rows[i][j - 1] + 1,
                rows[i - 1][j - 1] + cost
            );
        }
    }

    return rows[left.length][right.length];
}

function getEmployeeIdError(employeeId) {
    const trimmedEmployeeId = String(employeeId || "").trim();

    if (!trimmedEmployeeId) {
        return "Please enter your Employee ID.";
    }

    if (!trimmedEmployeeId.startsWith("ACC")) {
        return "Employee ID must start with ACC.";
    }

    return "";
}

function getStudentName(leave) {
    const savedName = String(leave.name || "").trim();
    if (savedName) return savedName;

    const emailName = String(leave.email || "").split("@")[0].replace(/[._-]+/g, " ").trim();
    if (!emailName) return "Student";

    return emailName
        .split(/\s+/)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(" ");
}

function validateLeave(body) {
    const leave = {
        name: String(body.name || "").trim(),
        employeeId: String(body.employeeId || "").trim(),
        startDate: String(body.startDate || "").trim(),
        endDate: String(body.endDate || "").trim(),
        team: String(body.team || "").trim(),
        reason: String(body.reason || "").trim(),
        email: normalizeEmail(body.email)
    };

    const missingField = Object.entries(leave).find(([, value]) => !value);
    if (missingField) return { error: "Please fill all fields" };

    const emailError = getEmailError(leave.email);
    if (emailError) return { error: emailError };

    const employeeIdError = getEmployeeIdError(leave.employeeId);
    if (employeeIdError) return { error: employeeIdError };

    const startTime = Date.parse(leave.startDate);
    const endTime = Date.parse(leave.endDate);

    if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
        return { error: "Please enter valid dates" };
    }

    if (endTime < startTime) {
        return { error: "End date cannot be before start date" };
    }

    return { leave };
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatMailDate(value) {
    if (!value) return "";

    const formatOptions = {
        day: "2-digit",
        month: "short",
        year: "numeric"
    };

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toLocaleDateString("en-IN", formatOptions);
    }

    const text = String(value).trim();
    const dateOnlyMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);

    if (dateOnlyMatch) {
        const [, year, month, day] = dateOnlyMatch;
        const date = new Date(Number(year), Number(month) - 1, Number(day));
        return date.toLocaleDateString("en-IN", formatOptions);
    }

    const parsedDate = new Date(text);
    if (!Number.isNaN(parsedDate.getTime())) {
        return parsedDate.toLocaleDateString("en-IN", formatOptions);
    }

    return text;
}

function getAppBaseUrl(req) {
    const configuredUrl = String(process.env.APP_URL || process.env.PUBLIC_URL || "").trim();
    if (configuredUrl) return configuredUrl.replace(/\/+$/, "");

    const protocol = req.get("x-forwarded-proto") || req.protocol || "http";
    return `${protocol}://${req.get("host")}`;
}

function getAdminPanelUrl(req) {
    const configuredUrl = String(process.env.ADMIN_PANEL_URL || "").trim();
    if (configuredUrl) return configuredUrl;

    return `${getAppBaseUrl(req)}/admin.html`;
}

function getMailBranding() {
    return {
        hrName: process.env.HR_NAME || "Faizah Waseem",
        hrDepartment: process.env.HR_DEPARTMENT || "HR Department",
        companyName: process.env.COMPANY_NAME || "Analytics Career Connect",
        companyLogoUrl: process.env.COMPANY_LOGO_URL || DEFAULT_COMPANY_LOGO_URL
    };
}

function renderEmailPanel({ title, titleColor = "#111827", bodyHtml, footerHtml = "" }) {
    const { hrName, hrDepartment, companyName, companyLogoUrl } = getMailBranding();
    const footer = footerHtml || `
        <p style="margin:16px 0 0;line-height:1.5">
            Regards,<br>
            <b>${escapeHtml(hrName)}</b><br>
            ${escapeHtml(hrDepartment)}<br>
            ${escapeHtml(companyName)}
        </p>
    `;

    return `
    <div style="margin:0;padding:16px;background:#f4f6f9">
        <div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:8px;padding:16px 18px;font-family:Arial,sans-serif;color:#111827">
            <div style="text-align:center;margin:0 0 10px">
                <img src="${escapeHtml(companyLogoUrl)}" alt="${escapeHtml(companyName)} logo" style="display:block;width:240px;max-width:72%;height:auto;max-height:110px;object-fit:contain;margin:0 auto">
            </div>
            <h2 style="margin:0 0 12px;color:${escapeHtml(titleColor)};font-size:22px;line-height:1.25">${escapeHtml(title)}</h2>
            <div style="font-size:15px;line-height:1.5">
                ${bodyHtml}
                ${footer}
            </div>
        </div>
    </div>
    `;
}

async function sendAdminLeaveNotification(leave, adminPanelUrl) {
    const transporter = getTransporter();
    if (!transporter) return { sent: false, reason: "Email is not configured" };

    const adminEmail = normalizeEmail(process.env.LEAVE_NOTIFICATION_EMAIL || ADMIN_EMAIL || process.env.EMAIL_USER);
    if (!adminEmail) return { sent: false, reason: "Admin notification email is not configured" };

    const studentName = getStudentName(leave);
    const startDate = formatMailDate(leave.startDate);
    const endDate = formatMailDate(leave.endDate);
    const { hrName, hrDepartment, companyName } = getMailBranding();

    const html = renderEmailPanel({
        title: "New Leave Application",
        bodyHtml: `
        <p style="margin:0 0 12px">A new leave application has been submitted.</p>
        <table style="border-collapse:collapse;width:100%;max-width:620px;margin:0">
            <tr><td style="padding:7px 8px;border:1px solid #ddd"><b>Name</b></td><td style="padding:7px 8px;border:1px solid #ddd">${escapeHtml(studentName)}</td></tr>
            <tr><td style="padding:7px 8px;border:1px solid #ddd"><b>Employee ID</b></td><td style="padding:7px 8px;border:1px solid #ddd">${escapeHtml(leave.employeeId)}</td></tr>
            <tr><td style="padding:7px 8px;border:1px solid #ddd"><b>Batch</b></td><td style="padding:7px 8px;border:1px solid #ddd">${escapeHtml(leave.team)}</td></tr>
            <tr><td style="padding:7px 8px;border:1px solid #ddd"><b>Email</b></td><td style="padding:7px 8px;border:1px solid #ddd">${escapeHtml(leave.email)}</td></tr>
            <tr><td style="padding:7px 8px;border:1px solid #ddd"><b>Leave Dates</b></td><td style="padding:7px 8px;border:1px solid #ddd">${escapeHtml(startDate)} to ${escapeHtml(endDate)}</td></tr>
            <tr><td style="padding:7px 8px;border:1px solid #ddd"><b>Reason</b></td><td style="padding:7px 8px;border:1px solid #ddd">${escapeHtml(leave.reason)}</td></tr>
        </table>
        <p style="margin:14px 0 8px">
            <a href="${escapeHtml(adminPanelUrl)}" style="display:inline-block;background:#111827;color:white;padding:12px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Open Admin Panel</a>
        </p>
        <p style="margin:0"><a href="${escapeHtml(adminPanelUrl)}">${escapeHtml(adminPanelUrl)}</a></p>
        `
    });

    await transporter.sendMail({
        from: getEmailFromAddress(),
        to: adminEmail,
        subject: `New Leave Application - ${studentName}`,
        text: `New Leave Application\n\nName: ${studentName}\nEmployee ID: ${leave.employeeId}\nBatch: ${leave.team}\nEmail: ${leave.email}\nLeave dates: ${startDate} to ${endDate}\nReason: ${leave.reason}\n\nOpen Admin Panel: ${adminPanelUrl}\n\nRegards,\n${hrName}\n${hrDepartment}\n${companyName}`,
        html
    });

    return { sent: true };
}

async function sendStatusEmail(leave, status) {
    const transporter = getTransporter();
    if (!transporter) return { sent: false, reason: "Email is not configured" };

    const approved = status === "Approved";
    const title = approved ? "Leave Approved" : "Leave Rejected";
    const color = approved ? "green" : "red";
    const studentName = getStudentName(leave);
    const startDate = formatMailDate(leave.startDate);
    const endDate = formatMailDate(leave.endDate);
    const { hrName, hrDepartment, companyName } = getMailBranding();
    const bodyText = approved
        ? "your leave has been approved for the selected date duration."
        : "your leave request cannot be approved at this time.";

    const html = renderEmailPanel({
        title,
        titleColor: color,
        bodyHtml: `
        <p style="margin:0 0 10px">Dear <b>${escapeHtml(studentName)}</b>,</p>
        <p style="margin:0 0 10px">${escapeHtml(studentName)}, ${escapeHtml(bodyText)}</p>
        <p style="margin:0">Leave dates: <b>${escapeHtml(startDate)}</b> to <b>${escapeHtml(endDate)}</b></p>
        `
    });

    await transporter.sendMail({
        from: getEmailFromAddress(),
        to: {
            name: studentName,
            address: leave.email
        },
        subject: `${studentName} - ${title}`,
        text: `${title}\n\nDear ${studentName},\n\n${studentName}, ${bodyText}\nLeave dates: ${startDate} to ${endDate}\n\nRegards,\n${hrName}\n${hrDepartment}\n${companyName}`,
        html
    });

    return { sent: true };
}

function formatDateTimeForDb(date) {
    const pad = (value) => String(value).padStart(2, "0");

    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate())
    ].join("-") + " " + [
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds())
    ].join(":");
}

async function enqueueEmailJob(type, payload) {
    const runAt = new Date(Date.now() + EMAIL_SEND_DELAY_MS);

    await db.execute(
        `
        INSERT INTO email_jobs (type, payload, runAt)
        VALUES (?, ?, ?)
        `,
        [type, JSON.stringify(payload), formatDateTimeForDb(runAt)]
    );

    scheduleEmailJobWake(runAt);
    return runAt;
}

let emailJobProcessing = false;

function scheduleEmailJobWake(runAt) {
    const delayMs = Math.max(0, runAt.getTime() - Date.now() + 100);
    const timer = setTimeout(runEmailWorker, delayMs);
    timer.unref?.();
}

function runEmailWorker() {
    processDueEmailJobs().catch((err) => {
        console.log("Email job worker error:", err.message);
    });
}

async function processDueEmailJobs() {
    if (emailJobProcessing) return;

    emailJobProcessing = true;

    try {
        const [jobs] = await db.execute(
            `
            SELECT id, type, payload, attempts
            FROM email_jobs
            WHERE status='Pending' AND runAt <= ?
            ORDER BY runAt ASC, id ASC
            LIMIT 10
            `,
            [formatDateTimeForDb(new Date())]
        );

        for (const job of jobs) {
            await processEmailJob(job);
        }
    } finally {
        emailJobProcessing = false;
    }
}

async function processEmailJob(job) {
    const [claim] = await db.execute(
        "UPDATE email_jobs SET status='Processing', attempts=attempts+1, lastError=NULL WHERE id=? AND status='Pending'",
        [job.id]
    );

    if (!claim.affectedRows) return;

    const attempts = Number(job.attempts || 0) + 1;

    try {
        const payload = JSON.parse(job.payload);
        await deliverEmailJob(job.type, payload);
        await db.execute("UPDATE email_jobs SET status='Sent', lastError=NULL WHERE id=?", [job.id]);
    } catch (err) {
        const failedPermanently = attempts >= EMAIL_JOB_MAX_ATTEMPTS;
        const nextStatus = failedPermanently ? "Failed" : "Pending";
        const nextRunAt = new Date(Date.now() + EMAIL_JOB_RETRY_DELAY_MS);
        const lastError = String(err?.message || err || "Email job failed").slice(0, 1000);

        await db.execute(
            "UPDATE email_jobs SET status=?, runAt=?, lastError=? WHERE id=?",
            [nextStatus, formatDateTimeForDb(nextRunAt), lastError, job.id]
        );

        if (!failedPermanently) {
            scheduleEmailJobWake(nextRunAt);
        }

        console.log(`Email job ${job.id} ${nextStatus.toLowerCase()}:`, lastError);
    }
}

async function deliverEmailJob(type, payload) {
    let result;

    if (type === "adminLeaveNotification") {
        result = await sendAdminLeaveNotification(payload.leave, payload.adminPanelUrl);
    } else if (type === "statusEmail") {
        result = await sendStatusEmail(payload.leave, payload.status);
    } else {
        throw new Error(`Unknown email job type: ${type}`);
    }

    if (!result.sent) {
        throw new Error(result.reason || "Email was not sent");
    }
}

/* ===== HEALTH ===== */
app.get("/health", (req, res) => {
    res.json({ success: true, message: "OK" });
});

/* ===== LOGIN ===== */
app.post("/login", async (req, res) => {
    const email = String(req.body.email || "").trim();
    const password = String(req.body.password || "").trim();
    const loginKey = `${req.ip}:${email.toLowerCase()}`;

    if (!email || !password) {
        return res.status(400).json({
            success: false,
            message: "Email and password are required"
        });
    }

    if (isLoginBlocked(loginKey)) {
        return res.status(429).json({
            success: false,
            message: "Too many login attempts. Try again later."
        });
    }

    try {
        const [rows] = await db.execute(
            "SELECT * FROM admin WHERE LOWER(email)=LOWER(?) LIMIT 1",
            [email]
        );

        const admin = rows[0];
        const validPassword = admin && verifyPassword(password, admin.password);

        if (!validPassword) {
            recordFailedLogin(loginKey);
            return res.status(401).json({
                success: false,
                message: "Invalid admin email or password"
            });
        }

        if (!String(admin.password).startsWith("scrypt$")) {
            await db.execute("UPDATE admin SET password=? WHERE id=?", [hashPassword(password), admin.id]);
        }

        clearLoginAttempts(loginKey);

        res.json({
            success: true,
            message: "Login successful",
            token: createToken(admin.email)
        });
    } catch (err) {
        console.log("Login DB error:", err.message);
        res.status(500).json({
            success: false,
            message: "Database error during login"
        });
    }
});

/* ===== APPLY LEAVE ===== */
app.post("/apply-leave", async (req, res) => {
    const { leave, error } = validateLeave(req.body);

    if (error) {
        return res.status(400).send(error);
    }

    try {
        const [result] = await db.execute(
            `
            INSERT INTO leaves (name, employeeId, startDate, endDate, team, reason, email)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
            [
                leave.name,
                leave.employeeId,
                leave.startDate,
                leave.endDate,
                leave.team,
                leave.reason,
                leave.email
            ]
        );

        const savedLeave = {
            ...leave,
            id: result.insertId
        };

        let notificationQueued = true;

        try {
            await enqueueEmailJob("adminLeaveNotification", {
                leave: savedLeave,
                adminPanelUrl: getAdminPanelUrl(req)
            });
        } catch (queueErr) {
            notificationQueued = false;
            console.log("Admin notification queue error:", queueErr.message);
        }

        res.send(notificationQueued
            ? "Leave Applied Successfully. Email will be sent in 2 minutes."
            : "Leave Applied Successfully, but email scheduling failed.");
    } catch (err) {
        console.log("Leave apply DB error:", err.message);
        res.status(500).send("DB Error");
    }
});

/* ===== GET LEAVES ===== */
app.get("/leaves", requireAdmin, async (req, res) => {
    try {
        await cleanupExpiredLeaves();
        const [rows] = await db.execute("SELECT * FROM leaves ORDER BY id DESC");
        res.json(rows);
    } catch (err) {
        console.log("Leaves DB error:", err.message);
        res.status(500).json([]);
    }
});

/* ===== APPROVE / REJECT ===== */
app.put("/approve/:id", requireAdmin, (req, res) => updateLeaveStatus(req, res, "Approved"));
app.put("/reject/:id", requireAdmin, (req, res) => updateLeaveStatus(req, res, "Rejected"));

async function updateLeaveStatus(req, res, status) {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
            success: false,
            message: "Invalid leave request"
        });
    }

    try {
        const [rows] = await db.execute("SELECT * FROM leaves WHERE id=?", [id]);

        if (!rows.length) {
            return res.status(404).json({
                success: false,
                message: "Leave request not found"
            });
        }

        const leave = rows[0];
        await db.execute("UPDATE leaves SET status=? WHERE id=?", [status, id]);

        try {
            await enqueueEmailJob("statusEmail", {
                leave,
                status
            });

            res.json({
                success: true,
                message: `${status}. Email will be sent in 2 minutes.`
            });
        } catch (emailErr) {
            console.log(`${status} email queue error:`, emailErr.message);
            res.json({
                success: true,
                message: `${status}, but email scheduling failed.`
            });
        }
    } catch (err) {
        console.log(`${status} DB error:`, err.message);
        res.status(500).json({
            success: false,
            message: "Database error"
        });
    }
}

async function startServer() {
    try {
        db = createDatabasePool();
        await db.query("SELECT 1");
        console.log("MySQL Connected");
        await initializeDatabase();

        if (!process.env.TOKEN_SECRET) {
            console.log("TOKEN_SECRET is not set. Set it in Railway for stable secure admin sessions.");
        }

        app.listen(PORT, HOST, () => {
            console.log(`Server running on ${HOST}:${PORT}`);
        });

        runEmailWorker();

        const emailJobTimer = setInterval(() => {
            runEmailWorker();
        }, EMAIL_JOB_POLL_INTERVAL_MS);
        emailJobTimer.unref?.();

        const cleanupTimer = setInterval(() => {
            Promise.all([cleanupExpiredLeaves(), cleanupOldEmailJobs()]).catch((err) => {
                console.log("Leave cleanup error:", err.message);
            });
        }, LEAVE_CLEANUP_INTERVAL_MS);
        cleanupTimer.unref?.();
    } catch (err) {
        console.log("Startup error:", err.message);
        process.exit(1);
    }
}

startServer();
