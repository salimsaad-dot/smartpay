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

        const body = await response.json().catch(() => null);
        if (!response.ok || body?.status === 'error') {
            return { success: false, providerMessageId: null, error: body?.message || `mNotify error (${response.status})` };
        }

        // mNotify's quick-send response isn't fully documented here — this
        // extracts whatever identifier it returns defensively, confirmed
        // and corrected against a real response during live verification.
        const providerMessageId = body?.data?.[0]?._id || body?.summary?.id || null;
        return { success: true, providerMessageId, error: null };
    } catch (error) {
        return { success: false, providerMessageId: null, error: error.message };
    }
}

module.exports = { sendSms, normalizePhoneNumber, validateConfiguration };
