const pool = require('../db');
const { createPaymentLink } = require('../utils/paymentLink');
const { renderTemplate } = require('../utils/smsTemplate');
const { resolveReminderScope, buildVariables, getTemplate } = require('../utils/reminderCore');
const smsProvider = require('../utils/mnotifyProvider');
const { withDeadlockRetry } = require('../utils/retryOnDeadlock');

// Preview never generates a real payment link — doing that on every
// preview click (which may not lead to an actual send) would needlessly
// revoke any link a parent is already mid-use with, just because an
// admin looked at a draft message. Only Send (below) generates the real
// one, right before it's actually needed.
exports.preview = async (req, res) => {
    try {
        const { parentId, studentId, invoiceId, templateId } = req.body;
        if (!parentId) {
            return res.status(400).json({ status: 'error', message: 'parentId is required.' });
        }

        const { error, ...scope } = await resolveReminderScope(req.user.schoolId, { parentId, studentId, invoiceId });
        if (error) return res.status(error.status).json({ status: 'error', message: error.message });

        const template = await getTemplate(req.user.schoolId, { templateId });
        if (!template) {
            return res.status(400).json({ status: 'error', message: 'No active SMS template found.' });
        }

        const variables = await buildVariables(req.user.schoolId, scope, '(a secure payment link will be included)');
        const message = renderTemplate(template.body, variables);

        res.status(200).json({ status: 'success', data: { message, phone: scope.parent.phone, templateId: template.id } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while previewing the reminder.' });
    }
};

exports.send = async (req, res) => {
    const { parentId, studentId, invoiceId, templateId } = req.body;
    if (!parentId) {
        return res.status(400).json({ status: 'error', message: 'parentId is required.' });
    }

    try {
        const { error, ...scope } = await resolveReminderScope(req.user.schoolId, { parentId, studentId, invoiceId });
        if (error) return res.status(error.status).json({ status: 'error', message: error.message });

        const template = await getTemplate(req.user.schoolId, { templateId });
        if (!template) {
            return res.status(400).json({ status: 'error', message: 'No active SMS template found.' });
        }

        // Fail fast on a bad phone number or provider misconfiguration
        // BEFORE touching payment_links — there's no reason to revoke a
        // parent's existing working link for a send that was never going
        // to succeed anyway. Phone is checked first: it's the more
        // specific, actionable problem for an admin to fix (and is true
        // regardless of provider state), whereas "provider not configured"
        // is a platform-wide condition unrelated to this particular parent.
        if (!smsProvider.normalizePhoneNumber(scope.parent.phone)) {
            return res.status(400).json({ status: 'error', message: "This parent's phone number is invalid or missing." });
        }
        if (!smsProvider.validateConfiguration()) {
            return res.status(400).json({ status: 'error', message: 'SMS provider is not configured.' });
        }

        // Retried whole — a deadlock means MySQL already rolled the entire
        // attempt back, so getting a fresh connection and starting over is
        // the correct unit to retry, not just the query that happened to
        // report it.
        const link = await withDeadlockRetry(async () => {
            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();
                const result = await createPaymentLink(connection, { schoolId: req.user.schoolId, parentId, createdBy: req.user.userId });
                await connection.commit();
                return result;
            } catch (err) {
                await connection.rollback();
                throw err;
            } finally {
                connection.release();
            }
        });

        const [[linkRow]] = await pool.query('SELECT id FROM payment_links WHERE parent_id = ? AND status = "active" ORDER BY id DESC LIMIT 1', [parentId]);

        const variables = await buildVariables(req.user.schoolId, scope, link.url);
        const message = renderTemplate(template.body, variables);

        const cycleKey = `manual-${Date.now()}`;
        const result = await smsProvider.sendSms(scope.parent.phone, message);

        const [insertResult] = await pool.query(
            `INSERT INTO sms_reminders
                (school_id, parent_id, student_id, invoice_id, cycle_key, phone, message, payment_link_id, status, provider_message_id, sent_at, failure_reason, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.user.schoolId, parentId, scope.studentId, invoiceId || null, cycleKey, scope.parent.phone, message, linkRow.id,
                result.success ? 'sent' : 'failed', result.providerMessageId, result.success ? new Date() : null, result.error, req.user.userId,
            ]
        );

        if (!result.success) {
            return res.status(502).json({ status: 'error', message: `SMS could not be sent: ${result.error}`, data: { reminderId: insertResult.insertId } });
        }

        res.status(200).json({ status: 'success', message: 'Reminder sent.', data: { reminderId: insertResult.insertId, message } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while sending the reminder.' });
    }
};

exports.list = async (req, res) => {
    try {
        const { parentId, status } = req.query;
        const params = [req.user.schoolId];
        let sql = `
            SELECT sr.*, p.full_name AS parent_name
            FROM sms_reminders sr
            JOIN parents p ON p.id = sr.parent_id
            WHERE sr.school_id = ?`;
        if (parentId) { sql += ' AND sr.parent_id = ?'; params.push(parentId); }
        if (status) { sql += ' AND sr.status = ?'; params.push(status); }
        sql += ' ORDER BY sr.created_at DESC';

        const [reminders] = await pool.query(sql, params);
        res.status(200).json({ status: 'success', data: reminders });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while fetching reminder history.' });
    }
};
