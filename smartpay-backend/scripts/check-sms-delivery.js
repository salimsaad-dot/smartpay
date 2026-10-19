// Why didn't a parent get their SMS? (added 2026-10-19). Read-only.
//
// "Sent" in SmartPay only means the SMS provider ACCEPTED the message. This
// shows, for one phone number, the last few reminders as SmartPay recorded
// them, how long each was (and whether special characters such as curly
// quotes or the cedi sign forced the costlier Unicode format), and what
// Arkesel itself reports about delivery, plus the account's SMS balance.
//
// Usage:  node scripts/check-sms-delivery.js 0241234567
// Run with the live DB_ settings (and ARKESEL_API_KEY) to check production.
const pool = require('../db');

const [phoneArg] = process.argv.slice(2);

// GSM 03.38 basic characters plus the extension table (which cost 2 each).
const GSM_BASIC = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXT = '^{}\\[~]|€';

function smsParts(text) {
    const odd = [...new Set([...text].filter((ch) => !GSM_BASIC.includes(ch) && !GSM_EXT.includes(ch)))];
    if (odd.length) {
        const n = [...text].length;
        return { encoding: 'Unicode', parts: n <= 70 ? 1 : Math.ceil(n / 67), odd };
    }
    const n = [...text].reduce((sum, ch) => sum + (GSM_EXT.includes(ch) ? 2 : 1), 0);
    return { encoding: 'GSM (normal)', parts: n <= 160 ? 1 : Math.ceil(n / 153), odd };
}

async function arkesel(path) {
    if (!process.env.ARKESEL_API_KEY) return 'ARKESEL_API_KEY not set here';
    try {
        const res = await fetch(`https://sms.arkesel.com${path}`, { headers: { 'api-key': process.env.ARKESEL_API_KEY }, signal: AbortSignal.timeout(15000) });
        const text = await res.text();
        return `HTTP ${res.status} ${text.slice(0, 600)}`;
    } catch (error) {
        return `request failed: ${error.message}`;
    }
}

(async () => {
    const digits = String(phoneArg || '').replace(/\D/g, '');
    if (digits.length < 9) {
        console.error('Usage: node scripts/check-sms-delivery.js 0241234567');
        process.exit(1);
    }
    const tail = digits.slice(-9); // matches 024..., 23324..., +233 24...
    console.log(`Database: ${process.env.DB_NAME} on ${process.env.DB_HOST} | SMS_PROVIDER here: ${process.env.SMS_PROVIDER || 'mnotify (default)'}\n`);

    const [parents] = await pool.query(
        "SELECT p.id, p.full_name, p.phone, s.name AS school FROM parents p JOIN schools s ON s.id = p.school_id WHERE REPLACE(REPLACE(REPLACE(p.phone, ' ', ''), '-', ''), '+', '') LIKE ?",
        [`%${tail}`]
    );
    if (!parents.length) {
        console.log('No parent has that phone number in this database.');
        process.exit(0);
    }
    for (const p of parents) console.log(`Parent #${p.id} ${p.full_name} (${p.phone}) at ${p.school}`);

    const [rows] = await pool.query(
        `SELECT r.id, r.created_at, r.status, r.provider_message_id, r.failure_reason, r.message, r.cycle_key
         FROM sms_reminders r WHERE r.parent_id IN (?) ORDER BY r.id DESC LIMIT 5`,
        [parents.map((p) => p.id)]
    );
    if (!rows.length) console.log('\nNo reminders recorded for this parent.');
    for (const r of rows) {
        // The stored copy has the link token replaced by "[link]"; the real
        // message was ~26 characters longer.
        const realish = r.message.replace('/pay/[link]', `/pay/${'x'.repeat(32)}`);
        const info = smsParts(realish);
        console.log(`\n--- Reminder #${r.id}, ${new Date(r.created_at).toISOString()} (${r.cycle_key ? 'Friday run' : 'manual'})`);
        console.log(`SmartPay status: ${r.status}${r.failure_reason ? ` (${r.failure_reason})` : ''} | provider id: ${r.provider_message_id || 'none'}`);
        console.log(`Length ~${[...realish].length} characters, ${info.encoding}, ~${info.parts} SMS part(s)`);
        if (info.odd.length) console.log(`Special characters forcing Unicode: ${info.odd.map((c) => JSON.stringify(c)).join(' ')}`);
        console.log(`Message: ${r.message.slice(0, 400)}${r.message.length > 400 ? '...' : ''}`);
        if (r.provider_message_id) console.log(`Arkesel delivery report: ${await arkesel(`/api/v2/sms/${encodeURIComponent(r.provider_message_id)}`)}`);
    }
    console.log(`\nArkesel balance: ${await arkesel('/api/v2/clients/balance-details')}`);
    process.exit(0);
})().catch((error) => {
    console.error('Failed:', error.message);
    process.exit(1);
});
