const pool = require('../db');

// Scoped to financial and administrative actions, per the spec's own
// phrasing ("Audit logging for financial and administrative actions"),
// not instrumented into every single mutation in the app — every
// payment create/void, invoice generation, Friday settings change, and
// SMS template change is covered; read-only list/view endpoints are not.
// Never throws into the caller: a failed audit write must not undo or
// block the real action it was recording, same reasoning already used
// for notification-after-payment in Academia Hub.
async function logAction(req, { action, entityType, entityId, oldValues, newValues }) {
    try {
        await pool.query(
            `INSERT INTO audit_logs (school_id, user_id, action, entity_type, entity_id, old_values_json, new_values_json, ip_address, user_agent)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.user.schoolId, req.user.userId, action, entityType, entityId || null,
                oldValues ? JSON.stringify(oldValues) : null, newValues ? JSON.stringify(newValues) : null,
                req.ip, (req.headers['user-agent'] || '').slice(0, 255),
            ]
        );
    } catch (error) {
        console.error('Audit log write failed (action proceeded anyway):', action, error);
    }
}

module.exports = { logAction };
