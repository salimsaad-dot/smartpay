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

// The webhook is also named explicitly in the spec's security
// requirements ("webhook abuse surfaces"), even though it's already
// signature-protected — a bad/missing signature still costs an HMAC
// computation and a DB lookup per request, so an unthrottled endpoint is
// still a real volumetric-abuse target. Generous enough that Paystack's
// own legitimate retries (it redelivers on non-2xx) are never at risk of
// being throttled.
exports.webhookRateLimit = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
});

// Not named explicitly in the spec's rate-limiting list (which only
// calls out login/public links/payment init/webhooks), but added for the
// same underlying reason as those: a real-money cost per request. Each
// call here can trigger an actual billable SMS send — this is
// admin-authenticated, so abuse requires a compromised session rather
// than an anonymous attacker, but a compromised or buggy client
// shouldn't be able to burn through a school's SMS credit at unbounded
// speed either.
exports.reminderRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
});
