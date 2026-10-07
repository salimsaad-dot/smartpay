const ARKESEL_API_URL = 'https://sms.arkesel.com/api/v2/sms/send';
const DEFAULT_SENDER_ID = 'SmartPay';

// Second SmsProvider adapter (see utils/smsProvider.js for the contract),
// added 2026-10-07 after mNotify's account was flagged as fraudulent and
// suspended mid-use, with no ETA on resolution — SmartPay needed a real,
// independent fallback, not just a wait-and-see. Selected for Ghana-
// specific direct carrier connections and GHS/Mobile-Money billing; see
// DESIGN.md Decisions Log for the fuller comparison against Africa's
// Talking/Hubtel.
//
// Response shape confirmed against Arkesel's own documented example for
// the success case only (`{ status: "success", data: { id, credits_used } }`)
// — same caution this project learned the hard way with mNotify's
// providerMessageId field (guessed wrong until a real send corrected it):
// the failure-case shape is NOT independently confirmed here, only
// inferred from `!response.ok` plus whatever `message`/`error` field
// might be present. The raw body is logged server-side on any failure
// specifically so the first real failure response can correct this
// adapter's assumptions, the same way mnotifyProvider.js's own logging
// gap was closed only after a live error went undiagnosable.
function normalizePhoneNumber(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (digits.startsWith('233') && digits.length === 12) return `+${digits}`;
    if (digits.startsWith('0') && digits.length === 10) return `+233${digits.slice(1)}`;
    return null;
}

function validateConfiguration() {
    return Boolean(process.env.ARKESEL_API_KEY);
}

async function sendSms(to, message) {
    if (!validateConfiguration()) {
        return { success: false, providerMessageId: null, error: 'SMS provider is not configured.' };
    }

    const recipient = normalizePhoneNumber(to);
    if (!recipient) {
        return { success: false, providerMessageId: null, error: 'Invalid or missing phone number.' };
    }

    try {
        const response = await fetch(ARKESEL_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': process.env.ARKESEL_API_KEY,
            },
            body: JSON.stringify({
                sender: process.env.ARKESEL_SENDER_ID || DEFAULT_SENDER_ID,
                message,
                recipients: [recipient],
            }),
        });

        // Read as text first, never assume JSON — same lesson already
        // applied to mnotifyProvider.js after a production failure there
        // went undiagnosable for exactly this reason.
        const rawBody = await response.text().catch(() => '');
        let body = null;
        try { body = JSON.parse(rawBody); } catch { /* non-JSON response, body stays null */ }

        if (!response.ok || body?.status !== 'success') {
            console.error(`Arkesel send failed: HTTP ${response.status}. Raw response: ${rawBody.slice(0, 1000)}`);
            return {
                success: false,
                providerMessageId: null,
                error: body?.message || body?.error || `Arkesel error (${response.status})`,
            };
        }

        // Confirmed against a real Arkesel response (2026-10-07): a
        // successful send returns `{ data: [{ id, recipient }], status,
        // main_balance, sms_balance }` — `data` is an ARRAY (one entry
        // per recipient), not an object with `.id` directly, which the
        // documented example this was first built from didn't make
        // obvious. Same class of surprise already hit once with
        // mNotify's own response shape.
        return { success: true, providerMessageId: body?.data?.[0]?.id || null, error: null };
    } catch (error) {
        return { success: false, providerMessageId: null, error: error.message };
    }
}

module.exports = { sendSms, normalizePhoneNumber, validateConfiguration };
