const pool = require('../db');
const paystackGateway = require('./paystackGateway');
const { finalizePaymentEvent } = require('./paymentFinalizer');

// Catches online payments that nothing else settled (added 2026-10-16).
// Normally Paystack's webhook settles a payment within seconds, and the
// parent's status page is a second chance. Both can miss: the webhook can
// fail while the database is paused, and the parent may close the tab.
// This job asks Paystack directly about every online payment still open
// after STALE_AFTER_MINUTES, so a parent who paid always gets credited.
// Run by POST /api/cron/reconcile-payments (GitHub Actions, every 30 min).
//
// After GIVE_UP_AFTER_HOURS a still-unfinished payment is marked
// 'cancelled'. That's safe: if Paystack ever confirms it later, the
// finalizer lets the success win over 'cancelled'.

const STALE_AFTER_MINUTES = 10;
const GIVE_UP_AFTER_HOURS = 48;
const BATCH_SIZE = 50;

async function reconcileOnlinePayments() {
    const [payments] = await pool.query(
        `SELECT id, invoice_id, amount, status, internal_reference,
                (created_at < NOW() - INTERVAL ? HOUR) AS past_give_up
         FROM payments
         WHERE source = 'online' AND status IN ('initiated', 'pending')
           AND created_at < NOW() - INTERVAL ? MINUTE
         ORDER BY created_at
         LIMIT ?`,
        [GIVE_UP_AFTER_HOURS, STALE_AFTER_MINUTES, BATCH_SIZE]
    );

    const summary = { checked: payments.length, credited: 0, failed: 0, givenUp: 0, stillOpen: 0, errors: [] };
    for (const payment of payments) {
        try {
            const live = await paystackGateway.verifyTransaction(payment.internal_reference);
            const status = await finalizePaymentEvent(payment, { ...live, reference: payment.internal_reference }, 'reconcile');
            if (status === 'success') {
                summary.credited += 1;
            } else if (status === 'failed') {
                summary.failed += 1;
            } else if (Number(payment.past_give_up) === 1) {
                const [update] = await pool.query(
                    `UPDATE payments SET status = 'cancelled' WHERE id = ? AND status IN ('initiated', 'pending')`,
                    [payment.id]
                );
                if (update.affectedRows) summary.givenUp += 1;
            } else {
                summary.stillOpen += 1;
            }
        } catch (error) {
            // Keep going: one bad call shouldn't stop the others being checked.
            summary.errors.push({ reference: payment.internal_reference, message: String(error.message || error) });
        }
    }
    return summary;
}

module.exports = { reconcileOnlinePayments, STALE_AFTER_MINUTES, GIVE_UP_AFTER_HOURS };
