const pool = require('../db');
const { invoiceNumber } = require('../utils/invoiceRules');
const { logAction } = require('../utils/auditLog');

// Bulk-generates one invoice per active student in the fee structure's
// class+academic_year. Idempotent per student via invoices'
// UNIQUE(student_id, fee_structure_id) — relies on the DB constraint
// (caught as ER_DUP_ENTRY below), never a pre-check, same TOCTOU-safe
// rule as register-school. Each student's invoice + its item snapshot is
// its own transaction, so one student's failure never rolls back
// everyone else's already-committed invoices in the same batch.
exports.generate = async (req, res) => {
    try {
        const { feeStructureId, dueDate } = req.body;
        if (!feeStructureId) {
            return res.status(400).json({ status: 'error', message: 'feeStructureId is required.' });
        }

        const [[structure]] = await pool.query(
            'SELECT * FROM fee_structures WHERE id = ? AND school_id = ?',
            [feeStructureId, req.user.schoolId]
        );
        if (!structure) {
            return res.status(404).json({ status: 'error', message: 'Fee structure not found.' });
        }

        const [items] = await pool.query('SELECT * FROM fee_structure_items WHERE fee_structure_id = ? ORDER BY sort_order ASC', [feeStructureId]);
        if (items.length === 0) {
            return res.status(400).json({ status: 'error', message: 'This fee structure has no fee items to bill.' });
        }
        const subtotal = items.reduce((sum, i) => sum + Number(i.amount), 0);

        const [[term]] = await pool.query('SELECT end_date FROM terms WHERE id = ?', [structure.term_id]);
        const resolvedDueDate = dueDate || term.end_date;

        const [students] = await pool.query(
            `SELECT id FROM students WHERE school_id = ? AND class_id = ? AND academic_year_id = ? AND status = 'active'`,
            [req.user.schoolId, structure.class_id, structure.academic_year_id]
        );

        const issueDate = new Date().toISOString().slice(0, 10);
        let created = 0;
        let skipped = 0;

        // Sequential, not parallel — each iteration commits (or rolls
        // back) before the next begins, which is what keeps the
        // placeholder invoice_no below from ever colliding across two
        // students in the same batch.
        for (const student of students) {
            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();

                const [result] = await connection.query(
                    `INSERT INTO invoices (school_id, student_id, academic_year_id, term_id, fee_structure_id, invoice_no, issue_date, due_date, subtotal, discount, total, paid_amount, balance, status)
                     VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, 0, ?, 0, ?, 'unpaid')`,
                    [req.user.schoolId, student.id, structure.academic_year_id, structure.term_id, feeStructureId, issueDate, resolvedDueDate, subtotal, subtotal, subtotal]
                );
                const invoiceId = result.insertId;
                await connection.query('UPDATE invoices SET invoice_no = ? WHERE id = ?', [invoiceNumber(req.user.schoolId, invoiceId), invoiceId]);

                for (let i = 0; i < items.length; i++) {
                    await connection.query(
                        'INSERT INTO invoice_items (invoice_id, name, description, amount, sort_order) VALUES (?, ?, ?, ?, ?)',
                        [invoiceId, items[i].name, items[i].description, items[i].amount, i]
                    );
                }

                await connection.commit();
                created += 1;
            } catch (error) {
                await connection.rollback();
                if (error.code === 'ER_DUP_ENTRY') {
                    skipped += 1;
                } else {
                    console.error(error);
                    skipped += 1;
                }
            } finally {
                connection.release();
            }
        }

        await logAction(req, {
            action: 'invoice.generate', entityType: 'fee_structure', entityId: Number(feeStructureId),
            newValues: { created, skipped, totalEligibleStudents: students.length },
        });

        res.status(200).json({
            status: 'success',
            message: `Generated ${created} invoice(s)${skipped > 0 ? `, skipped ${skipped} (already existed)` : ''}.`,
            data: { created, skipped, totalEligibleStudents: students.length },
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while generating invoices.' });
    }
};

exports.list = async (req, res) => {
    try {
        const { studentId, termId, classId, status } = req.query;
        const params = [req.user.schoolId];
        let sql = `
            SELECT inv.*, s.admission_no, s.first_name, s.last_name, c.name AS class_name
            FROM invoices inv
            JOIN students s ON s.id = inv.student_id
            JOIN classes c ON c.id = s.class_id
            WHERE inv.school_id = ?`;
        if (studentId) { sql += ' AND inv.student_id = ?'; params.push(studentId); }
        if (termId) { sql += ' AND inv.term_id = ?'; params.push(termId); }
        if (classId) { sql += ' AND s.class_id = ?'; params.push(classId); }
        if (status) { sql += ' AND inv.status = ?'; params.push(status); }
        sql += ' ORDER BY inv.created_at DESC';

        const [invoices] = await pool.query(sql, params);
        res.status(200).json({ status: 'success', data: invoices });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while fetching invoices.' });
    }
};

exports.getById = async (req, res) => {
    try {
        const [[invoice]] = await pool.query(
            `SELECT inv.*, s.admission_no, s.first_name, s.last_name, c.name AS class_name, t.name AS term_name
             FROM invoices inv JOIN students s ON s.id = inv.student_id JOIN classes c ON c.id = s.class_id JOIN terms t ON t.id = inv.term_id
             WHERE inv.id = ? AND inv.school_id = ?`,
            [req.params.id, req.user.schoolId]
        );
        if (!invoice) {
            return res.status(404).json({ status: 'error', message: 'Invoice not found.' });
        }
        const [items] = await pool.query('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order ASC', [req.params.id]);

        res.status(200).json({ status: 'success', data: { ...invoice, items } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while fetching the invoice.' });
    }
};
