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
// after recording OR voiding a payment, always re-summing from the real
// payments table rather than incrementing/decrementing a running total.
// A voided payment is excluded from the sum (status != 'void'), which is
// what actually makes voiding "work" from the invoice's point of view —
// the payment row itself is never deleted, only marked void, so the full
// history stays intact.
async function recalculateInvoiceBalance(connection, invoiceId) {
    const [[invoice]] = await connection.query('SELECT total FROM invoices WHERE id = ?', [invoiceId]);
    const [[{ paidAmount }]] = await connection.query(
        `SELECT COALESCE(SUM(amount), 0) AS paidAmount FROM payments WHERE invoice_id = ? AND status != 'void'`,
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

module.exports = { deriveStatus, invoiceNumber, recalculateInvoiceBalance };
