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

module.exports = { generateToken, hashToken, defaultExpiry };
