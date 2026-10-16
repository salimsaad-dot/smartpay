// Tells the platform owner when something needs a human (added 2026-10-16,
// council fix list: "failures are invisible"). Before this, problems such
// as a parent's money arriving at Paystack but not being credited only
// reached console.error in Render's logs, which nobody reads.
//
// Emails OPS_ALERT_EMAIL (falling back to DEMO_NOTIFY_EMAIL, the owner's
// address that already receives demo requests). Never throws: an alert
// must never break the work that raised it. The same alert key is sent at
// most once an hour per server, so a problem repeating every few seconds
// becomes one email, not hundreds.

const emailSender = require('./emailSender');

const COOLDOWN_MS = 60 * 60 * 1000;
const lastSent = new Map();

async function alertOwner(key, subject, lines = []) {
    console.error(`[owner alert] ${subject}`, lines.join(' | '));
    try {
        const to = (process.env.OPS_ALERT_EMAIL || process.env.DEMO_NOTIFY_EMAIL || '').trim();
        if (!to) return { sent: false, reason: 'no address' };
        // The test suite deliberately triggers these failures; never send a
        // real email from it unless a test opts in (and intercepts it).
        if (process.env.NODE_ENV === 'test' && process.env.OPS_ALERT_SEND_IN_TESTS !== '1') return { sent: false, reason: 'test' };
        const now = Date.now();
        if (lastSent.has(key) && now - lastSent.get(key) < COOLDOWN_MS) return { sent: false, reason: 'cooldown' };
        lastSent.set(key, now);
        const result = await emailSender.sendOpsAlertEmail(to, subject, lines);
        return { sent: Boolean(result?.delivered) };
    } catch (error) {
        console.error('Owner alert email failed:', error.message || error);
        return { sent: false, reason: 'error' };
    }
}

// Tests only: forget cooldowns between cases.
function resetAlertCooldowns() {
    lastSent.clear();
}

module.exports = { alertOwner, resetAlertCooldowns };
