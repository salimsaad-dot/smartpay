const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { isValidCode } = require('../utils/schoolCode');
const { DEFAULT_TEMPLATE_NAME, DEFAULT_TEMPLATE_BODY } = require('../utils/smsTemplate');
const { logAction, logAuthEvent } = require('../utils/auditLog');
// Required as a module object, never destructured — a test that spies
// on this module (jest.spyOn(emailSender, 'sendPasswordResetEmail'))
// only intercepts calls made through the module object itself. This is
// the exact mock-target-mismatch class of bug this project already hit
// once with SMS provider testing (see smartpay/DESIGN.md's Decisions
// Log) — same fix, applied here before it could repeat the same way.
const emailSender = require('../utils/emailSender');

// Same proven shape as Academia Hub's own forgot/reset-password flow —
// a single admin per school with no recovery path at all was a real,
// not hypothetical, risk: the password-change work from the earlier
// security audit only covers a user who's already logged in and
// remembers their current password. This closes the "forgot it
// entirely, now locked out of the whole school" gap underneath it.
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

function hashResetToken(rawToken) {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
}

// Same cookie-options shape as Academia Hub, same reasoning: sameSite
// 'lax' works as long as the frontend proxies /api/* through its own
// origin (see smartpay-frontend/next.config.js), so the browser never
// sees the request as cross-site.
function authCookieOptions() {
    const isProd = process.env.NODE_ENV === 'production';
    return {
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
    };
}

function signToken(user) {
    return jwt.sign(
        { userId: user.id, role: user.role, tokenVersion: user.token_version },
        process.env.JWT_SECRET,
        { expiresIn: '1d' }
    );
}

// Per-account lockout, added alongside the existing per-IP login rate
// limit — a credential-stuffing run spread across many IPs, or a slow
// brute-force within the (deliberately generous) per-IP budget, wasn't
// mitigated by the IP limit alone. 5 wrong passwords locks the account
// for 15 minutes regardless of source IP; a correct login always clears
// both counters.
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

// Creates a school + its first school_admin user in a single transaction.
// Unlike Academia Hub's one-time-ever bootstrap (gated by "is the whole
// users table empty"), this is a permanently open, repeatable public
// endpoint — every new school signs up this way. Two schools racing for
// the same code is a real scenario, not theoretical: relies on the DB's
// own UNIQUE KEY on schools.code (caught below as ER_DUP_ENTRY) rather
// than a SELECT-then-INSERT pre-check, which would be a TOCTOU gap.
exports.registerSchool = async (req, res) => {
    const { schoolName, code, adminName, email, password } = req.body;

    if (!schoolName?.trim() || !code?.trim() || !adminName?.trim() || !email?.trim() || !password) {
        return res.status(400).json({ status: 'error', message: 'School name, code, admin name, email, and password are all required.' });
    }
    const normalizedCode = code.trim().toLowerCase();
    if (!isValidCode(normalizedCode)) {
        return res.status(400).json({ status: 'error', message: 'Code must be 3-30 characters, lowercase letters/numbers/hyphens only, and not a reserved word.' });
    }
    if (password.length < 8) {
        return res.status(400).json({ status: 'error', message: 'Password must be at least 8 characters.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [schoolResult] = await connection.query(
            'INSERT INTO schools (name, code) VALUES (?, ?)',
            [schoolName.trim(), normalizedCode]
        );
        const schoolId = schoolResult.insertId;

        const passwordHash = await bcrypt.hash(password, 10);
        const [userResult] = await connection.query(
            'INSERT INTO users (school_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
            [schoolId, adminName.trim(), email.trim().toLowerCase(), passwordHash, 'school_admin']
        );

        // A school can send a reminder immediately without configuring
        // anything first — matches the "replacement for a failed, overly
        // complicated system" premise this product exists for.
        await connection.query(
            `INSERT INTO sms_templates (school_id, name, body, type) VALUES (?, ?, ?, 'manual_reminder')`,
            [schoolId, DEFAULT_TEMPLATE_NAME, DEFAULT_TEMPLATE_BODY]
        );

        await connection.commit();

        const token = signToken({ id: userResult.insertId, role: 'school_admin', token_version: 1 });
        res.cookie('token', token, { ...authCookieOptions(), maxAge: 24 * 60 * 60 * 1000 });

        res.status(201).json({
            status: 'success',
            message: 'School registered.',
            data: { schoolId, schoolName: schoolName.trim(), code: normalizedCode, userId: userResult.insertId, role: 'school_admin' },
        });
    } catch (error) {
        await connection.rollback();
        if (error.code === 'ER_DUP_ENTRY') {
            const field = error.sqlMessage?.includes('unique_code') ? 'That school code is' : 'That email is';
            return res.status(409).json({ status: 'error', message: `${field} already taken.` });
        }
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while registering the school.' });
    } finally {
        connection.release();
    }
};

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ status: 'error', message: 'Please provide both email and password.' });
        }

        const [[user]] = await pool.query('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);
        if (!user) {
            return res.status(401).json({ status: 'error', message: 'Invalid email or password.' });
        }
        if (user.status !== 'active') {
            return res.status(403).json({ status: 'error', message: 'Account is deactivated. Contact your administrator.' });
        }
        if (user.locked_until && new Date(user.locked_until) > new Date()) {
            await logAuthEvent(req, { schoolId: user.school_id, userId: user.id, action: 'auth.login_blocked' });
            return res.status(423).json({ status: 'error', message: 'Too many failed attempts. Try again in a few minutes.' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password_hash);
        if (!isPasswordValid) {
            const attempts = user.failed_login_attempts + 1;
            const lockedUntil = attempts >= MAX_FAILED_LOGIN_ATTEMPTS ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null;
            await pool.query(
                'UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?',
                [lockedUntil ? 0 : attempts, lockedUntil, user.id]
            );
            await logAuthEvent(req, { schoolId: user.school_id, userId: user.id, action: 'auth.login_failed' });
            if (lockedUntil) {
                await logAuthEvent(req, { schoolId: user.school_id, userId: user.id, action: 'auth.account_locked' });
            }
            return res.status(401).json({ status: 'error', message: 'Invalid email or password.' });
        }

        await pool.query(
            'UPDATE users SET last_login_at = NOW(), failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
            [user.id]
        );
        await logAuthEvent(req, { schoolId: user.school_id, userId: user.id, action: 'auth.login_success' });

        const [[school]] = await pool.query('SELECT id, name, code, currency FROM schools WHERE id = ?', [user.school_id]);

        const token = signToken(user);
        res.cookie('token', token, { ...authCookieOptions(), maxAge: 24 * 60 * 60 * 1000 });

        res.status(200).json({
            status: 'success',
            message: 'Login successful.',
            data: {
                userId: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                school: { id: school.id, name: school.name, code: school.code, currency: school.currency },
            },
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error during login.' });
    }
};

exports.logout = (req, res) => {
    res.clearCookie('token', authCookieOptions());
    res.status(200).json({ status: 'success', message: 'Logged out.' });
};

// Public — runs before any session exists. Always returns the same
// generic message regardless of whether the email matches a real
// account (standard enumeration-prevention) — this response can never
// be used to probe which emails have SmartPay accounts.
exports.forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ status: 'error', message: 'Please provide your email address.' });
        }

        const GENERIC_MESSAGE = 'If an account matches that email, a reset link has been sent to it.';

        // Static and identical on every branch below (including the
        // early return for a non-matching email, which never attempts a
        // send) so it can never be used to tell a real account from a
        // fake one by comparing responses.
        const emailDeliveryConfigured = emailSender.isEmailDeliveryConfigured();

        const [[user]] = await pool.query('SELECT id, email FROM users WHERE email = ?', [email.trim().toLowerCase()]);
        if (!user) {
            return res.status(200).json({ status: 'success', message: GENERIC_MESSAGE, emailDeliveryConfigured });
        }

        const rawToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
        await pool.query(
            'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
            [user.id, hashResetToken(rawToken), expiresAt]
        );

        const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${rawToken}`;
        await emailSender.sendPasswordResetEmail(user.email, resetLink);

        res.status(200).json({ status: 'success', message: GENERIC_MESSAGE, emailDeliveryConfigured });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while processing the reset request.' });
    }
};

// Public — the token itself is the proof of identity here, same
// principle as any emailed reset link. Bumps token_version, same as
// changePassword, so any session the forgotten-password account might
// still have open elsewhere (e.g. on a device the real owner is
// currently using) is killed by this reset too.
exports.resetPasswordWithToken = async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) {
            return res.status(400).json({ status: 'error', message: 'A token and newPassword are both required.' });
        }
        if (newPassword.length < 8) {
            return res.status(400).json({ status: 'error', message: 'New password must be at least 8 characters.' });
        }

        const [[resetRow]] = await pool.query(
            'SELECT reset_token_id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ?',
            [hashResetToken(token)]
        );
        if (!resetRow || resetRow.used_at || new Date(resetRow.expires_at) < new Date()) {
            return res.status(400).json({ status: 'error', message: 'This reset link is invalid or has expired. Please request a new one.' });
        }

        const newHash = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', [newHash, resetRow.user_id]);
        await pool.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE reset_token_id = ?', [resetRow.reset_token_id]);

        const [[user]] = await pool.query('SELECT school_id FROM users WHERE id = ?', [resetRow.user_id]);
        await logAuthEvent(req, { schoolId: user.school_id, userId: resetRow.user_id, action: 'auth.password_reset' });

        res.status(200).json({ status: 'success', message: 'Password reset. You can now log in with your new password.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while resetting your password.' });
    }
};

// Session-restore endpoint — the frontend's AuthContext calls this on
// mount to find out who the httpOnly cookie belongs to, since it can
// never read the cookie itself.
exports.getMe = async (req, res) => {
    try {
        const [[user]] = await pool.query('SELECT id, school_id, name, email, role FROM users WHERE id = ?', [req.user.userId]);
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'Account not found.' });
        }
        const [[school]] = await pool.query('SELECT id, name, code, currency FROM schools WHERE id = ?', [user.school_id]);

        res.status(200).json({
            status: 'success',
            data: {
                userId: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                school: { id: school.id, name: school.name, code: school.code, currency: school.currency },
            },
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while fetching account info.' });
    }
};

// No password-change endpoint existed before this — meaning token_version
// (the session-revocation field verifyToken already checks on every
// request) was never incremented anywhere, making revocation structurally
// unreachable. This is the fix: changing the password bumps token_version,
// which immediately invalidates every OTHER already-issued token for this
// user — while this request's own session stays valid by re-signing a
// fresh token against the new version below.
exports.changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ status: 'error', message: 'Current and new password are both required.' });
        }
        if (newPassword.length < 8) {
            return res.status(400).json({ status: 'error', message: 'New password must be at least 8 characters.' });
        }

        const [[user]] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.userId]);
        const isCurrentValid = await bcrypt.compare(currentPassword, user.password_hash);
        if (!isCurrentValid) {
            return res.status(401).json({ status: 'error', message: 'Current password is incorrect.' });
        }

        const newHash = await bcrypt.hash(newPassword, 10);
        const newTokenVersion = user.token_version + 1;
        await pool.query(
            'UPDATE users SET password_hash = ?, token_version = ? WHERE id = ?',
            [newHash, newTokenVersion, user.id]
        );

        const token = signToken({ id: user.id, role: user.role, token_version: newTokenVersion });
        res.cookie('token', token, { ...authCookieOptions(), maxAge: 24 * 60 * 60 * 1000 });

        await logAction(req, { action: 'auth.password_changed', entityType: 'user', entityId: user.id });

        res.status(200).json({ status: 'success', message: 'Password changed. Other devices have been signed out.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while changing the password.' });
    }
};

// Manual kill-switch for a suspected compromise (stolen device, a session
// that should be treated as untrusted right now) — deliberately separate
// from changePassword since the two scenarios differ: here the account
// owner may not be ready or able to set a new password yet, but wants
// every existing token dead immediately, including the one making this
// request. Bumps token_version (killing every session everywhere) and
// clears this device's own cookie too, so the only way back in for anyone
// is a fresh login.
exports.revokeSessions = async (req, res) => {
    try {
        await pool.query('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [req.user.userId]);
        await logAction(req, { action: 'auth.sessions_revoked', entityType: 'user', entityId: req.user.userId });
        res.clearCookie('token', authCookieOptions());
        res.status(200).json({ status: 'success', message: 'All sessions revoked. Please log in again.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while revoking sessions.' });
    }
};

