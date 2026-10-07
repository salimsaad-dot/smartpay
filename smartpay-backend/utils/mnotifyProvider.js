const MNOTIFY_API_URL = 'https://api.mnotify.com/api/sms/quick';
const DEFAULT_SENDER_ID = 'SmartPay';

// Same mNotify quick-send endpoint Academia Hub already uses in production
// (utils/smsSender.js there), reimplemented independently here (SmartPay
// has no code dependency on Academia Hub) with one deliberate difference:
// this returns a structured result instead of swallowing every outcome
// into a console.log. Academia Hub's version is a fire-and-forget
// notification side-channel with nothing to persist; SmartPay's
// sms_reminders table needs a real success/failure/providerMessageId to
// record against each reminder row.
function normalizePhoneNumber(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (digits.startsWith('233') && digits.length === 12) return digits;
    if (digits.startsWith('0') && digits.length === 10) return `233${digits.slice(1)}`;
    return null;
}

function validateConfiguration() {
    return Boolean(process.env.MNOTIFY_API_KEY);
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
        const response = await fetch(`${MNOTIFY_API_URL}?key=${process.env.MNOTIFY_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recipient: [recipient],
                sender: process.env.MNOTIFY_SENDER_ID || DEFAULT_SENDER_ID,
                message,
                is_schedule: false,
            }),
        });

        // Read as text first, not straight to .json() — a non-2xx response
        // from mNotify (or anything in front of it, e.g. a WAF/rate-limit
        // page) isn't guaranteed to be JSON, and .json().catch(() => null)
        // was silently discarding the actual error content on exactly the
        // responses where it mattered most. Logged here (server-side only,
        // never put in the client-facing message) so a real failure is
        // diagnosable from the server logs instead of just a bare status
        // code — hit live in production: a 419 with no further detail
        // surfaced anywhere, including the logs, until this.
        const rawBody = await response.text().catch(() => '');
        let body = null;
        try { body = JSON.parse(rawBody); } catch { /* non-JSON response, body stays null */ }

        if (!response.ok || body?.status === 'error') {
            console.error(`mNotify send failed: HTTP ${response.status}. Raw response: ${rawBody.slice(0, 1000)}`);
            return { success: false, providerMessageId: null, error: body?.message || `mNotify error (${response.status})` };
        }

        // Confirmed against a real mNotify response (2026-10-07): a
        // successful quick-send returns `{ summary: { message_id, _id,
        // ... } }`, not `{ data: [...] }` or `summary.id` (no underscore)
        // — both of which this previously checked and both of which are
        // always undefined, so providerMessageId was silently null on
        // every real send until now. `message_id` is mNotify's own
        // human-meaningful tracking id (e.g. "20261007233577428684V2");
        // `summary._id` is an internal record id, kept as a fallback.
        const providerMessageId = body?.summary?.message_id || body?.summary?._id || null;
        return { success: true, providerMessageId, error: null };
    } catch (error) {
        return { success: false, providerMessageId: null, error: error.message };
    }
}

module.exports = { sendSms, normalizePhoneNumber, validateConfiguration };
