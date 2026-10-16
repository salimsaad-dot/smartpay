const crypto = require('crypto');
const pool = require('../db');
const { hashToken } = require('../utils/paymentLink');
const { finalizePaymentEvent } = require('../utils/paymentFinalizer');
const opsAlert = require('../utils/opsAlert');
const paystackGateway = require('../utils/paystackGateway');
const { ACCESS_COLUMNS_SQL, describeAccess } = require('../utils/schoolAccess');

// Shared by every public endpoint below: resolve a raw URL token to its
// payment_links row, enforcing active/not-expired — never trusts anything
// about school/parent scoping from the request itself, only from what the
// token's own hash resolves to in the database.
async function resolveLink(connection, token) {
    const tokenHash = hashToken(token);
    const [[link]] = await connection.query(
        `SELECT pl.*, p.full_name AS parent_name, p.email AS parent_email, s.name AS school_name, s.currency,
                ${ACCESS_COLUMNS_SQL}
         FROM payment_links pl
         JOIN parents p ON p.id = pl.parent_id
         JOIN schools s ON s.id = pl.school_id
         WHERE pl.token_hash = ?`,
        [tokenHash]
    );
    if (!link) return { error: { status: 404, message: 'This payment link is invalid.' } };
    // A suspended or lapsed school takes no new online payments. The
    // webhook doesn't go through here, so a payment already started still
    // completes and is recorded.
    if (describeAccess(link).blocked) {
        return { error: { status: 410, message: 'Online payment for this school is unavailable right now. Please contact the school.' } };
    }
    // Usually a newer reminder replaced this link (each one revokes the
    // last). Worded so it doesn't read like fraud to a parent.
    if (link.status !== 'active') return { error: { status: 410, message: 'This payment link is no longer active. Please use the most recent payment SMS from the school, or contact the school.' } };
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
        return { error: { status: 410, message: 'This payment link has expired. Please contact the school for a new one.' } };
    }
    return { link };
}

// What the parent sees after tapping the SMS link: every child linked to
// this parent, and every one of THEIR invoices with an outstanding
// balance — never any other parent's data, since everything is scoped by
// the token's own parent_id, not anything the client supplies.
exports.getCheckout = async (req, res) => {
    try {
        const { error, link } = await resolveLink(pool, req.params.token);
        if (error) return res.status(error.status).json({ status: 'error', message: error.message });

        const [invoices] = await pool.query(
            `SELECT i.id, i.invoice_no, i.total, i.balance, i.due_date, t.name AS term_name, ft.name AS fee_type_name,
                    st.id AS student_id, st.first_name, st.last_name, c.name AS class_name
             FROM invoices i
             JOIN students st ON st.id = i.student_id
             JOIN parent_student ps ON ps.student_id = st.id
             JOIN terms t ON t.id = i.term_id
             JOIN classes c ON c.id = st.class_id
             JOIN fee_structures fs ON fs.id = i.fee_structure_id
             JOIN fee_types ft ON ft.id = fs.fee_type_id
             WHERE ps.parent_id = ? AND i.school_id = ? AND i.balance > 0 AND i.status != 'void'
             ORDER BY st.first_name ASC, i.due_date ASC`,
            [link.parent_id, link.school_id]
        );

        await pool.query('UPDATE payment_links SET last_used_at = NOW() WHERE id = ?', [link.id]);

        const children = {};
        for (const inv of invoices) {
            if (!children[inv.student_id]) {
                // First name + last initial: enough for the parent to
                // recognise their child, less exposure when an SMS link is
                // forwarded (Ghana's Data Protection Act 843: minimise).
                children[inv.student_id] = { studentId: inv.student_id, name: `${inv.first_name} ${String(inv.last_name || '').charAt(0)}.`.trim(), className: inv.class_name, invoices: [] };
            }
            children[inv.student_id].invoices.push({
                id: inv.id, invoiceNo: inv.invoice_no, termName: inv.term_name, feeTypeName: inv.fee_type_name,
                total: inv.total, balance: inv.balance, dueDate: inv.due_date,
            });
        }

        res.status(200).json({
            status: 'success',
            data: {
                schoolName: link.school_name,
                currency: link.currency,
                // The parent's name and email are never sent to the page
                // (2026-10-16): anyone holding a forwarded link could read
                // them. If an email is on file, initializePayment uses it
                // when the parent leaves the box empty.
                hasEmailOnFile: Boolean(link.parent_email),
                children: Object.values(children),
            },
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while loading the payment page.' });
    }
};

// Starts a real Paystack checkout for ONE invoice — a payment always maps
// 1:1 to one invoice (same model Phase 4's manual payments use), so a
// parent with multiple outstanding invoices pays them one at a time
// rather than this building a multi-invoice allocation/splitting system.
// See smartpay/DESIGN.md's Decisions Log for why that scope cut was made.
exports.initializePayment = async (req, res) => {
    const { token, invoiceId, amount, email } = req.body;
    if (!token || !invoiceId || !(Number(amount) > 0)) {
        return res.status(400).json({ status: 'error', message: 'token, invoiceId, and a positive amount are required.' });
    }

    const connection = await pool.getConnection();
    try {
        const { error, link } = await resolveLink(connection, token);
        if (error) {
            connection.release();
            return res.status(error.status).json({ status: 'error', message: error.message });
        }

        const [[invoice]] = await connection.query(
            `SELECT i.id, i.student_id, i.balance, i.status
             FROM invoices i
             JOIN students st ON st.id = i.student_id
             JOIN parent_student ps ON ps.student_id = st.id
             WHERE i.id = ? AND i.school_id = ? AND ps.parent_id = ?`,
            [invoiceId, link.school_id, link.parent_id]
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

        const payerEmail = email?.trim() || link.parent_email;
        if (!payerEmail) {
            connection.release();
            return res.status(400).json({ status: 'error', message: 'An email is required to proceed with payment.' });
        }

        const internalReference = `sp_${link.school_id}_${crypto.randomBytes(12).toString('hex')}`;

        await connection.beginTransaction();
        const [result] = await connection.query(
            `INSERT INTO payments (school_id, invoice_id, student_id, amount, source, status, internal_reference, provider)
             VALUES (?, ?, ?, ?, 'online', 'initiated', ?, 'paystack')`,
            [link.school_id, invoiceId, invoice.student_id, Number(amount), internalReference]
        );
        await connection.commit();

        try {
            const gatewayResult = await paystackGateway.initializePayment({
                email: payerEmail,
                amountGhs: Number(amount),
                reference: internalReference,
                metadata: { invoiceId, schoolId: link.school_id, internalReference },
                callbackUrl: `${process.env.FRONTEND_URL || 'http://localhost:3100'}/pay/status/${internalReference}`,
            });
            await pool.query('UPDATE payments SET provider_reference = ? WHERE id = ?', [gatewayResult.providerReference, result.insertId]);
            res.status(200).json({ status: 'success', data: { authorizationUrl: gatewayResult.authorizationUrl, internalReference } });
        } catch (gatewayError) {
            await pool.query(`UPDATE payments SET status = 'failed' WHERE id = ?`, [result.insertId]);
            const status = gatewayError.status || 500;
            res.status(status).json({ status: 'error', message: gatewayError.message || 'Could not start payment.' });
        }
    } catch (error) {
        await connection.rollback();
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while starting payment.' });
    } finally {
        connection.release();
    }
};

// Lets the success/pending page show an honest status even if Paystack's
// webhook hasn't arrived yet ("Payment redirect succeeds but webhook
// arrives later" — a spec-listed edge case). Falls back to a live
// server-to-server check with Paystack when our own record still shows
// 'initiated'/'pending' — and, crucially, actually finalizes the payment
// through the same path the webhook uses when that check confirms
// success, rather than only reporting a status the database never
// reflects. Without this, a permanently lost webhook could show a parent
// "Payment successful" while the invoice balance silently never updates.
exports.getPaymentStatus = async (req, res) => {
    try {
        const [[payment]] = await pool.query(
            `SELECT p.id, p.status, p.amount, p.invoice_id, s.currency
             FROM payments p JOIN schools s ON s.id = p.school_id
             WHERE p.internal_reference = ?`,
            [req.params.reference]
        );
        if (!payment) {
            return res.status(404).json({ status: 'error', message: 'Payment not found.' });
        }

        // Ask Paystack directly while our copy is still open. A 'cancelled'
        // ("abandoned") answer leaves the payment open, so the page keeps
        // showing "Confirming" while a Mobile Money prompt is still pending.
        let status = payment.status;
        if (status === 'initiated' || status === 'pending' || status === 'failed') {
            try {
                const live = await paystackGateway.verifyTransaction(req.params.reference);
                // Only a settled answer changes anything; skipping the rest
                // keeps every 3-second poll from writing an attempt row.
                if (live.status === 'success' || (live.status === 'failed' && status !== 'failed')) {
                    status = await finalizePaymentEvent(payment, { ...live, reference: req.params.reference }, 'status_poll');
                }
            } catch {
                // Live check failed (network/provider hiccup) — fall back to
                // our own last-known status rather than failing the request.
            }
        }

        res.status(200).json({ status: 'success', data: { status, amount: payment.amount, currency: payment.currency } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while checking payment status.' });
    }
};

// Paystack's server-to-server confirmation — public (no verifyToken; a
// webhook has no logged-in session), authenticated instead by the
// signature check below. Responds 200 for event types/references we
// deliberately don't act on (Paystack retries on non-2xx, and retrying an
// ignored event would spam this endpoint forever), but 500 when we failed
// to process a real one (e.g. the database was paused), so Paystack
// retries it. finalizePaymentEvent is safe to run again for the same
// payment, and the reconciliation job catches anything retries miss.
exports.webhook = async (req, res) => {
    const signature = req.headers['x-paystack-signature'];
    if (!paystackGateway.validateWebhookSignature(req.rawBody, signature)) {
        console.error('Paystack webhook: invalid signature — rejected.');
        return res.status(401).json({ status: 'error', message: 'Invalid signature.' });
    }

    const refund = paystackGateway.parseRefundEvent(req.rawBody);
    if (refund) {
        try {
            const [[payment]] = await pool.query('SELECT id, invoice_id, amount, status FROM payments WHERE internal_reference = ?', [refund.reference]);
            if (payment) {
                // Ask Paystack rather than trusting the event: only a
                // transaction Paystack reports as reversed is undone. A
                // partial refund leaves it 'success' and is logged for review.
                const live = await paystackGateway.verifyTransaction(refund.reference);
                if (live.status === 'refunded') {
                    await finalizePaymentEvent(payment, { ...live, reference: refund.reference }, 'refund_webhook');
                } else {
                    await opsAlert.alertOwner(`partial-refund:${refund.reference}`, 'Paystack refund that is not a full reversal', [
                        `Reference: ${refund.reference}`,
                        'Probably a partial refund. SmartPay still counts the full payment; adjust it by hand if needed.',
                    ]);
                }
            }
            return res.status(200).json({ status: 'success' });
        } catch (error) {
            await opsAlert.alertOwner('webhook-failure', 'Paystack webhook failed to process (Paystack will retry)', [String(error.message || error)]);
            return res.status(500).json({ status: 'error' });
        }
    }

    const event = paystackGateway.parseWebhookEvent(req.rawBody);
    if (!event) {
        return res.status(200).json({ status: 'success' });
    }

    try {
        const [[payment]] = await pool.query('SELECT id, invoice_id, amount, status FROM payments WHERE internal_reference = ?', [event.reference]);
        if (!payment) {
            console.error('Paystack webhook: no payment found for reference', event.reference);
            return res.status(200).json({ status: 'success' });
        }

        await finalizePaymentEvent(payment, event, 'webhook');
        res.status(200).json({ status: 'success' });
    } catch (error) {
        await opsAlert.alertOwner('webhook-failure', 'Paystack webhook failed to process (Paystack will retry)', [
            String(error.message || error),
            'If this repeats, check the database (Aiven) and Render. The 30-minute reconciliation will catch any payment missed.',
        ]);
        res.status(500).json({ status: 'error' });
    }
};
