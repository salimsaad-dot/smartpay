// One-off check for parents who already paid but were never credited.
// Before 2026-10-16, an online payment marked 'cancelled' or 'failed'
// ignored a later Paystack success (see utils/paymentFinalizer.js). This
// asks Paystack about every such payment from the last N days and lists
// the ones Paystack says actually succeeded.
//
// Read-only by default. Add --fix to credit them through the normal
// finalizer (same rules as the webhook: amount and currency must match).
//
// Usage (production needs the production DB_* AND PAYSTACK_SECRET_KEY):
//   node scripts/audit-past-online-payments.js            # report only, last 90 days
//   node scripts/audit-past-online-payments.js 180        # report, last 180 days
//   node scripts/audit-past-online-payments.js 90 --fix   # credit what Paystack confirms
const pool = require('../db');
const paystackGateway = require('../utils/paystackGateway');
const { finalizePaymentEvent } = require('../utils/paymentFinalizer');

const days = Number(process.argv.find((a) => /^\d+$/.test(a)) || 90);
const fix = process.argv.includes('--fix');

(async () => {
    const [payments] = await pool.query(
        `SELECT p.id, p.invoice_id, p.amount, p.status, p.internal_reference, p.created_at,
                s.name AS school_name, st.first_name, st.last_name
         FROM payments p
         JOIN schools s ON s.id = p.school_id
         JOIN students st ON st.id = p.student_id
         WHERE p.source = 'online' AND p.status IN ('cancelled', 'failed')
           AND p.created_at >= NOW() - INTERVAL ? DAY
         ORDER BY p.created_at`,
        [days]
    );
    console.log(`Checking ${payments.length} cancelled/failed online payment(s) from the last ${days} days with Paystack (database: ${process.env.DB_NAME})...`);

    let missed = 0;
    let credited = 0;
    let errors = 0;
    for (const p of payments) {
        try {
            const live = await paystackGateway.verifyTransaction(p.internal_reference);
            if (live.status !== 'success') continue;
            missed += 1;
            const date = new Date(p.created_at).toISOString().slice(0, 10);
            console.log(`  PAID BUT NOT CREDITED: ${p.school_name} | ${p.first_name} ${p.last_name} | GHS ${p.amount} | ${date} | marked ${p.status} | ref ${p.internal_reference}`
                + (Math.abs(live.amountGhs - Number(p.amount)) > 0.01 ? ` | Paystack amount GHS ${live.amountGhs} (MISMATCH, check by hand)` : ''));
            if (fix) {
                const status = await finalizePaymentEvent(p, { ...live, reference: p.internal_reference }, 'audit_fix');
                if (status === 'success') credited += 1;
                console.log(`    -> now ${status}`);
            }
        } catch (error) {
            errors += 1;
            console.log(`  could not check ${p.internal_reference}: ${error.message || error}`);
        }
    }

    console.log(`\nDone. ${missed} payment(s) Paystack confirms were paid but SmartPay had not credited.`
        + (fix ? ` ${credited} credited now.` : missed ? ' Run again with --fix to credit them.' : '')
        + (errors ? ` ${errors} could not be checked; run again later.` : ''));
    process.exit(errors ? 1 : 0);
})().catch((error) => {
    console.error('Audit failed:', error);
    process.exit(1);
});
