const jwt = require('jsonwebtoken');
const pool = require('../db');

// Guards the owner console (/api/platform/*). Separate from verifyToken in
// every way that matters: its own cookie (platform_token), its own token
// kind ('platform'), and its own table (platform_admins), so a school
// admin's session can never reach these routes and a console session can
// never act as a school. token_version gives the same instant revocation
// as school logins (re-running create-platform-admin.js bumps it).
//
// A console session needs both steps (password, then the authenticator
// code; see platformController.verifyCode). Tokens carry mfa: true; older
// tokens issued before the second step existed are refused.
exports.PLATFORM_COOKIE = 'platform_token';
// Short-lived cookie between the two steps: proves the password was right,
// and nothing else.
exports.PLATFORM_MFA_COOKIE = 'platform_mfa';

exports.verifyPlatformAdmin = async (req, res, next) => {
    const token = req.cookies?.[exports.PLATFORM_COOKIE];
    if (!token) {
        return res.status(401).json({ status: 'error', message: 'Please log in to the SmartPay console.' });
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        if (decoded.kind !== 'platform' || decoded.mfa !== true) {
            return res.status(401).json({ status: 'error', message: 'Please log in to the SmartPay console.' });
        }
        const [[admin]] = await pool.query('SELECT id, name, email, token_version FROM platform_admins WHERE id = ?', [decoded.platformAdminId]);
        if (!admin || admin.token_version !== decoded.tokenVersion) {
            return res.status(401).json({ status: 'error', message: 'Your console session has ended. Please log in again.' });
        }
        req.platformAdmin = { id: admin.id, name: admin.name, email: admin.email };
        next();
    } catch {
        return res.status(401).json({ status: 'error', message: 'Your console session has ended. Please log in again.' });
    }
};
