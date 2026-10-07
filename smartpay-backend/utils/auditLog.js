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

// A council-pressure-tested security audit (2026-10-07) found that auth
// events — logins, failed logins, lockouts, password changes, session
// revocations — were never logged at all, anywhere. Every other finding
// in that audit was about PREVENTING a compromise; this closes the
// separate gap of having no way to NOTICE one happening. logAction above
// can't be reused for login itself: it's a pre-auth endpoint with no
// verifyToken, so req.user doesn't exist yet at the point a login
// succeeds, fails, or gets blocked by the lockout — schoolId/userId have
// to be passed in explicitly instead of read off req.user.
//
// A login attempt against a NON-EXISTENT email has no school_id to
// attach to (this table is per-tenant, keyed on a NOT NULL school_id,
// and is surfaced to a school's own admin as THEIR audit trail) — that
// case is deliberately not logged here. That's a real, narrower scope
// than "every auth event platform-wide," noted so it isn't mistaken for
// an oversight: a platform-wide unauthenticated-attempt log would need
// its own un-scoped table and is a bigger decision than this pass.
async function logAuthEvent(req, { schoolId, userId, action }) {
    try {
        await pool.query(
            `INSERT INTO audit_logs (school_id, user_id, action, entity_type, entity_id, ip_address, user_agent)
             VALUES (?, ?, ?, 'user', ?, ?, ?)`,
            [schoolId, userId, action, userId || null, req.ip, (req.headers['user-agent'] || '').slice(0, 255)]
        );
    } catch (error) {
        console.error('Audit log write failed (action proceeded anyway):', action, error);
    }
}

module.exports = { logAction, logAuthEvent };
