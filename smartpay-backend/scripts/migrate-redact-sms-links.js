// Removes live payment-link tokens from the stored SMS history (added
// 2026-10-16). Every sms_reminders.message held the full rendered SMS,
// including the link's raw token, so anyone who could read the database
// (or a backup) got working payment pages for each parent, which undid the
// point of storing only the token's hash in payment_links. New messages
// are stored redacted (utils/smsTemplate.js redactPaymentLinks); this
// cleans up the old ones. Idempotent: an already-redacted "/pay/[link]"
// doesn't match the token pattern.
//
// Run automatically on server start (utils/migrations.js).
const pool = require('../db');

(async () => {
    const [result] = await pool.query(
        `UPDATE sms_reminders
         SET message = REGEXP_REPLACE(message, '/pay/[A-Za-z0-9_-]{20,}', '/pay/[link]')
         WHERE message REGEXP '/pay/[A-Za-z0-9_-]{20,}'`
    );
    console.log(`Redacted payment links in ${result.affectedRows} stored SMS message(s) (database: ${process.env.DB_NAME}).`);
    process.exit(0);
})().catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
});
