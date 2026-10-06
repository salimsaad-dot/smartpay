const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const pool = require('./db');
const authRoutes = require('./routes/authRoutes');
const academicYearRoutes = require('./routes/academicYearRoutes');
const termRoutes = require('./routes/termRoutes');
const classRoutes = require('./routes/classRoutes');
const parentRoutes = require('./routes/parentRoutes');
const studentRoutes = require('./routes/studentRoutes');
const feeStructureRoutes = require('./routes/feeStructureRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const publicPaymentRoutes = require('./routes/publicPaymentRoutes');
const arrearsRoutes = require('./routes/arrearsRoutes');
const smsTemplateRoutes = require('./routes/smsTemplateRoutes');
const reminderRoutes = require('./routes/reminderRoutes');
const scheduledJobRoutes = require('./routes/scheduledJobRoutes');
const cronRoutes = require('./routes/cronRoutes');
const schoolSettingsRoutes = require('./routes/schoolSettingsRoutes');
const reportsRoutes = require('./routes/reportsRoutes');
const auditLogRoutes = require('./routes/auditLogRoutes');

const app = express();

// Required for req.ip (used by audit logging and rate limiting) to
// reflect the real client IP once deployed behind a reverse proxy
// (Render/Railway), rather than the proxy's own address — and for
// express-rate-limit to correctly key its per-IP buckets in that same
// environment.
app.set('trust proxy', 1);

// Same overrides as Academia Hub, same reasoning: this is a pure JSON API
// consumed by a separate frontend origin, not a server serving its own
// HTML — helmet's default CSP is built for the latter and adds nothing
// here, and crossOriginResourcePolicy needs loosening so the frontend can
// actually load anything cross-origin.
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
}));

// Cookie-based auth requires credentials:true + a specific origin — the
// wildcard default can't carry cookies cross-origin, and browsers reject
// credentials:true paired with origin:'*' outright. This stays
// credentialed + explicit-allowlist for this authenticated app; the
// public, no-account parent payment-link flow (a later phase) will need
// its own separate, non-credentialed public route group rather than
// bending this one.
const allowedOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:3100',
];
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
}));
// verify captures the exact request bytes onto req.rawBody — needed
// because Paystack's webhook signature is computed over the raw body, and
// by the time a route handler sees req.body it's already been parsed into
// an object (re-serializing it would not reproduce the original bytes
// byte-for-byte, e.g. key ordering/whitespace, and would fail
// verification). Same proven pattern as Academia Hub's server.js.
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(cookieParser());

app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'success', message: 'SmartPay API is running.' });
});

// UptimeRobot pings this every 5 minutes. Same pattern as Academia Hub's
// keepalive, on the same Aiven free-tier auto-power-off problem: a plain
// read-only health check wasn't enough to prevent the service pausing, so
// this does a real UPDATE against a dedicated single-row table instead, on
// the theory that write I/O is more likely to register as genuine usage.
// Unconfirmed whether this actually prevents it — Aiven doesn't publicly
// document the exact threshold — this is a real experiment, not a
// guaranteed fix. If it also fails, the next step is Aiven's paid tier,
// which explicitly disables auto-power-off.
//
// Self-bootstrapping on purpose: production DB credentials live only in
// Render/Aiven, not in this codebase or anyone's local .env, so there's no
// safe way to run a one-off CREATE TABLE against prod from outside it. The
// first call after a deploy creates the table and seeds its one row; every
// call after that (within this process's lifetime) skips straight to the
// UPDATE.
let keepaliveReady = false;
app.get('/api/keepalive', async (req, res) => {
    try {
        if (!keepaliveReady) {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS keepalive_heartbeat (
                    id INT NOT NULL,
                    pinged_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            await pool.query('INSERT IGNORE INTO keepalive_heartbeat (id) VALUES (1)');
            keepaliveReady = true;
        }
        await pool.query('UPDATE keepalive_heartbeat SET pinged_at = CURRENT_TIMESTAMP WHERE id = 1');
        res.status(200).json({ status: 'success', message: 'Heartbeat recorded.' });
    } catch (error) {
        console.error('Keepalive error:', error);
        res.status(500).json({ status: 'error', message: 'Database connection failed' });
    }
});

app.use('/api/auth', authRoutes);
app.use('/api/academic-years', academicYearRoutes);
app.use('/api/terms', termRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/parents', parentRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/fee-structures', feeStructureRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/public', publicPaymentRoutes);
app.use('/api/arrears', arrearsRoutes);
app.use('/api/sms-templates', smsTemplateRoutes);
app.use('/api/reminders', reminderRoutes);
app.use('/api/scheduled-jobs', scheduledJobRoutes);
app.use('/api/cron', cronRoutes);
app.use('/api/settings', schoolSettingsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/audit-logs', auditLogRoutes);

app.use((req, res) => {
    res.status(404).json({ status: 'error', message: 'Not found.' });
});

app.use((err, req, res, next) => {
    console.error(err);
    res.status(400).json({ status: 'error', message: err.message || 'Something went wrong.' });
});

const PORT = process.env.PORT || 5100;
if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`SmartPay server is running on port ${PORT}`);
    });
}

module.exports = app;
