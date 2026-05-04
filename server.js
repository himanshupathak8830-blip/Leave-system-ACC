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
const EMAIL_OTP_TTL_MINUTES = Math.max(1, Number.parseInt(process.env.EMAIL_OTP_TTL_MINUTES || "10", 10) || 10);
const EMAIL_VERIFICATION_TOKEN_TTL_MINUTES = Math.max(
    1,
    Number.parseInt(process.env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES || "30", 10) || 30
);
const EMAIL_OTP_RESEND_SECONDS = 60;
const EMAIL_OTP_MAX_ATTEMPTS = 5;

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
        CREATE TABLE IF NOT EXISTS email_verifications (
            id INT AUTO_INCREMENT PRIMARY KEY,
            email VARCHAR(100) NOT NULL,
            otpHash VARCHAR(128) NOT NULL,
            expiresAt DATETIME NOT NULL,
            verifiedAt DATETIME NULL,
            attempts INT NOT NULL DEFAULT 0,
            createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX email_created_idx (email, createdAt),
            INDEX expires_idx (expiresAt)
        )
    `);

    await db.execute("ALTER TABLE admin MODIFY password VARCHAR(255) NOT NULL");
    await db.execute("ALTER TABLE leaves MODIFY status VARCHAR(20) DEFAULT 'Pending'");
    await ensureLeaveCreatedAtColumn();
    await cleanupExpiredLeaves();
    await cleanupEmailVerifications();
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

async function cleanupEmailVerifications() {
    await db.execute(`
        DELETE FROM email_verifications
        WHERE expiresAt < DATE_SUB(NOW(), INTERVAL 1 DAY)
           OR verifiedAt < DATE_SUB(NOW(), INTERVAL 1 DAY)
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

function createEmailVerificationToken(email) {
    return createSignedToken({
        email: normalizeEmail(email),
        purpose: "emailVerification",
        exp: Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MINUTES * 60 * 1000
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

function verifyEmailVerificationToken(token, email) {
    const payload = verifyToken(token, "emailVerification");
    return Boolean(payload && normalizeEmail(payload.email) === normalizeEmail(email));
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
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return null;

    return nodemailer.createTransport({
        service: process.env.EMAIL_SERVICE || "gmail",
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });
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

    return "";
}

function generateOtp() {
    return String(crypto.randomInt(100000, 1000000));
}

function hashOtp(email, otp) {
    return crypto
        .createHmac("sha256", TOKEN_SECRET)
        .update(`${normalizeEmail(email)}:${String(otp).trim()}`)
        .digest("hex");
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
        email: String(body.email || "").trim()
    };

    const missingField = Object.entries(leave).find(([, value]) => !value);
    if (missingField) return { error: "Please fill all fields" };

    const emailError = getEmailError(leave.email);
    if (emailError) return { error: emailError };

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

async function sendEmailVerificationOtp(email, name) {
    const transporter = getTransporter();
    if (!transporter) {
        return {
            sent: false,
            status: 500,
            message: "Email service is not configured"
        };
    }

    const normalizedEmail = normalizeEmail(email);
    const [recentRows] = await db.execute(
        `
        SELECT TIMESTAMPDIFF(SECOND, createdAt, NOW()) AS secondsAgo
        FROM email_verifications
        WHERE email=?
        ORDER BY id DESC
        LIMIT 1
        `,
        [normalizedEmail]
    );

    const secondsAgo = Number(recentRows[0]?.secondsAgo);
    if (Number.isFinite(secondsAgo) && secondsAgo < EMAIL_OTP_RESEND_SECONDS) {
        return {
            sent: false,
            status: 429,
            message: `Please wait ${EMAIL_OTP_RESEND_SECONDS - secondsAgo} seconds before requesting another code.`
        };
    }

    const otp = generateOtp();
    const otpHash = hashOtp(normalizedEmail, otp);
    const studentName = getStudentName({ name, email: normalizedEmail });
    const hrName = process.env.HR_NAME || "Faizah Waseem";
    const hrDepartment = process.env.HR_DEPARTMENT || "HR Department";
    const companyName = process.env.COMPANY_NAME || "Analytics Career Connect";
    const companyLogoUrl = process.env.COMPANY_LOGO_URL || DEFAULT_COMPANY_LOGO_URL;

    const [insertResult] = await db.execute(
        `
        INSERT INTO email_verifications (email, otpHash, expiresAt)
        VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ${EMAIL_OTP_TTL_MINUTES} MINUTE))
        `,
        [normalizedEmail, otpHash]
    );

    const html = `
    <div style="font-family:Arial;padding:20px">
        <div style="text-align:center;margin-bottom:20px">
            <img src="${escapeHtml(companyLogoUrl)}" alt="${escapeHtml(companyName)} logo" style="width:480px;max-width:100%;max-height:260px;object-fit:contain">
        </div>
        <h2>Email Verification Code</h2>
        <p>Dear <b>${escapeHtml(studentName)}</b>,</p>
        <p>Your one-time email verification code is:</p>
        <p style="font-size:28px;font-weight:bold;letter-spacing:4px">${escapeHtml(otp)}</p>
        <p>This code will expire in ${EMAIL_OTP_TTL_MINUTES} minutes.</p>
        <br>
        <p>Regards,<br>
        <b>${escapeHtml(hrName)}</b><br>
        ${escapeHtml(hrDepartment)}<br>
        ${escapeHtml(companyName)}</p>
    </div>
    `;

    try {
        await transporter.sendMail({
            from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
            to: {
                name: studentName,
                address: normalizedEmail
            },
            subject: "Email Verification Code",
            text: `Email Verification Code\n\nDear ${studentName},\n\nYour one-time email verification code is: ${otp}\nThis code will expire in ${EMAIL_OTP_TTL_MINUTES} minutes.\n\nRegards,\n${hrName}\n${hrDepartment}\n${companyName}`,
            html
        });
    } catch (err) {
        await db.execute("DELETE FROM email_verifications WHERE id=?", [insertResult.insertId]);
        throw err;
    }

    return {
        sent: true,
        message: "Verification code sent to your email."
    };
}

async function sendAdminLeaveNotification(leave, adminPanelUrl) {
    const transporter = getTransporter();
    if (!transporter) return { sent: false, reason: "Email is not configured" };

    const adminEmail = normalizeEmail(process.env.LEAVE_NOTIFICATION_EMAIL || ADMIN_EMAIL || process.env.EMAIL_USER);
    if (!adminEmail) return { sent: false, reason: "Admin notification email is not configured" };

    const studentName = getStudentName(leave);
    const startDate = formatMailDate(leave.startDate);
    const endDate = formatMailDate(leave.endDate);
    const hrName = process.env.HR_NAME || "Faizah Waseem";
    const hrDepartment = process.env.HR_DEPARTMENT || "HR Department";
    const companyName = process.env.COMPANY_NAME || "Analytics Career Connect";
    const companyLogoUrl = process.env.COMPANY_LOGO_URL || DEFAULT_COMPANY_LOGO_URL;

    const html = `
    <div style="font-family:Arial;padding:20px">
        <div style="text-align:center;margin-bottom:20px">
            <img src="${escapeHtml(companyLogoUrl)}" alt="${escapeHtml(companyName)} logo" style="width:480px;max-width:100%;max-height:260px;object-fit:contain">
        </div>
        <h2>New Leave Application</h2>
        <p>A new leave application has been submitted.</p>
        <table style="border-collapse:collapse;width:100%;max-width:620px">
            <tr><td style="padding:8px;border:1px solid #ddd"><b>Name</b></td><td style="padding:8px;border:1px solid #ddd">${escapeHtml(studentName)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd"><b>Employee ID</b></td><td style="padding:8px;border:1px solid #ddd">${escapeHtml(leave.employeeId)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd"><b>Batch</b></td><td style="padding:8px;border:1px solid #ddd">${escapeHtml(leave.team)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd"><b>Email</b></td><td style="padding:8px;border:1px solid #ddd">${escapeHtml(leave.email)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd"><b>Leave Dates</b></td><td style="padding:8px;border:1px solid #ddd">${escapeHtml(startDate)} to ${escapeHtml(endDate)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd"><b>Reason</b></td><td style="padding:8px;border:1px solid #ddd">${escapeHtml(leave.reason)}</td></tr>
        </table>
        <p style="margin-top:20px">
            <a href="${escapeHtml(adminPanelUrl)}" style="display:inline-block;background:#111827;color:white;padding:12px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Open Admin Panel</a>
        </p>
        <p><a href="${escapeHtml(adminPanelUrl)}">${escapeHtml(adminPanelUrl)}</a></p>
        <br>
        <p>Regards,<br>
        <b>${escapeHtml(hrName)}</b><br>
        ${escapeHtml(hrDepartment)}<br>
        ${escapeHtml(companyName)}</p>
    </div>
    `;

    await transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
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
    const hrName = process.env.HR_NAME || "Faizah Waseem";
    const hrDepartment = process.env.HR_DEPARTMENT || "HR Department";
    const companyName = process.env.COMPANY_NAME || "Analytics Career Connect";
    const companyLogoUrl = process.env.COMPANY_LOGO_URL || DEFAULT_COMPANY_LOGO_URL;
    const bodyText = approved
        ? "your leave has been approved for the selected date duration."
        : "your leave request cannot be approved at this time.";

    const html = `
    <div style="font-family:Arial;padding:20px">
        <div style="text-align:center;margin-bottom:20px">
            <img src="${escapeHtml(companyLogoUrl)}" alt="${escapeHtml(companyName)} logo" style="width:480px;max-width:100%;max-height:260px;object-fit:contain">
        </div>
        <h2 style="color:${color};">${title}</h2>
        <p>Dear <b>${escapeHtml(studentName)}</b>,</p>
        <p>${escapeHtml(studentName)}, ${bodyText}</p>
        <p>Leave dates: <b>${escapeHtml(startDate)}</b> to <b>${escapeHtml(endDate)}</b></p>
        <br>
        <p>Regards,<br>
        <b>${escapeHtml(hrName)}</b><br>
        ${escapeHtml(hrDepartment)}<br>
        ${escapeHtml(companyName)}</p>
    </div>
    `;

    await transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
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

/* ===== EMAIL VERIFICATION ===== */
app.post("/send-email-otp", async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const name = String(req.body.name || "").trim();
    const emailError = getEmailError(email);

    if (emailError) {
        return res.status(400).json({
            success: false,
            message: emailError
        });
    }

    try {
        const result = await sendEmailVerificationOtp(email, name);

        if (!result.sent) {
            return res.status(result.status || 500).json({
                success: false,
                message: result.message
            });
        }

        res.json({
            success: true,
            message: result.message
        });
    } catch (err) {
        console.log("Email OTP send error:", err.message);
        res.status(500).json({
            success: false,
            message: "Verification email could not be sent."
        });
    }
});

app.post("/verify-email-otp", async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || "").trim();
    const emailError = getEmailError(email);

    if (emailError) {
        return res.status(400).json({
            success: false,
            message: emailError
        });
    }

    if (!/^\d{6}$/.test(otp)) {
        return res.status(400).json({
            success: false,
            message: "Please enter the 6-digit verification code."
        });
    }

    try {
        const [rows] = await db.execute(
            `
            SELECT id, otpHash, attempts, expiresAt <= NOW() AS expired
            FROM email_verifications
            WHERE email=? AND verifiedAt IS NULL
            ORDER BY id DESC
            LIMIT 1
            `,
            [email]
        );

        const verification = rows[0];
        if (!verification) {
            return res.status(400).json({
                success: false,
                message: "Please request a verification code first."
            });
        }

        if (Number(verification.expired)) {
            return res.status(400).json({
                success: false,
                message: "Verification code expired. Please request a new code."
            });
        }

        if (Number(verification.attempts) >= EMAIL_OTP_MAX_ATTEMPTS) {
            return res.status(429).json({
                success: false,
                message: "Too many incorrect attempts. Please request a new code."
            });
        }

        const validOtp = timingSafeEqualText(hashOtp(email, otp), verification.otpHash);

        if (!validOtp) {
            await db.execute("UPDATE email_verifications SET attempts=attempts+1 WHERE id=?", [verification.id]);
            return res.status(400).json({
                success: false,
                message: "Incorrect verification code."
            });
        }

        await db.execute("UPDATE email_verifications SET verifiedAt=NOW() WHERE id=?", [verification.id]);

        res.json({
            success: true,
            message: "Email verified.",
            token: createEmailVerificationToken(email)
        });
    } catch (err) {
        console.log("Email OTP verify error:", err.message);
        res.status(500).json({
            success: false,
            message: "Verification failed. Please try again."
        });
    }
});

/* ===== APPLY LEAVE ===== */
app.post("/apply-leave", async (req, res) => {
    const { leave, error } = validateLeave(req.body);

    if (error) {
        return res.status(400).send(error);
    }

    if (!verifyEmailVerificationToken(req.body.emailVerificationToken, leave.email)) {
        return res.status(400).send("Please verify your email before applying leave.");
    }

    try {
        await db.execute(
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

        try {
            const notificationResult = await sendAdminLeaveNotification(leave, getAdminPanelUrl(req));
            if (!notificationResult.sent) {
                console.log("Admin notification skipped:", notificationResult.reason);
            }
        } catch (emailErr) {
            console.log("Admin notification email error:", emailErr.message);
        }

        res.send("Leave Applied Successfully");
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
            const emailResult = await sendStatusEmail(leave, status);
            const emailMessage = emailResult.sent ? "Email sent" : emailResult.reason;

            res.json({
                success: true,
                message: `${status}. ${emailMessage}.`
            });
        } catch (emailErr) {
            console.log(`${status} email error:`, emailErr.message);
            res.json({
                success: true,
                message: `${status}, but email failed.`
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

        const cleanupTimer = setInterval(() => {
            Promise.all([cleanupExpiredLeaves(), cleanupEmailVerifications()]).catch((err) => {
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
