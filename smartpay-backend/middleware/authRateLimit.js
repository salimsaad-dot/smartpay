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

// Covers the public, unauthenticated checkout surface (token lookup +
// payment initialization) — per the spec's security requirements,
// explicitly called out alongside login as needing rate limiting since
// anyone can hit these with no account. Generous enough for a parent
// retrying a typo'd amount a few times, tight enough to blunt token
// brute-forcing (the token itself is the real defense — 192 bits of
// entropy — but this adds a second layer against sheer request volume).
exports.publicPaymentRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
});
