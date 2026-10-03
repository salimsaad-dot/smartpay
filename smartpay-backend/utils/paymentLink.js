const crypto = require('crypto');

// Short enough to keep an SMS message cheap, random enough to be
// non-guessable (192 bits of entropy). The raw token is only ever shown
// once, at generation time — only its hash is ever persisted ("Store only
// a secure hash of the token if practical", per the product spec's Secure
// Payment Links section), so a database leak alone can never reconstruct
// a working link.
function generateToken() {
    return crypto.randomBytes(24).toString('base64url');
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

const DEFAULT_EXPIRY_DAYS = 30;

function defaultExpiry() {
    return new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

// Shared by the admin "Payment Link" button (parentController) and the
// reminder-send flow (reminderController) — both need a fresh raw token
// to display/embed, and since only the hash is ever stored, there is no
// way to "reuse" an existing link's raw value once it's left this
// function's return. Any existing active link for this parent is revoked
// first rather than left dangling alongside the new one.
async function createPaymentLink(connection, { schoolId, parentId, createdBy }) {
    const token = generateToken();
    const tokenHash = hashToken(token);
    const expiresAt = defaultExpiry();

    await connection.query(
        `UPDATE payment_links SET status = 'revoked' WHERE parent_id = ? AND school_id = ? AND status = 'active'`,
        [parentId, schoolId]
    );
    await connection.query(
        `INSERT INTO payment_links (school_id, parent_id, token_hash, scope, expires_at, created_by)
         VALUES (?, ?, ?, 'parent_all', ?, ?)`,
        [schoolId, parentId, tokenHash, expiresAt, createdBy]
    );

    const url = `${process.env.FRONTEND_URL || 'http://localhost:3100'}/pay/${token}`;
    return { token, url, expiresAt };
}

module.exports = { generateToken, hashToken, defaultExpiry, createPaymentLink };
