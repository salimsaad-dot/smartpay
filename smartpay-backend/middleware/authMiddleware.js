const jwt = require('jsonwebtoken');
const pool = require('../db');

// Verify Token — ensures the user is logged in AND re-derives every
// tenant-sensitive claim live from the DB on every request, never from the
// decoded JWT payload. This is the single most important rule in the
// whole app: a JWT's schoolId claim is the client's own (old, signed)
// assertion of which school it belongs to — trusting it without a live
// re-check is the same "trust the client" mistake this app exists to
// avoid, just moved one layer up from a request body into a token. Same
// is_active/token_version re-check Academia Hub already uses for session
// revocation, extended to also re-derive school_id fresh every time.
exports.verifyToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const headerToken = authHeader && authHeader.split(' ')[1];
    const token = headerToken || req.cookies.token;

    if (!token) {
        return res.status(401).json({ status: 'error', message: 'Access denied. No token provided.' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const [[user]] = await pool.query(
            'SELECT school_id, status, token_version FROM users WHERE id = ?',
            [decoded.userId]
        );
        if (!user || user.status !== 'active') {
            return res.status(403).json({ status: 'error', message: 'Account is deactivated. Contact your administrator.' });
        }
        if (user.token_version !== decoded.tokenVersion) {
            return res.status(401).json({ status: 'error', message: 'Your session is no longer valid. Please log in again.' });
        }

        // userId/role come from the verified token; schoolId comes from
        // the fresh DB row just read above, never from decoded.schoolId.
        req.user = { userId: decoded.userId, role: decoded.role, schoolId: user.school_id };
        next();
    } catch (error) {
        return res.status(403).json({ status: 'error', message: 'Invalid or expired token.' });
    }
};

exports.verifyRole = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                status: 'error',
                message: 'Access forbidden. You do not have the required permissions for this action.'
            });
        }
        next();
    };
};
