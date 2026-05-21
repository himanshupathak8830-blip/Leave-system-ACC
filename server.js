const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

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

loadLocalEnv();

const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const { gasRequest } = require("./lib/gasClient");

function isGoogleSheetsMode() {
    return Boolean(process.env.GOOGLE_SCRIPT_URL);
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString("hex");
const TOKEN_TTL_MS = Number(process.env.TOKEN_TTL_MS) || 8 * 60 * 60 * 1000;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "himanshu.data.acc@gmail.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1234";

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

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

const loginAttempts = new Map();

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

function createToken(email) {
    const body = Buffer.from(JSON.stringify({
        email,
        exp: Date.now() + TOKEN_TTL_MS
    })).toString("base64url");

    return `${body}.${signTokenBody(body)}`;
}

function verifyToken(token) {
    const [body, signature] = String(token || "").split(".");
    if (!body || !signature) return null;

    const expectedSignature = signTokenBody(body);
    if (!timingSafeEqualText(signature, expectedSignature)) return null;

    try {
        const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
        if (!payload.email || Number(payload.exp) < Date.now()) return null;
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
    const admin = verifyToken(token);

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

function validateLeave(body) {
    const leave = {
        name: String(body.name || "").trim(),
        employeeId: String(body.employeeId || "").trim(),
        startDate: String(body.startDate || "").trim(),
        endDate: String(body.endDate || "").trim(),
        batch: String(body.batch || body.team || "").trim(),
        reason: String(body.reason || "").trim(),
        email: String(body.email || "").trim()
    };

    const missingField = Object.entries(leave).find(([, value]) => !value);
    if (missingField) return { error: `Please fill all fields (Missing: ${missingField[0]})` };

    if (!/^ACC-[A-Za-z]+-\d{4}-\d+$/.test(leave.employeeId)) {
        return { error: "Please enter a valid employee ID in the format ACC-xxxx-yyyy-123 (e.g. ACC-FTDA-2026-034)" };
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(leave.email)) {
        return { error: "Please enter a valid email" };
    }

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

async function sendStatusEmail(leave, status) {
    const transporter = getTransporter();
    if (!transporter) return { sent: false, reason: "Email is not configured" };

    const approved = status === "Approved";
    const title = approved ? "Leave Approved" : "Leave Rejected";
    const color = approved ? "green" : "red";
    const bodyText = approved
        ? "Your leave has been approved."
        : "Your leave request cannot be approved at this time.";

    const html = `
    <div style="font-family:Arial;padding:20px">
        <div style="text-align:center;margin-bottom:20px;">
            <img src="https://lh3.googleusercontent.com/d/1oqFkpO8Hhv7IEYeKXWq19uubuKeFHCZ9" alt="ACC Logo" style="display:block;width:360px;max-width:80%;height:auto;max-height:165px;object-fit:contain;margin:0 auto">
        </div>
        <h2 style="color:${color};">${title}</h2>
        <p>Dear <b>${escapeHtml(leave.name)}</b>,</p>
        <p>${bodyText}</p>
        <p>Leave dates: <b>${escapeHtml(leave.startDate)}</b> to <b>${escapeHtml(leave.endDate)}</b></p>
        <br>
        <p><b>${escapeHtml(process.env.HR_NAME || "HR Department")}</b><br>
        ${escapeHtml(process.env.COMPANY_NAME || "Analytics Career Connect")}</p>
    </div>
    `;

    await transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to: leave.email,
        subject: title,
        html
    });

    return { sent: true };
}

async function sendApplicationEmail(leave) {
    const transporter = getTransporter();
    if (!transporter) return { sent: false, reason: "Email is not configured" };

    const hrEmail = process.env.LEAVE_NOTIFICATION_EMAIL || process.env.ADMIN_EMAIL || process.env.EMAIL_USER;

    const html = `
    <div style="font-family:Arial;padding:20px">
        <div style="text-align:center;margin-bottom:20px;">
            <img src="https://lh3.googleusercontent.com/d/1oqFkpO8Hhv7IEYeKXWq19uubuKeFHCZ9" alt="ACC Logo" style="display:block;width:360px;max-width:80%;height:auto;max-height:165px;object-fit:contain;margin:0 auto">
        </div>
        <h2 style="color:#ff8c00;">New Leave Application</h2>
        <p>A new leave application has been submitted by <b>${escapeHtml(leave.name)}</b>.</p>
        <ul>
            <li><b>Employee ID:</b> ${escapeHtml(leave.employeeId)}</li>
            <li><b>Email:</b> ${escapeHtml(leave.email)}</li>
            <li><b>Batch:</b> ${escapeHtml(leave.batch)}</li>
            <li><b>Start Date:</b> ${escapeHtml(leave.startDate)}</li>
            <li><b>End Date:</b> ${escapeHtml(leave.endDate)}</li>
            <li><b>Reason:</b> ${escapeHtml(leave.reason)}</li>
        </ul>
        <br>
        <div style="text-align: center; margin-top: 20px;">
            <a href="${process.env.ADMIN_PANEL_URL || 'http://localhost:3000/admin.html'}" style="background-color: #ff8c00; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Open Admin Panel</a>
        </div>
        <p style="margin-top: 20px;">Please log in to the admin panel to approve or reject this request.</p>
    </div>
    `;

    await transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to: hrEmail,
        subject: "New Leave Request: " + leave.name,
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
        let admin;
        
        // 1. Direct login using your specified email and password
        if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
            admin = { email: ADMIN_EMAIL, password: ADMIN_PASSWORD };
        } 
        // 2. Fallback to Google Sheets for any other admin emails
        else if (isGoogleSheetsMode()) {
            const response = await gasRequest({
                action: "admin.login",
                payload: { email }
            });

            if (!response.ok || !response.data) {
                recordFailedLogin(loginKey);
                return res.status(401).json({
                    success: false,
                    message: "Invalid admin email or password"
                });
            }
            admin = response.data;
        } else {
            // Legacy DB logic (if applicable) or return error
            return res.status(501).json({ success: false, message: "DB mode not fully implemented" });
        }
        
        const validPassword = admin && verifyPassword(password, admin.password);

        if (!validPassword) {
            recordFailedLogin(loginKey);
            return res.status(401).json({
                success: false,
                message: "Invalid admin email or password"
            });
        }

        clearLoginAttempts(loginKey);

        res.json({
            success: true,
            message: "Login successful",
            token: createToken(admin.email)
        });
    } catch (err) {
        console.error("Login GAS error detailed:", err.message);
        const errMsg = err.message || "";

        if (errMsg.includes("not found") || errMsg.includes("No admins") || errMsg.includes("Columns")) {
            recordFailedLogin(loginKey);
            return res.status(401).json({
                success: false,
                message: errMsg.includes("email") ? "Invalid admin email or password" : `Sheet Setup Issue: ${errMsg}`
            });
        }

        res.status(500).json({
            success: false,
            message: `Error during login: ${errMsg}`
        });
    }
});

/* ===== APPLY LEAVE ===== */
app.post("/apply-leave", async (req, res) => {
    const { leave, error } = validateLeave(req.body);

    if (error) {
        return res.status(400).send(error);
    }

    if (isGoogleSheetsMode()) {
        try {
            const gasResult = await gasRequest({
                action: "leave.create",
                payload: {
                    name: leave.name,
                    employeeId: leave.employeeId,
                    startDate: leave.startDate,
                    endDate: leave.endDate,
                    batch: leave.batch,
                    reason: leave.reason,
                    email: leave.email,
                    status: "Pending"
                }
            });

            try {
                await sendApplicationEmail(leave);
            } catch (emailErr) {
                console.log("Application email error:", emailErr.message);
            }

                    if (gasResult && (gasResult.ok || gasResult.success)) {
                        return res.send("Leave Applied Successfully");
                    } else {
                        console.error("GAS returned error:", gasResult.error);
                        return res.status(500).send(`Storage Error: ${gasResult?.error || "Unknown GAS error"}`);
                    }
        } catch (err) {
                    console.error("Leave apply GAS exception:", err.message);
                    return res.status(500).send(`Storage Error: ${err.message}`);
        }
    }

    res.status(500).send("Storage Error: No database configured");
});

/* ===== GET LEAVES ===== */
app.get("/leaves", requireAdmin, async (req, res) => {
    try {
        if (isGoogleSheetsMode()) {
            const response = await gasRequest({ action: "leaves" });
            const rows = response.data || [];
            const sorted = rows.sort((a, b) => {
              // Convert ID to number for sorting
              const idA = Number(a.ID || a.id || 0);
              const idB = Number(b.ID || b.id || 0);
              return idB - idA;
            });
            return res.json(sorted.map(row => ({
              id: row.ID || row.id,
              name: row.Name || row.name,
              employeeId: row["Employee ID"] || row.employeeId,
              startDate: row["Start Date"] || row.startDate,
              endDate: row["End Date"] || row.endDate,
              batch: row.Batch || row.batch,
              reason: row.Reason || row.reason,
              email: row.Email || row.email,
              status: row.Status || row.status,
              createdAt: row["Created At"] || row.createdAt
            })));
        }
        res.json([]);
    } catch (err) {
        console.log("Leaves GAS error:", err.message);
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
        let leave = null;

        if (isGoogleSheetsMode()) {
            const response = await gasRequest({ action: "leaves" });
            const rows = response.data || [];
            const allLeaves = rows.map(row => ({
                id: row.ID || row.id,
                name: row.Name || row.name,
                employeeId: row["Employee ID"] || row.employeeId,
                startDate: row["Start Date"] || row.startDate,
                endDate: row["End Date"] || row.endDate,
                batch: row.Batch || row.batch,
                reason: row.Reason || row.reason,
                email: row.Email || row.email,
                status: row.Status || row.status,
                createdAt: row["Created At"] || row.createdAt
            }));
            leave = allLeaves.find(l => l.id == id);
        }

        if (!leave) {
            return res.status(404).json({
                success: false,
                message: "Leave request not found"
            });
        }

        if (isGoogleSheetsMode()) {
            const gasResult = await gasRequest({
                action: "leave.status.update",
                payload: { id, status }
            });

                if (!gasResult.ok && !gasResult.success) {
                throw new Error(gasResult.error || "GAS update failed");
            }
        }

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
        console.log(`${status} error:`, err.message);
        res.status(500).json({
            success: false,
                message: `Storage error: ${err.message}`
        });
    }
}

async function startServer() {
    try {
        if (!process.env.GOOGLE_SCRIPT_URL) {
            console.warn("GOOGLE_SCRIPT_URL is not set. Google Sheets integration will fail.");
        }

        if (!process.env.TOKEN_SECRET) {
            console.log("TOKEN_SECRET is not set. Set it for stable secure admin sessions.");
        }

        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    } catch (err) {
        console.log("Startup error:", err.message);
        process.exit(1);
    }
}

startServer();

module.exports = app;
