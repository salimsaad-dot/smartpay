const pool = require('../db');
const { createPaymentLink } = require('../utils/paymentLink');
const { renderTemplate, formatMoneyForSms } = require('../utils/smsTemplate');
const smsProvider = require('../utils/mnotifyProvider');

// Resolves "who are we reminding, and about what" from the admin's
// selection — matches the spec's 4.8 workflow step 77 exactly ("Admin
// selects a student, invoice or parent"). All three modes ultimately
// resolve to one parent (that's who the SMS goes to — there's no student
// login/phone in this product) and a set of their outstanding invoices:
// just this one invoice if invoiceId was given, just this one student's
// if studentId was given, or every child's if only parentId was given
// (the consolidated case the public checkout page already shows).
async function resolveReminderScope(schoolId, { parentId, studentId, invoiceId }) {
    const [[parent]] = await pool.query('SELECT id, full_name, phone FROM parents WHERE id = ? AND school_id = ?', [parentId, schoolId]);
    if (!parent) return { error: { status: 404, message: 'Parent/guardian not found.' } };

    let sql = `
        SELECT i.id, i.total, i.balance, i.due_date, st.id AS student_id, st.first_name, st.last_name, t.name AS term_name
        FROM invoices i
        JOIN students st ON st.id = i.student_id
        JOIN parent_student ps ON ps.student_id = st.id
        JOIN terms t ON t.id = i.term_id
        WHERE ps.parent_id = ? AND i.school_id = ? AND i.balance > 0 AND i.status != 'void'`;
    const params = [parentId, schoolId];
    if (invoiceId) { sql += ' AND i.id = ?'; params.push(invoiceId); }
    else if (studentId) { sql += ' AND st.id = ?'; params.push(studentId); }
    sql += ' ORDER BY i.due_date ASC';

    const [invoices] = await pool.query(sql, params);
    if (invoices.length === 0) {
        return { error: { status: 400, message: 'No outstanding balance found for this selection.' } };
    }

    const studentNames = [...new Set(invoices.map((i) => `${i.first_name} ${i.last_name}`))];
    const termNames = [...new Set(invoices.map((i) => i.term_name))];
    const totalBalance = invoices.reduce((sum, i) => sum + Number(i.balance), 0);

    return {
        parent,
        invoices,
        studentId: invoices.length === 1 ? invoices[0].student_id : null,
        studentCount: new Set(invoices.map((i) => i.student_id)).size,
        studentName: studentNames.join(', '),
        termName: termNames.join(', '),
        totalBalance,
        earliestDueDate: invoices[0].due_date,
    };
}

async function buildVariables(schoolId, scope, paymentLinkText) {
    const [[school]] = await pool.query('SELECT name, currency FROM schools WHERE id = ?', [schoolId]);
    return {
        school_name: school.name,
        parent_name: scope.parent.full_name,
        student_name: scope.studentName,
        student_count: scope.studentCount,
        term_name: scope.termName,
        total_balance: formatMoneyForSms(scope.totalBalance, school.currency),
        payment_link: paymentLinkText,
        due_date: new Date(scope.earliestDueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    };
}

async function getTemplate(schoolId, templateId) {
    if (templateId) {
        const [[t]] = await pool.query('SELECT * FROM sms_templates WHERE id = ? AND school_id = ? AND status = "active"', [templateId, schoolId]);
        return t || null;
    }
    const [[t]] = await pool.query(
        `SELECT * FROM sms_templates WHERE school_id = ? AND type = 'manual_reminder' AND status = 'active' ORDER BY created_at ASC LIMIT 1`,
        [schoolId]
    );
    return t || null;
}

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

        const template = await getTemplate(req.user.schoolId, templateId);
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

        const template = await getTemplate(req.user.schoolId, templateId);
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

        const connection = await pool.getConnection();
        let link;
        try {
            await connection.beginTransaction();
            link = await createPaymentLink(connection, { schoolId: req.user.schoolId, parentId, createdBy: req.user.userId });
            await connection.commit();
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }

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
