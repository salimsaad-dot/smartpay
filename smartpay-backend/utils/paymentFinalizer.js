const pool = require('../db');
const { recalculateInvoiceBalance, lockInvoice } = require('./invoiceRules');

// The one place an online payment's status ever changes after it starts.
// Called from the Paystack webhook, the parent's status page, and the
// reconciliation job (utils/paymentReconciler.js), so a confirmation that
// any of them receives is applied the same way.
//
// Paystack holds the real record of whether money moved; this function
// keeps SmartPay's copy in step with it. Rules (fixed 2026-10-16 after a
// council audit found a parent could pay and never be credited):
//
//   - Only 'success' and 'void' are final. 'failed' and 'cancelled' are
//     not: a parent can retry on the same Paystack checkout after a
//     declined attempt, and a payment we gave up on may still complete.
//     A confirmed success always wins over them.
//   - 'cancelled' is never recorded from a Paystack answer. Paystack
//     reports "abandoned" (which the gateway maps to 'cancelled') for any
//     transaction not finished yet, including a Mobile Money approval
//     still waiting on the parent's phone. Recording that is what used to
//     make the later success get thrown away. Only the reconciliation job
//     cancels, and only after giving up on a payment (48h).
//   - Every status change is a guarded UPDATE (WHERE status IN ...), so two
//     callers racing (webhook vs. status poll) or a payment voided in the
//     meantime can never be processed twice or brought back to life.
//   - Money is credited only when the amount and currency match what we
//     asked Paystack to collect.
//   - A reversal or refund Paystack confirms moves the payment to
//     'refunded' (applyRefund), which stops it counting.
//
// Returns the payment's status afterwards.

const OPEN_STATUSES = ['initiated', 'pending', 'failed', 'cancelled'];
const EXPECTED_CURRENCY = 'GHS';

async function currentStatus(paymentId) {
    const [[row]] = await pool.query('SELECT status FROM payments WHERE id = ?', [paymentId]);
    return row?.status;
}

async function finalizePaymentEvent(payment, result, source) {
    await pool.query(
        `INSERT INTO payment_attempts (payment_id, provider_reference, status, response_metadata_json) VALUES (?, ?, ?, ?)`,
        [payment.id, result.reference, result.status,
            JSON.stringify({ source, channel: result.channel, amountGhs: result.amountGhs, currency: result.currency || null })]
    );

    if (result.status === 'refunded') return applyRefund(payment);
    if (payment.status === 'success' || payment.status === 'refunded') return payment.status;
    if (payment.status === 'void') {
        if (result.status === 'success') {
            console.error('Payment finalize: Paystack confirmed a payment that was voided in SmartPay; needs manual review:', result.reference);
        }
        return 'void';
    }

    if (result.status !== 'success') {
        if (result.status === 'failed') {
            const [update] = await pool.query(
                `UPDATE payments SET status = 'failed' WHERE id = ? AND status IN ('initiated', 'pending')`,
                [payment.id]
            );
            return update.affectedRows ? 'failed' : currentStatus(payment.id);
        }
        // initiated / pending / cancelled ("abandoned"): nothing settled yet.
        return payment.status;
    }

    const amountMatches = Math.abs(Number(result.amountGhs) - Number(payment.amount)) <= 0.01;
    const currencyMatches = !result.currency || result.currency === EXPECTED_CURRENCY;
    if (!amountMatches || !currencyMatches) {
        console.error('Payment finalize: amount/currency mismatch for', result.reference,
            'expected', payment.amount, EXPECTED_CURRENCY, 'got', result.amountGhs, result.currency);
        const [update] = await pool.query(
            `UPDATE payments SET status = 'failed' WHERE id = ? AND status IN ('initiated', 'pending')`,
            [payment.id]
        );
        return update.affectedRows ? 'failed' : currentStatus(payment.id);
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await lockInvoice(connection, payment.invoice_id);
        const [update] = await connection.query(
            `UPDATE payments SET status = 'success', method = ?, provider_reference = ?, paid_at = ?
             WHERE id = ? AND status IN (?)`,
            [result.channel, result.reference, result.paidAt || new Date(), payment.id, OPEN_STATUSES]
        );
        if (update.affectedRows === 0) {
            // Another caller finalized it first, or it was voided meanwhile.
            await connection.rollback();
            return currentStatus(payment.id);
        }
        await recalculateInvoiceBalance(connection, payment.invoice_id);
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    return 'success';
}

// Paystack reports the transaction reversed (a refund the school made, or
// a reversal). The payment stops counting toward the invoice, so the fee
// shows as owed again. 'refunded' rather than 'void' keeps "the money went
// back to the parent" apart from "a bursar cancelled a wrong entry".
async function applyRefund(payment) {
    if (payment.status === 'refunded' || payment.status === 'void') return payment.status;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await lockInvoice(connection, payment.invoice_id);
        const [update] = await connection.query(
            `UPDATE payments SET status = 'refunded' WHERE id = ? AND status IN ('success', 'initiated', 'pending', 'failed', 'cancelled')`,
            [payment.id]
        );
        if (update.affectedRows === 0) {
            await connection.rollback();
            return currentStatus(payment.id);
        }
        await recalculateInvoiceBalance(connection, payment.invoice_id);
        await connection.commit();
        return 'refunded';
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
}

module.exports = { finalizePaymentEvent, OPEN_STATUSES };
