const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { createSchoolWithAdmin } = require('../utils/schoolProvisioning');
const { ACCESS_COLUMNS_SQL, describeAccess, billingSummary } = require('../utils/schoolAccess');
const { logAction, logAuthEvent } = require('../utils/auditLog');
// Required as a module object, never destructured — a test that spies
// on this module (jest.spyOn(emailSender, 'sendPasswordResetEmail'))
// only intercepts calls made through the module object itself. This is
// the exact mock-target-mismatch class of bug this project already hit
// once with SMS provider testing (see smartpay/DESIGN.md's Decisions
// Log) — same fix, applied here before it could repeat the same way.
const emailSender = require('../utils/emailSender');
const loginThrottle = require('../utils/loginThrottle');
const { clientIp } = require('../utils/clientIp');

// Compared against when the email is unknown, so a wrong email takes as long
// as a wrong password and response time can't reveal which emails exist.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('not-a-real-password-placeholder', 10);

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

// Failed logins lock per (account, visitor address) since 2026-10-16
// (utils/loginThrottle.js). The earlier account-wide lock let anyone keep
// a school's only admin locked out from anywhere.

// Test-only since 2026-10-15: schools are created by the platform owner in
// the console (platformController.createSchool), never by public sign-up.
// server.js mounts this route only when NODE_ENV === 'test', because the
// backend test suite creates its throwaway schools through it.
exports.registerSchool = async (req, res) => {
    try {
        const { schoolName, code, adminName, email, password } = req.body;
        const created = await createSchoolWithAdmin({ schoolName, code, adminName, email, password });

        const token = signToken({ id: created.userId, role: 'school_admin', token_version: 1 });
        res.cookie('token', token, { ...authCookieOptions(), maxAge: 24 * 60 * 60 * 1000 });

        res.status(201).json({
            status: 'success',
            message: 'School registered.',
            data: { schoolId: created.schoolId, schoolName: created.schoolName, code: created.code, userId: created.userId, role: 'school_admin' },
        });
    } catch (error) {
        if (error.status) return res.status(error.status).json({ status: 'error', message: error.message });
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while registering the school.' });
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
            await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
            return res.status(401).json({ status: 'error', message: 'Invalid email or password.' });
        }

        // Lockout is per (account, visitor address): see utils/loginThrottle.js.
        const ip = clientIp(req);
        if (await loginThrottle.isLocked('school', user.id, ip)) {
            await logAuthEvent(req, { schoolId: user.school_id, userId: user.id, action: 'auth.login_blocked' });
            return res.status(423).json({ status: 'error', message: 'Too many failed attempts from this device. Try again in a few minutes.' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password_hash);
        if (!isPasswordValid) {
            await pool.query('UPDATE users SET failed_login_attempts = failed_login_attempts + 1 WHERE id = ?', [user.id]);
            await logAuthEvent(req, { schoolId: user.school_id, userId: user.id, action: 'auth.login_failed' });
            if (await loginThrottle.recordFailure('school', user.id, ip, { label: user.email })) {
                await logAuthEvent(req, { schoolId: user.school_id, userId: user.id, action: 'auth.account_locked' });
            }
            return res.status(401).json({ status: 'error', message: 'Invalid email or password.' });
        }
        await loginThrottle.clearFailures('school', user.id, ip);

        // Only revealed to someone who knows the password.
        if (user.status !== 'active') {
            return res.status(403).json({ status: 'error', message: 'Account is deactivated. Contact your administrator.' });
        }
        // A one-time password from the SmartPay owner works for 72 hours.
        if (user.must_change_password && user.temp_password_expires_at && new Date(user.temp_password_expires_at) < new Date()) {
            return res.status(403).json({ status: 'error', code: 'TEMP_PASSWORD_EXPIRED', message: 'This one-time password has expired. Ask SmartPay for a new one.' });
        }

        // Checked only after the password is right, so a stranger can't
        // probe which schools are suspended.
        const [[school]] = await pool.query(
            `SELECT s.id, s.name, s.code, s.currency, ${ACCESS_COLUMNS_SQL} FROM schools s WHERE s.id = ?`,
            [user.school_id]
        );
        const access = describeAccess(school);
        if (access.blocked) {
            await logAuthEvent(req, { schoolId: user.school_id, userId: user.id, action: `auth.login_school_${access.reason}` });
            return res.status(403).json({ status: 'error', code: 'SCHOOL_BLOCKED', reason: access.reason, message: access.message });
        }

        await pool.query(
            'UPDATE users SET last_login_at = NOW(), failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
            [user.id]
        );
        await logAuthEvent(req, { schoolId: user.school_id, userId: user.id, action: 'auth.login_success' });

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
                mustChangePassword: Boolean(user.must_change_password),
                school: { id: school.id, name: school.name, code: school.code, currency: school.currency, billing: billingSummary(school) },
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
        await pool.query('UPDATE users SET password_hash = ?, token_version = token_version + 1, must_change_password = 0, temp_password_expires_at = NULL WHERE id = ?', [newHash, resetRow.user_id]);
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
        const [[user]] = await pool.query('SELECT id, school_id, name, email, role, must_change_password FROM users WHERE id = ?', [req.user.userId]);
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'Account not found.' });
        }
        const [[school]] = await pool.query(
            `SELECT s.id, s.name, s.code, s.currency, ${ACCESS_COLUMNS_SQL} FROM schools s WHERE s.id = ?`,
            [user.school_id]
        );

        res.status(200).json({
            status: 'success',
            data: {
                userId: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                mustChangePassword: Boolean(user.must_change_password),
                school: { id: school.id, name: school.name, code: school.code, currency: school.currency, billing: billingSummary(school) },
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
            'UPDATE users SET password_hash = ?, token_version = ?, must_change_password = 0, temp_password_expires_at = NULL WHERE id = ?',
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

