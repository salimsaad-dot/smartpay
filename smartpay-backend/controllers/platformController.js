const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { clientIp } = require('../utils/clientIp');
const { PLATFORM_COOKIE } = require('../middleware/platformAuth');
const { createSchoolWithAdmin } = require('../utils/schoolProvisioning');
const { ACCESS_COLUMNS_SQL, describeAccess, billingSummary } = require('../utils/schoolAccess');

// The SmartPay owner console (added 2026-10-15): the platform owner creates
// schools, sets how long each has paid for, suspends and reactivates them,
// and resets a school admin's password. Nothing here is reachable with a
// school login; see middleware/platformAuth.js.

const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

function cookieOptions() {
    return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' };
}

// Readable one-time passwords for new school admins: no 0/O or 1/l/I to
// misread when the owner reads it out over the phone.
function generateTempPassword() {
    const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.randomBytes(12);
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

// Owner actions go into the school's own audit log (user_id NULL marks
// them as done by SmartPay, not by anyone at the school), so the school
// can see when and why its access changed.
async function logPlatformAction(req, schoolId, action, oldValues, newValues) {
    try {
        await pool.query(
            `INSERT INTO audit_logs (school_id, user_id, action, entity_type, entity_id, old_values_json, new_values_json, ip_address, user_agent)
             VALUES (?, NULL, ?, 'school', ?, ?, ?, ?, ?)`,
            [schoolId, action, schoolId, oldValues ? JSON.stringify(oldValues) : null,
                JSON.stringify({ ...newValues, by: req.platformAdmin.email }), clientIp(req), (req.headers['user-agent'] || '').slice(0, 255)]
        );
    } catch (error) {
        console.error('Audit log write failed (action proceeded anyway):', action, error);
    }
}

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body || {};
        if (!email || !password) {
            return res.status(400).json({ status: 'error', message: 'Please enter your email and password.' });
        }
        const [[admin]] = await pool.query('SELECT * FROM platform_admins WHERE email = ?', [String(email).trim().toLowerCase()]);
        if (!admin) {
            return res.status(401).json({ status: 'error', message: 'Invalid email or password.' });
        }
        if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
            return res.status(423).json({ status: 'error', message: 'Too many failed attempts. Try again in a few minutes.' });
        }
        if (!(await bcrypt.compare(password, admin.password_hash))) {
            const attempts = admin.failed_login_attempts + 1;
            const lockedUntil = attempts >= MAX_FAILED_LOGIN_ATTEMPTS ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null;
            await pool.query('UPDATE platform_admins SET failed_login_attempts = ?, locked_until = ? WHERE id = ?', [lockedUntil ? 0 : attempts, lockedUntil, admin.id]);
            return res.status(401).json({ status: 'error', message: 'Invalid email or password.' });
        }
        await pool.query('UPDATE platform_admins SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?', [admin.id]);

        const token = jwt.sign({ kind: 'platform', platformAdminId: admin.id, tokenVersion: admin.token_version }, process.env.JWT_SECRET, { expiresIn: '12h' });
        res.cookie(PLATFORM_COOKIE, token, { ...cookieOptions(), maxAge: 12 * 60 * 60 * 1000 });
        res.status(200).json({ status: 'success', data: { name: admin.name, email: admin.email } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error during login.' });
    }
};

exports.logout = (req, res) => {
    res.clearCookie(PLATFORM_COOKIE, cookieOptions());
    res.status(200).json({ status: 'success', message: 'Logged out.' });
};

exports.getMe = (req, res) => {
    res.status(200).json({ status: 'success', data: req.platformAdmin });
};

exports.listSchools = async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT s.id, s.name, s.code, s.created_at, ${ACCESS_COLUMNS_SQL},
                    (SELECT u.name FROM users u WHERE u.school_id = s.id AND u.role = 'school_admin' ORDER BY u.id LIMIT 1) AS admin_name,
                    (SELECT u.email FROM users u WHERE u.school_id = s.id AND u.role = 'school_admin' ORDER BY u.id LIMIT 1) AS admin_email,
                    (SELECT MAX(u.last_login_at) FROM users u WHERE u.school_id = s.id) AS last_login_at,
                    (SELECT COUNT(*) FROM students st WHERE st.school_id = s.id AND st.status = 'active') AS student_count,
                    (SELECT COUNT(*) FROM sms_reminders r WHERE r.school_id = s.id AND r.status IN ('sent', 'delivered')
                        AND r.created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')) AS sms_this_month
             FROM schools s
             ORDER BY s.created_at DESC`
        );
        const schools = rows.map((row) => {
            const access = describeAccess(row);
            return {
                id: row.id,
                name: row.name,
                code: row.code,
                createdAt: row.created_at,
                adminName: row.admin_name,
                adminEmail: row.admin_email,
                lastLoginAt: row.last_login_at,
                studentCount: Number(row.student_count),
                smsThisMonth: Number(row.sms_this_month),
                status: row.school_status,
                state: access.blocked ? access.reason : 'active',
                ...billingSummary(row),
            };
        });
        res.status(200).json({ status: 'success', data: schools });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while loading schools.' });
    }
};

exports.createSchool = async (req, res) => {
    try {
        const { schoolName, code, adminName, email } = req.body || {};
        const paidUntil = req.body?.paidUntil || null;
        const tempPassword = generateTempPassword();
        const created = await createSchoolWithAdmin({ schoolName, code, adminName, email, password: tempPassword, paidUntil });
        await logPlatformAction(req, created.schoolId, 'platform.school_created', null, { paidUntil });
        res.status(201).json({
            status: 'success',
            message: 'School created.',
            // Shown to the owner once, to pass on to the school. Never stored
            // in plain text; the school admin can change it under Account.
            data: { schoolId: created.schoolId, code: created.code, adminEmail: String(email).trim().toLowerCase(), tempPassword },
        });
    } catch (error) {
        if (error.status) return res.status(error.status).json({ status: 'error', message: error.message });
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while creating the school.' });
    }
};

// Body: { status?: 'active' | 'suspended', paidUntil?: 'YYYY-MM-DD' | null }
// paidUntil null removes the expiry (the school never lapses).
exports.updateSchool = async (req, res) => {
    try {
        const schoolId = Number(req.params.id);
        const body = req.body || {};
        const updates = {};
        if (body.status !== undefined) {
            if (!['active', 'suspended'].includes(body.status)) {
                return res.status(400).json({ status: 'error', message: 'Status must be active or suspended.' });
            }
            updates.status = body.status;
        }
        if (body.paidUntil !== undefined) {
            if (body.paidUntil !== null && !DATE_SHAPE.test(body.paidUntil)) {
                return res.status(400).json({ status: 'error', message: 'Paid-until must be a date (YYYY-MM-DD), or empty for no expiry.' });
            }
            updates.paid_until = body.paidUntil;
        }
        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ status: 'error', message: 'Nothing to update.' });
        }

        const [[before]] = await pool.query(`SELECT s.id, ${ACCESS_COLUMNS_SQL} FROM schools s WHERE s.id = ?`, [schoolId]);
        if (!before) return res.status(404).json({ status: 'error', message: 'School not found.' });

        const columns = Object.keys(updates);
        await pool.query(`UPDATE schools SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...columns.map((c) => updates[c]), schoolId]);

        const action = updates.status === 'suspended' ? 'platform.school_suspended'
            : updates.status === 'active' ? 'platform.school_reactivated'
                : 'platform.subscription_updated';
        await logPlatformAction(req, schoolId, action,
            { status: before.school_status, paidUntil: before.paid_until },
            { status: updates.status ?? before.school_status, paidUntil: 'paid_until' in updates ? updates.paid_until : before.paid_until });

        res.status(200).json({ status: 'success', message: 'School updated.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while updating the school.' });
    }
};

// For a school admin who is locked out: password reset by email can't
// reach them while email runs on Resend's sandbox sender, so the owner
// issues a new one-time password instead. Bumping token_version signs out
// every existing session for that admin.
exports.resetAdminPassword = async (req, res) => {
    try {
        const schoolId = Number(req.params.id);
        const [[admin]] = await pool.query(
            `SELECT id, email FROM users WHERE school_id = ? AND role = 'school_admin' ORDER BY id LIMIT 1`,
            [schoolId]
        );
        if (!admin) return res.status(404).json({ status: 'error', message: 'No admin account found for that school.' });

        const tempPassword = generateTempPassword();
        const hash = await bcrypt.hash(tempPassword, 10);
        await pool.query(
            'UPDATE users SET password_hash = ?, token_version = token_version + 1, failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
            [hash, admin.id]
        );
        await logPlatformAction(req, schoolId, 'platform.admin_password_reset', null, { adminEmail: admin.email });
        res.status(200).json({ status: 'success', data: { adminEmail: admin.email, tempPassword } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while resetting the password.' });
    }
};
