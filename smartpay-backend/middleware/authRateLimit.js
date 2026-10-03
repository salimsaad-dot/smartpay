const rateLimit = require('express-rate-limit');

// Generous per-IP budget, same reasoning as Academia Hub's: protects
// /login against credential-stuffing/brute-force without locking out a
// shared school-network IP over normal mistyped-password traffic.
exports.loginRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
});

// Deliberately NOT the same budget as login — that generosity exists
// specifically to protect a legitimate shared staffroom IP hitting
// /login many times a day, which has no equivalent here. register-school
// is a public new-school signup form with no "many legitimate users, one
// IP" justification, so it gets its own materially stricter limit to
// resist automated spam-school creation.
exports.registerRateLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
});
