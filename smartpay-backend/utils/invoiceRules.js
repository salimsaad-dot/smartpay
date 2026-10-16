// Core business rules from the spec (section 7), kept in one place since
// both invoice generation (Phase 3) and payment recording (Phase 4) need
// to derive the same status the same way — balance and status are always
// computed from real records, never typed in directly by anyone.

function deriveStatus(total, paidAmount) {
    const balance = Math.max(Number(total) - Number(paidAmount), 0);
    if (balance <= 0) return 'paid';
    if (Number(paidAmount) > 0) return 'partially_paid';
    return 'unpaid';
}

function invoiceNumber(schoolId, invoiceId) {
    return `INV-${schoolId}-${String(invoiceId).padStart(5, '0')}`;
}

// The one place paid_amount/balance/status ever get written — called
// after recording a manual payment, voiding one, or an online payment's
// webhook confirming success, always re-summing from the real payments
// table rather than incrementing/decrementing a running total. Only rows
// with status='success' count — a manual payment is inserted as success
// immediately, but an online payment passes through initiated/pending
// first and must not affect the balance until the gateway actually
// confirms it; a voided payment (status='void') is likewise excluded,
// which is what makes voiding "work" from the invoice's point of view —
// the payment row itself is never deleted, only marked void, so the full
// history stays intact.
//
// Callers must be inside a transaction and call lockInvoice() FIRST, before
// touching any payment row (see lockInvoice for why). The FOR UPDATE here
// is a safety net; re-locking a row this transaction already holds is free.
async function recalculateInvoiceBalance(connection, invoiceId) {
    const [[invoice]] = await connection.query('SELECT total FROM invoices WHERE id = ? FOR UPDATE', [invoiceId]);
    const [[{ paidAmount }]] = await connection.query(
        `SELECT COALESCE(SUM(amount), 0) AS paidAmount FROM payments WHERE invoice_id = ? AND status = 'success'`,
        [invoiceId]
    );
    const balance = Math.max(Number(invoice.total) - Number(paidAmount), 0);
    const status = deriveStatus(invoice.total, paidAmount);
    await connection.query(
        'UPDATE invoices SET paid_amount = ?, balance = ?, status = ? WHERE id = ?',
        [paidAmount, balance, status, invoiceId]
    );
    return { paidAmount: Number(paidAmount), balance, status };
}

// Every write that changes an invoice's payments (recording, voiding, an
// online confirmation) takes this lock as its first statement (added
// 2026-10-16). Two effects:
//   - they run one at a time per invoice, so a balance check can't be
//     passed by two payments at once, and each recalculation sees the
//     other's committed payment instead of overwriting it with a stale sum;
//   - locking the invoice before any payment row, in every path, keeps the
//     lock order the same everywhere, so they can't deadlock each other.
// Returns the invoice row, or undefined if it doesn't exist (in this school,
// when schoolId is given).
async function lockInvoice(connection, invoiceId, schoolId = null) {
    const [[invoice]] = await connection.query(
        `SELECT id, school_id, student_id, total, balance, status FROM invoices WHERE id = ?${schoolId === null ? '' : ' AND school_id = ?'} FOR UPDATE`,
        schoolId === null ? [invoiceId] : [invoiceId, schoolId]
    );
    return invoice;
}

module.exports = { deriveStatus, invoiceNumber, recalculateInvoiceBalance, lockInvoice };
