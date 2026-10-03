const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { isValidCode } = require('../utils/schoolCode');
const { DEFAULT_TEMPLATE_NAME, DEFAULT_TEMPLATE_BODY } = require('../utils/smsTemplate');

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

        const isPasswordValid = await bcrypt.compare(password, user.password_hash);
        if (!isPasswordValid) {
            return res.status(401).json({ status: 'error', message: 'Invalid email or password.' });
        }

        await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);

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

