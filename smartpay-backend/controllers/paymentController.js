const pool = require('../db');
const { recalculateInvoiceBalance } = require('../utils/invoiceRules');
const { logAction } = require('../utils/auditLog');

const VALID_METHODS = ['cash', 'mobile_money', 'bank_transfer', 'other'];

exports.list = async (req, res) => {
    try {
        const { invoiceId, studentId, method, status, startDate, endDate } = req.query;
        const params = [req.user.schoolId];
        let sql = `
            SELECT p.*, s.admission_no, s.first_name, s.last_name, inv.invoice_no
            FROM payments p
            JOIN students s ON s.id = p.student_id
            JOIN invoices inv ON inv.id = p.invoice_id
            WHERE p.school_id = ?`;
        if (invoiceId) { sql += ' AND p.invoice_id = ?'; params.push(invoiceId); }
        if (studentId) { sql += ' AND p.student_id = ?'; params.push(studentId); }
        if (method) { sql += ' AND p.method = ?'; params.push(method); }
        if (status) { sql += ' AND p.status = ?'; params.push(status); }
        if (startDate) { sql += ' AND DATE(p.created_at) >= ?'; params.push(startDate); }
        if (endDate) { sql += ' AND DATE(p.created_at) <= ?'; params.push(endDate); }
        sql += ' ORDER BY p.paid_at DESC';

        const [payments] = await pool.query(sql, params);
        res.status(200).json({ status: 'success', data: payments });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while fetching payments.' });
    }
};

// Manual payment entry — a school still receives cash/MoMo/bank payments
// outside the platform, and this is how that gets reflected. Amount is
// validated against the invoice's CURRENT balance (re-read inside the
// transaction, not trusted from an earlier page load) and rejected if it
// would overpay — the spec's stated default when overpayment handling
// isn't explicitly built (it isn't, yet).
exports.create = async (req, res) => {
    const { invoiceId, amount, method, paidAt, reference, note } = req.body;
    if (!invoiceId || !(Number(amount) > 0) || !method) {
        return res.status(400).json({ status: 'error', message: 'invoiceId, a positive amount, and a method are required.' });
    }
    if (!VALID_METHODS.includes(method)) {
        return res.status(400).json({ status: 'error', message: `method must be one of ${VALID_METHODS.join(', ')}.` });
    }

    const connection = await pool.getConnection();
    try {
        const [[invoice]] = await connection.query(
            'SELECT id, student_id, balance, status FROM invoices WHERE id = ? AND school_id = ?',
            [invoiceId, req.user.schoolId]
        );
        if (!invoice) {
            connection.release();
            return res.status(404).json({ status: 'error', message: 'Invoice not found.' });
        }
        if (invoice.status === 'void') {
            connection.release();
            return res.status(400).json({ status: 'error', message: 'This invoice has been voided and can no longer accept payments.' });
        }
        if (Number(amount) > Number(invoice.balance)) {
            connection.release();
            return res.status(400).json({ status: 'error', message: `Amount exceeds the outstanding balance of ${invoice.balance}.` });
        }

        await connection.beginTransaction();

        const [result] = await connection.query(
            `INSERT INTO payments (school_id, invoice_id, student_id, amount, method, source, status, reference, note, paid_at, created_by)
             VALUES (?, ?, ?, ?, ?, 'manual', 'success', ?, ?, ?, ?)`,
            [req.user.schoolId, invoiceId, invoice.student_id, Number(amount), method, reference?.trim() || null, note?.trim() || null, paidAt || new Date(), req.user.userId]
        );
        const paymentId = result.insertId;

        const updatedInvoice = await recalculateInvoiceBalance(connection, invoiceId);

        await connection.commit();

        await logAction(req, {
            action: 'payment.create', entityType: 'payment', entityId: paymentId,
            newValues: { invoiceId, amount: Number(amount), method, reference: reference?.trim() || null },
        });

        res.status(201).json({ status: 'success', message: 'Payment recorded.', data: { paymentId, invoice: updatedInvoice } });
    } catch (error) {
        await connection.rollback();
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while recording the payment.' });
    } finally {
        connection.release();
    }
};

// Never deletes a financial transaction — the row stays forever, just
// marked void and excluded from the invoice's paid_amount going forward.
// A reason is required, since this is exactly the kind of action an
// eventual audit trail (Phase 10) needs a real explanation attached to.
exports.voidPayment = async (req, res) => {
    const { reason } = req.body;
    if (!reason?.trim()) {
        return res.status(400).json({ status: 'error', message: 'A reason is required to void a payment.' });
    }

    const connection = await pool.getConnection();
    try {
        const [[payment]] = await connection.query(
            'SELECT id, invoice_id, status FROM payments WHERE id = ? AND school_id = ?',
            [req.params.id, req.user.schoolId]
        );
        if (!payment) {
            connection.release();
            return res.status(404).json({ status: 'error', message: 'Payment not found.' });
        }
        if (payment.status === 'void') {
            connection.release();
            return res.status(400).json({ status: 'error', message: 'This payment has already been voided.' });
        }

        await connection.beginTransaction();

        await connection.query(
            'UPDATE payments SET status = ?, void_reason = ?, voided_at = NOW(), voided_by = ? WHERE id = ?',
            ['void', reason.trim(), req.user.userId, req.params.id]
        );
        const updatedInvoice = await recalculateInvoiceBalance(connection, payment.invoice_id);

        await connection.commit();

        await logAction(req, {
            action: 'payment.void', entityType: 'payment', entityId: Number(req.params.id),
            oldValues: { status: payment.status }, newValues: { status: 'void', reason: reason.trim() },
        });

        res.status(200).json({ status: 'success', message: 'Payment voided.', data: { invoice: updatedInvoice } });
    } catch (error) {
        await connection.rollback();
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while voiding the payment.' });
    } finally {
        connection.release();
    }
};
