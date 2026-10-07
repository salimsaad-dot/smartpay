// The contract every SMS provider adapter must implement — same reasoning
// as utils/paymentGateway.js in Phase 5: documented here so a second SMS
// provider can be dropped in later without touching controller code.
//
//   sendSms(to, message)
//     => { success: boolean, providerMessageId: string|null, error: string|null }
//
//   normalizePhoneNumber(raw) => string|null (null if it can't be resolved
//     to a usable number — the caller must treat this as "don't attempt
//     to send", not as something to send anyway and let the provider fail)
//
//   validateConfiguration() => boolean
//
// That second provider arrived 2026-10-07: mNotify's account was flagged
// as fraudulent and suspended mid-use, with no ETA on resolution, so
// SmartPay needed a real fallback rather than a wait-and-see. Both
// adapters stay available; SMS_PROVIDER picks which one every caller
// actually gets, so switching back once mNotify is unblocked (or to a
// third provider later) is a one-env-var change, not a code change or a
// redeploy of controller logic. Defaults to mNotify — explicit opt-in to
// Arkesel, not a silent default flip, since Arkesel's failure-response
// shape is still unconfirmed against a real send (see arkeselProvider.js).
const mnotify = require('./mnotifyProvider');
const arkesel = require('./arkeselProvider');

const PROVIDERS = { mnotify, arkesel };

function activeProvider() {
    const name = (process.env.SMS_PROVIDER || 'mnotify').toLowerCase();
    return PROVIDERS[name] || mnotify;
}

module.exports = {
    sendSms: (...args) => activeProvider().sendSms(...args),
    normalizePhoneNumber: (...args) => activeProvider().normalizePhoneNumber(...args),
    validateConfiguration: (...args) => activeProvider().validateConfiguration(...args),
};
