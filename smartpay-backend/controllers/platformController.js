const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { clientIp } = require('../utils/clientIp');
const loginThrottle = require('../utils/loginThrottle');
const totp = require('../utils/totp');

const DUMMY_PASSWORD_HASH = bcrypt.hashSync('not-a-real-password-placeholder', 10);
const { PLATFORM_COOKIE, PLATFORM_MFA_COOKIE } = require('../middleware/platformAuth');
const { createSchoolWithAdmin } = require('../utils/schoolProvisioning');
const { ACCESS_COLUMNS_SQL, describeAccess, billingSummary } = require('../utils/schoolAccess');

// The SmartPay owner console (added 2026-10-15): the platform owner creates
// schools, sets how long each has paid for, suspends and reactivates them,
// and resets a school admin's password. Nothing here is reachable with a
// school login; see middleware/platformAuth.js.

// A real calendar date in YYYY-MM-DD (rejects 2026-13-45 or 2026-02-30,
// which used to reach MySQL and fail with a 500).
function isRealDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

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

// Passwords the owner hands out (new school, admin reset) travel by
// WhatsApp or phone, so they work for 72 hours and must be replaced at
// first login (verifyToken allows nothing else until then).
const ONE_TIME_PASSWORD_HOURS = 72;
const MFA_STEP_MINUTES = 5;

async function markOneTimePassword(userId) {
    await pool.query(
        'UPDATE users SET must_change_password = 1, temp_password_expires_at = NOW() + INTERVAL ? HOUR WHERE id = ?',
        [ONE_TIME_PASSWORD_HOURS, userId]
    );
}

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body || {};
        if (!email || !password) {
            return res.status(400).json({ status: 'error', message: 'Please enter your email and password.' });
        }
        const [[admin]] = await pool.query('SELECT * FROM platform_admins WHERE email = ?', [String(email).trim().toLowerCase()]);
        if (!admin) {
            await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
            return res.status(401).json({ status: 'error', message: 'Invalid email or password.' });
        }
        // Per (account, visitor address), so nobody can lock the owner out
        // from elsewhere (utils/loginThrottle.js).
        const ip = clientIp(req);
        if (await loginThrottle.isLocked('platform', admin.id, ip)) {
            return res.status(423).json({ status: 'error', message: 'Too many failed attempts from this device. Try again in a few minutes.' });
        }
        if (!(await bcrypt.compare(password, admin.password_hash))) {
            await loginThrottle.recordFailure('platform', admin.id, ip, { label: `SmartPay console (${admin.email})` });
            return res.status(401).json({ status: 'error', message: 'Invalid email or password.' });
        }
        await loginThrottle.clearFailures('platform', admin.id, ip);

        // The console can change every school's access, so a password alone
        // is never enough (2026-10-16). Setting up the authenticator needs
        // database access (scripts/setup-console-2fa.js), so a stolen
        // password can't enrol the thief's phone.
        if (!admin.totp_secret) {
            return res.status(403).json({
                status: 'error', code: 'MFA_SETUP_REQUIRED',
                message: 'Two-step login is not set up for this account yet. Run scripts/setup-console-2fa.js with your email, then log in again.',
            });
        }
        const pending = jwt.sign({ kind: 'platform_mfa', platformAdminId: admin.id, tokenVersion: admin.token_version }, process.env.JWT_SECRET, { expiresIn: MFA_STEP_MINUTES * 60 });
        res.cookie(PLATFORM_MFA_COOKIE, pending, { ...cookieOptions(), maxAge: MFA_STEP_MINUTES * 60 * 1000 });
        res.status(200).json({ status: 'success', data: { mfaRequired: true } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error during login.' });
    }
};

// Step two: the 6-digit code from the owner's authenticator app.
exports.verifyCode = async (req, res) => {
    try {
        let decoded;
        try {
            decoded = jwt.verify(req.cookies?.[PLATFORM_MFA_COOKIE] || '', process.env.JWT_SECRET, { algorithms: ['HS256'] });
        } catch {
            decoded = null;
        }
        if (decoded?.kind !== 'platform_mfa') {
            return res.status(401).json({ status: 'error', code: 'MFA_STEP_EXPIRED', message: 'Please enter your email and password again.' });
        }
        const [[admin]] = await pool.query('SELECT * FROM platform_admins WHERE id = ?', [decoded.platformAdminId]);
        if (!admin || admin.token_version !== decoded.tokenVersion || !admin.totp_secret) {
            return res.status(401).json({ status: 'error', code: 'MFA_STEP_EXPIRED', message: 'Please enter your email and password again.' });
        }

        const ip = clientIp(req);
        if (await loginThrottle.isLocked('platform_mfa', admin.id, ip)) {
            return res.status(423).json({ status: 'error', message: 'Too many wrong codes from this device. Try again in a few minutes.' });
        }
        // A code is only good once: totp_last_step moves forward with a
        // guarded UPDATE, so even two requests at the same moment can't
        // both use it.
        const lastStep = admin.totp_last_step === null ? null : Number(admin.totp_last_step);
        const step = totp.verify(admin.totp_secret, req.body?.code, { afterStep: lastStep });
        const [claimed] = step === null ? [{ affectedRows: 0 }] : await pool.query(
            'UPDATE platform_admins SET totp_last_step = ?, last_login_at = NOW() WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)',
            [step, admin.id, step]
        );
        if (claimed.affectedRows !== 1) {
            await loginThrottle.recordFailure('platform_mfa', admin.id, ip, { label: `SmartPay console code (${admin.email})` });
            return res.status(401).json({ status: 'error', message: "That code isn't right. Use the newest code in your authenticator app." });
        }
        await loginThrottle.clearFailures('platform_mfa', admin.id, ip);

        const token = jwt.sign({ kind: 'platform', mfa: true, platformAdminId: admin.id, tokenVersion: admin.token_version }, process.env.JWT_SECRET, { expiresIn: '12h' });
        res.clearCookie(PLATFORM_MFA_COOKIE, cookieOptions());
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

// The owner changes their own console password (2026-10-16; before, only
// create-platform-admin.js could). Needs the current password AND a fresh
// authenticator code, so a session left open on someone else's computer
// isn't enough to take the account over. Every other console session is
// signed out; this one gets a new cookie and stays in.
const MIN_OWNER_PASSWORD = 10;
exports.changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword, code } = req.body || {};
        if (!currentPassword || !newPassword || !code) {
            return res.status(400).json({ status: 'error', message: 'Enter your current password, a new password and the code from your app.' });
        }
        if (String(newPassword).length < MIN_OWNER_PASSWORD) {
            return res.status(400).json({ status: 'error', message: `The new password must be at least ${MIN_OWNER_PASSWORD} characters.` });
        }
        if (newPassword === currentPassword) {
            return res.status(400).json({ status: 'error', message: 'Choose a password different from your current one.' });
        }
        const [[admin]] = await pool.query('SELECT * FROM platform_admins WHERE id = ?', [req.platformAdmin.id]);
        const ip = clientIp(req);
        if (await loginThrottle.isLocked('platform', admin.id, ip) || await loginThrottle.isLocked('platform_mfa', admin.id, ip)) {
            return res.status(423).json({ status: 'error', message: 'Too many failed attempts from this device. Try again in a few minutes.' });
        }
        if (!(await bcrypt.compare(currentPassword, admin.password_hash))) {
            await loginThrottle.recordFailure('platform', admin.id, ip, { label: `SmartPay console (${admin.email})` });
            return res.status(401).json({ status: 'error', message: 'Your current password is not right.' });
        }
        const lastStep = admin.totp_last_step === null ? null : Number(admin.totp_last_step);
        const step = totp.verify(admin.totp_secret, code, { afterStep: lastStep });
        const hash = await bcrypt.hash(String(newPassword), 10);
        // One guarded UPDATE: uses up the code (it can't be replayed) and
        // swaps the password together.
        const [changed] = step === null ? [{ affectedRows: 0 }] : await pool.query(
            `UPDATE platform_admins SET password_hash = ?, totp_last_step = ?, token_version = token_version + 1
             WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)`,
            [hash, step, admin.id, step]
        );
        if (changed.affectedRows !== 1) {
            await loginThrottle.recordFailure('platform_mfa', admin.id, ip, { label: `SmartPay console code (${admin.email})` });
            return res.status(401).json({ status: 'error', message: "That code isn't right. Use the newest code in your authenticator app." });
        }
        const token = jwt.sign({ kind: 'platform', mfa: true, platformAdminId: admin.id, tokenVersion: admin.token_version + 1 }, process.env.JWT_SECRET, { expiresIn: '12h' });
        res.cookie(PLATFORM_COOKIE, token, { ...cookieOptions(), maxAge: 12 * 60 * 60 * 1000 });
        res.status(200).json({ status: 'success', message: 'Password changed. Other console sessions were signed out.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while changing the password.' });
    }
};

exports.getMe = (req, res) => {
    res.status(200).json({ status: 'success', data: req.platformAdmin });
};

exports.listSchools = async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT s.id, s.name, s.code, s.created_at, s.sms_monthly_limit, ${ACCESS_COLUMNS_SQL},
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
                smsMonthlyLimit: row.sms_monthly_limit === null ? null : Number(row.sms_monthly_limit),
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
        await markOneTimePassword(created.userId);
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
            if (body.paidUntil !== null && !isRealDate(body.paidUntil)) {
                return res.status(400).json({ status: 'error', message: 'Paid-until must be a date (YYYY-MM-DD), or empty for no expiry.' });
            }
            updates.paid_until = body.paidUntil;
        }
        if (body.smsMonthlyLimit !== undefined) {
            const limit = body.smsMonthlyLimit === null || body.smsMonthlyLimit === '' ? null : Number(body.smsMonthlyLimit);
            if (limit !== null && (!Number.isInteger(limit) || limit < 0 || limit > 1000000)) {
                return res.status(400).json({ status: 'error', message: 'SMS allowance must be a whole number, or empty for no limit.' });
            }
            updates.sms_monthly_limit = limit;
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
                : 'sms_monthly_limit' in updates && !('paid_until' in updates) ? 'platform.sms_allowance_updated'
                    : 'platform.subscription_updated';
        await logPlatformAction(req, schoolId, action,
            { status: before.school_status, paidUntil: before.paid_until },
            { status: updates.status ?? before.school_status, paidUntil: 'paid_until' in updates ? updates.paid_until : before.paid_until,
                ...('sms_monthly_limit' in updates ? { smsMonthlyLimit: updates.sms_monthly_limit } : {}) });

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
        // Optional adminUserId picks which admin, for when a school has more
        // than one; it must belong to this school. Default: the first admin.
        const adminUserId = req.body?.adminUserId ? Number(req.body.adminUserId) : null;
        const [[admin]] = await pool.query(
            `SELECT id, email FROM users WHERE school_id = ? AND role = 'school_admin'${adminUserId ? ' AND id = ?' : ''} ORDER BY id LIMIT 1`,
            adminUserId ? [schoolId, adminUserId] : [schoolId]
        );
        if (!admin) return res.status(404).json({ status: 'error', message: 'No admin account found for that school.' });

        const tempPassword = generateTempPassword();
        const hash = await bcrypt.hash(tempPassword, 10);
        await pool.query(
            'UPDATE users SET password_hash = ?, token_version = token_version + 1, failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
            [hash, admin.id]
        );
        await markOneTimePassword(admin.id);
        await pool.query("DELETE FROM login_attempts WHERE scope = 'school' AND account_id = ?", [admin.id]);
        await logPlatformAction(req, schoolId, 'platform.admin_password_reset', null, { adminEmail: admin.email });
        res.status(200).json({ status: 'success', data: { adminEmail: admin.email, tempPassword } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while resetting the password.' });
    }
};
