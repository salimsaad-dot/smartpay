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

module.exports = { deriveStatus, invoiceNumber };
