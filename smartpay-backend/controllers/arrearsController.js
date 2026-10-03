const pool = require('../db');

// One row per outstanding invoice (balance > 0, not void) — matches the
// spec's own Arrears page column list exactly (student, parent, class,
// term, total, paid, balance, last payment date), which is invoice-level
// grain since term/total vary per invoice even for the same student.
// "Parent aggregation" (grouping these into one row per family) is a
// client-side view over this same flat list, not a separate endpoint —
// the underlying facts are invoice-level; aggregation is just a different
// lens on them.
exports.list = async (req, res) => {
    try {
        const { classId, termId, parentId, minBalance, maxBalance } = req.query;
        const params = [req.user.schoolId];
        let sql = `
            SELECT i.id, i.invoice_no, i.total, i.paid_amount, i.balance, i.due_date,
                   st.id AS student_id, st.first_name, st.last_name,
                   c.id AS class_id, c.name AS class_name,
                   t.id AS term_id, t.name AS term_name,
                   pr.id AS parent_id, pr.full_name AS parent_name, pr.phone AS parent_phone,
                   (SELECT MAX(paid_at) FROM payments WHERE invoice_id = i.id AND status = 'success') AS last_payment_date
            FROM invoices i
            JOIN students st ON st.id = i.student_id
            JOIN classes c ON c.id = st.class_id
            JOIN terms t ON t.id = i.term_id
            LEFT JOIN parent_student ps ON ps.student_id = st.id AND ps.is_primary = 1
            LEFT JOIN parents pr ON pr.id = ps.parent_id
            WHERE i.school_id = ? AND i.balance > 0 AND i.status != 'void'`;

        if (classId) { sql += ' AND c.id = ?'; params.push(classId); }
        if (termId) { sql += ' AND t.id = ?'; params.push(termId); }
        if (minBalance) { sql += ' AND i.balance >= ?'; params.push(minBalance); }
        if (maxBalance) { sql += ' AND i.balance <= ?'; params.push(maxBalance); }
        if (parentId) {
            sql += ' AND EXISTS (SELECT 1 FROM parent_student ps2 WHERE ps2.student_id = st.id AND ps2.parent_id = ?)';
            params.push(parentId);
        }

        sql += ' ORDER BY i.balance DESC';

        const [rows] = await pool.query(sql, params);

        const summary = rows.reduce(
            (acc, r) => {
                acc.totalOutstanding += Number(r.balance);
                acc.invoiceIds.add(r.id);
                acc.studentIds.add(r.student_id);
                return acc;
            },
            { totalOutstanding: 0, invoiceIds: new Set(), studentIds: new Set() }
        );

        res.status(200).json({
            status: 'success',
            data: {
                invoices: rows,
                summary: {
                    totalOutstanding: summary.totalOutstanding,
                    invoiceCount: summary.invoiceIds.size,
                    studentCount: summary.studentIds.size,
                },
            },
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while fetching arrears.' });
    }
};
