const crypto = require('crypto');

// Guards the cross-school Friday job endpoint, meant to be called by an
// external scheduler, not a logged-in admin — no JWT session exists for
// that caller. Same proven pattern as Academia Hub's own cron auth,
// independently reimplemented (no code dependency between the two
// products).
//
// Fails closed: an unset CRON_SECRET must never be treated as "no auth
// required" — that would leave the endpoint wide open in any environment
// where the env var was simply forgotten. Uses a timing-safe comparison
// rather than `===` so response time can't leak how much of the secret a
// guess got right.
exports.verifyCronSecret = (req, res, next) => {
    const configured = process.env.CRON_SECRET;
    const provided = req.headers['x-cron-secret'];

    if (!configured || !provided) {
        return res.status(401).json({ status: 'error', message: 'Unauthorized.' });
    }

    const configuredBuf = Buffer.from(configured);
    const providedBuf = Buffer.from(provided);
    const isMatch = configuredBuf.length === providedBuf.length
        && crypto.timingSafeEqual(configuredBuf, providedBuf);

    if (!isMatch) {
        return res.status(401).json({ status: 'error', message: 'Unauthorized.' });
    }

    next();
};
