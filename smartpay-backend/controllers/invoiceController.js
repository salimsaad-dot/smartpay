const pool = require('../db');
const { invoiceNumber } = require('../utils/invoiceRules');
const { logAction } = require('../utils/auditLog');

// Shared by generate() and previewGeneration() below — both need the
// exact same answer to "which students does this fee structure bill,"
// or a preview could show one set and generation could bill a different
// one. class_wide (the only mode that existed before fee-management
// Phase 2) is every active student in the structure's class+year,
// unchanged. selected_students additionally requires a row in
// student_fee_eligibility for this fee type — the reusable,
// term-independent eligibility list an admin manages from the Fee Types
// page, not something re-picked at generation time.
async function resolveEligibleStudents(schoolId, structure) {
    const [[feeType]] = await pool.query('SELECT applicability FROM fee_types WHERE id = ?', [structure.fee_type_id]);

    let sql = `
        SELECT s.id, s.first_name, s.last_name, c.name AS class_name
        FROM students s
        JOIN classes c ON c.id = s.class_id
        WHERE s.school_id = ? AND s.class_id = ? AND s.academic_year_id = ? AND s.status = 'active'`;
    const params = [schoolId, structure.class_id, structure.academic_year_id];

    if (feeType.applicability === 'selected_students') {
        sql += ` AND EXISTS (SELECT 1 FROM student_fee_eligibility sfe WHERE sfe.student_id = s.id AND sfe.fee_type_id = ?)`;
        params.push(structure.fee_type_id);
    }
    sql += ' ORDER BY s.first_name ASC';

    const [students] = await pool.query(sql, params);
    return students;
}

// Shows exactly who would be billed and for how much, without creating
// anything — the doc's "pre-generation review" requirement (fee type,
// amount, period, target students, invoice count, total). Also reports
// how many of those students already have an invoice from this exact
// structure, so re-running generation isn't a surprise.
exports.previewGeneration = async (req, res) => {
    try {
        const { feeStructureId } = req.query;
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
        const totalAmount = items.reduce((sum, i) => sum + Number(i.amount), 0);

        const students = await resolveEligibleStudents(req.user.schoolId, structure);

        const [[{ alreadyInvoiced }]] = await pool.query(
            `SELECT COUNT(*) AS alreadyInvoiced FROM invoices WHERE fee_structure_id = ? AND student_id IN (${students.map(() => '?').join(',') || 'NULL'})`,
            [feeStructureId, ...students.map((s) => s.id)]
        );

        res.status(200).json({
            status: 'success',
            data: {
                students: students.map((s) => ({ id: s.id, name: `${s.first_name} ${s.last_name}`, className: s.class_name })),
                studentCount: students.length,
                totalAmount,
                alreadyInvoicedCount: alreadyInvoiced,
                newInvoiceCount: students.length - alreadyInvoiced,
            },
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while previewing invoice generation.' });
    }
};

// Bulk-generates one invoice per eligible student (class-wide, or the
// fee type's selected-students list — see resolveEligibleStudents
// above). Idempotent per student via invoices'
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

        const students = await resolveEligibleStudents(req.user.schoolId, structure);

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
            SELECT inv.*, s.admission_no, s.first_name, s.last_name, c.name AS class_name, ft.name AS fee_type_name
            FROM invoices inv
            JOIN students s ON s.id = inv.student_id
            JOIN classes c ON c.id = s.class_id
            JOIN fee_structures fs ON fs.id = inv.fee_structure_id
            JOIN fee_types ft ON ft.id = fs.fee_type_id
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
            `SELECT inv.*, s.admission_no, s.first_name, s.last_name, c.name AS class_name, t.name AS term_name, ft.name AS fee_type_name
             FROM invoices inv
             JOIN students s ON s.id = inv.student_id JOIN classes c ON c.id = s.class_id JOIN terms t ON t.id = inv.term_id
             JOIN fee_structures fs ON fs.id = inv.fee_structure_id JOIN fee_types ft ON ft.id = fs.fee_type_id
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
