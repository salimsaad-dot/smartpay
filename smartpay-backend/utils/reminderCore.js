const pool = require('../db');
const { formatMoneyForSms } = require('./smsTemplate');

// Shared by the manual reminder flow (reminderController) and the Friday
// automation job (fridayJob) — both need to go from "a parent and
// optionally a narrower selection" to "what invoices are in scope and
// what do the template variables look like," and must resolve it
// identically so a manually-sent reminder and an automated one read the
// same way to a parent.

// Resolves "who are we reminding, and about what." All three modes
// ultimately resolve to one parent (that's who the SMS goes to — there's
// no student login/phone in this product) and a set of their outstanding
// invoices: just this one invoice if invoiceId was given, just this one
// student's if studentId was given, or every child's if only parentId
// was given (the consolidated case the public checkout page already
// shows, and what the Friday job always uses).
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

async function buildVariables(schoolId, scope, paymentLinkText, schoolRow) {
    const school = schoolRow || (await pool.query('SELECT name, currency FROM schools WHERE id = ?', [schoolId]))[0][0];
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

// preferType lets the Friday job ask for a 'friday_reminder' template
// first, but still work correctly for a school that never bothered
// configuring one — falling back to any active template (manual_reminder
// included) rather than refusing to run. A specific templateId always
// wins when given (the manual-send "pick a template" case).
async function getTemplate(schoolId, { templateId, preferType } = {}) {
    if (templateId) {
        const [[t]] = await pool.query("SELECT * FROM sms_templates WHERE id = ? AND school_id = ? AND status = 'active'", [templateId, schoolId]);
        return t || null;
    }
    if (preferType) {
        const [[preferred]] = await pool.query(
            `SELECT * FROM sms_templates WHERE school_id = ? AND type = ? AND status = 'active' ORDER BY created_at ASC LIMIT 1`,
            [schoolId, preferType]
        );
        if (preferred) return preferred;
    }
    const [[fallback]] = await pool.query(
        `SELECT * FROM sms_templates WHERE school_id = ? AND status = 'active' ORDER BY created_at ASC LIMIT 1`,
        [schoolId]
    );
    return fallback || null;
}

module.exports = { resolveReminderScope, buildVariables, getTemplate };
