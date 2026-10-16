const pool = require('../db');
const { recalculateInvoiceBalance, lockInvoice } = require('../utils/invoiceRules');
const { withDeadlockRetry } = require('../utils/retryOnDeadlock');
const { logAction } = require('../utils/auditLog');

const VALID_METHODS = ['cash', 'mobile_money', 'bank_transfer', 'other'];

exports.list = async (req, res) => {
    try {
        const { invoiceId, studentId, method, status, startDate, endDate, classId, termId } = req.query;
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
        if (status) {
            sql += ' AND p.status = ?'; params.push(status);
        } else {
            // An online checkout that was only started, or that failed, is
            // not a payment: no money moved. Leaving these out by default
            // keeps them out of the Payments page totals and the student
            // account history (pass ?status= to see them).
            sql += " AND NOT (p.source = 'online' AND p.status IN ('initiated', 'pending', 'failed', 'cancelled'))";
        }
        if (startDate) { sql += ' AND DATE(p.created_at) >= ?'; params.push(startDate); }
        if (endDate) { sql += ' AND DATE(p.created_at) <= ?'; params.push(endDate); }
        // Added for Reports > Collection Summary's payment-method
        // breakdown, which needs to respect the same class/term filters
        // the rest of that tab already uses — joins already present
        // (students, invoices), just two more optional WHERE clauses.
        if (classId) { sql += ' AND s.class_id = ?'; params.push(classId); }
        if (termId) { sql += ' AND inv.term_id = ?'; params.push(termId); }
        sql += ' ORDER BY p.paid_at DESC';

        const [payments] = await pool.query(sql, params);
        res.status(200).json({ status: 'success', data: payments });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while fetching payments.' });
    }
};

// Manual payment entry — a school still receives cash/MoMo/bank payments
// outside the platform, and this is how that gets reflected. The invoice is
// locked first (lockInvoice), so the balance check and the insert happen
// with no other payment able to land on the same invoice in between; an
// amount that would overpay is rejected (the spec's default while
// overpayment handling isn't built). idempotencyKey, sent by the Record
// Payment form once per submission, makes a double-clicked or retried
// submission return the payment it already created instead of a second one.
const IDEMPOTENCY_KEY_SHAPE = /^[A-Za-z0-9-]{8,64}$/;

exports.create = async (req, res) => {
    const { invoiceId, amount, method, paidAt, reference, note, idempotencyKey } = req.body;
    if (!invoiceId || !(Number(amount) > 0) || !method) {
        return res.status(400).json({ status: 'error', message: 'invoiceId, a positive amount, and a method are required.' });
    }
    if (!VALID_METHODS.includes(method)) {
        return res.status(400).json({ status: 'error', message: `method must be one of ${VALID_METHODS.join(', ')}.` });
    }
    if (idempotencyKey !== undefined && idempotencyKey !== null && !IDEMPOTENCY_KEY_SHAPE.test(String(idempotencyKey))) {
        return res.status(400).json({ status: 'error', message: 'Invalid idempotency key.' });
    }
    const key = idempotencyKey ? String(idempotencyKey) : null;

    try {
        const outcome = await withDeadlockRetry(async () => {
            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();
                const invoice = await lockInvoice(connection, invoiceId, req.user.schoolId);
                if (!invoice) {
                    await connection.rollback();
                    return { status: 404, body: { status: 'error', message: 'Invoice not found.' } };
                }

                if (key) {
                    const [[existing]] = await connection.query(
                        'SELECT id FROM payments WHERE school_id = ? AND idempotency_key = ?',
                        [req.user.schoolId, key]
                    );
                    if (existing) {
                        const [[current]] = await connection.query('SELECT paid_amount, balance, status FROM invoices WHERE id = ?', [invoiceId]);
                        await connection.rollback();
                        return {
                            status: 200,
                            body: {
                                status: 'success', message: 'Payment already recorded.',
                                data: { paymentId: existing.id, duplicate: true, invoice: { paidAmount: Number(current.paid_amount), balance: Number(current.balance), status: current.status } },
                            },
                        };
                    }
                }

                if (invoice.status === 'void') {
                    await connection.rollback();
                    return { status: 400, body: { status: 'error', message: 'This invoice has been voided and can no longer accept payments.' } };
                }
                if (Number(amount) > Number(invoice.balance)) {
                    await connection.rollback();
                    return { status: 400, body: { status: 'error', message: `Amount exceeds the outstanding balance of ${invoice.balance}.` } };
                }

                const [result] = await connection.query(
                    `INSERT INTO payments (school_id, invoice_id, student_id, amount, method, source, status, reference, idempotency_key, note, paid_at, created_by)
                     VALUES (?, ?, ?, ?, ?, 'manual', 'success', ?, ?, ?, ?, ?)`,
                    [req.user.schoolId, invoiceId, invoice.student_id, Number(amount), method, reference?.trim() || null, key,
                        note?.trim() || null, paidAt || new Date(), req.user.userId]
                );
                const updatedInvoice = await recalculateInvoiceBalance(connection, invoiceId);
                await connection.commit();
                return { status: 201, paymentId: result.insertId, body: { status: 'success', message: 'Payment recorded.', data: { paymentId: result.insertId, invoice: updatedInvoice } } };
            } catch (error) {
                await connection.rollback();
                throw error;
            } finally {
                connection.release();
            }
        });

        if (outcome.status === 201) {
            await logAction(req, {
                action: 'payment.create', entityType: 'payment', entityId: outcome.paymentId,
                newValues: { invoiceId, amount: Number(amount), method, reference: reference?.trim() || null },
            });
        }
        res.status(outcome.status).json(outcome.body);
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            // Same key reused for a different invoice: the unique index stops it.
            return res.status(409).json({ status: 'error', message: 'This payment was already submitted. Refresh the page to see it.' });
        }
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while recording the payment.' });
    }
};

// Never deletes a financial transaction — the row stays forever, just
// marked void and excluded from the invoice's paid_amount going forward.
// A reason is required, since this is exactly the kind of action an
// eventual audit trail (Phase 10) needs a real explanation attached to.
// Locks the invoice first, like every other payment write.
exports.voidPayment = async (req, res) => {
    const { reason } = req.body;
    if (!reason?.trim()) {
        return res.status(400).json({ status: 'error', message: 'A reason is required to void a payment.' });
    }

    try {
        // Which invoice to lock. Read outside the transaction on purpose: a
        // plain read inside it would fix its snapshot before the lock.
        const [[found]] = await pool.query('SELECT invoice_id FROM payments WHERE id = ? AND school_id = ?', [req.params.id, req.user.schoolId]);
        if (!found) {
            return res.status(404).json({ status: 'error', message: 'Payment not found.' });
        }

        const outcome = await withDeadlockRetry(async () => {
            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();
                await lockInvoice(connection, found.invoice_id);
                const [[payment]] = await connection.query(
                    'SELECT id, invoice_id, status, source FROM payments WHERE id = ? AND school_id = ? FOR UPDATE',
                    [req.params.id, req.user.schoolId]
                );
                if (payment.status === 'void') {
                    await connection.rollback();
                    return { status: 400, body: { status: 'error', message: 'This payment has already been voided.' } };
                }
                // Online money really arrived at Paystack; voiding it would
                // show the fee as unpaid while the money stays collected.
                // A refund made through Paystack updates it automatically.
                if (payment.source === 'online') {
                    await connection.rollback();
                    return { status: 400, body: { status: 'error', message: "Online payments can't be voided. If the parent was refunded through Paystack, SmartPay updates it automatically." } };
                }
                await connection.query(
                    'UPDATE payments SET status = ?, void_reason = ?, voided_at = NOW(), voided_by = ? WHERE id = ?',
                    ['void', reason.trim(), req.user.userId, req.params.id]
                );
                const updatedInvoice = await recalculateInvoiceBalance(connection, payment.invoice_id);
                await connection.commit();
                return { status: 200, previousStatus: payment.status, body: { status: 'success', message: 'Payment voided.', data: { invoice: updatedInvoice } } };
            } catch (error) {
                await connection.rollback();
                throw error;
            } finally {
                connection.release();
            }
        });

        if (outcome.status === 200) {
            await logAction(req, {
                action: 'payment.void', entityType: 'payment', entityId: Number(req.params.id),
                oldValues: { status: outcome.previousStatus }, newValues: { status: 'void', reason: reason.trim() },
            });
        }
        res.status(outcome.status).json(outcome.body);
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while voiding the payment.' });
    }
};
