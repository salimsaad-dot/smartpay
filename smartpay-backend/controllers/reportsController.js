const pool = require('../db');
const { toCsv } = require('../utils/csv');

function sendCsv(res, filename, rows, columns) {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(toCsv(rows, columns));
}

// Expected/collected/outstanding/rate over a scope of invoices — the
// spec's own definitions used directly: expected = sum(total), collected
// = sum(paid_amount), outstanding = sum(balance). Filtered by term/class
// (invoice-level facts) and optionally by issue_date range.
exports.collectionSummary = async (req, res) => {
    try {
        const { termId, classId, startDate, endDate } = req.query;
        const params = [req.user.schoolId];
        let sql = `
            SELECT i.total, i.paid_amount, i.balance
            FROM invoices i JOIN students s ON s.id = i.student_id
            WHERE i.school_id = ? AND i.status != 'void'`;
        if (termId) { sql += ' AND i.term_id = ?'; params.push(termId); }
        if (classId) { sql += ' AND s.class_id = ?'; params.push(classId); }
        if (startDate) { sql += ' AND i.issue_date >= ?'; params.push(startDate); }
        if (endDate) { sql += ' AND i.issue_date <= ?'; params.push(endDate); }

        const [invoices] = await pool.query(sql, params);
        const expected = invoices.reduce((sum, i) => sum + Number(i.total), 0);
        const collected = invoices.reduce((sum, i) => sum + Number(i.paid_amount), 0);
        const outstanding = invoices.reduce((sum, i) => sum + Number(i.balance), 0);

        res.status(200).json({
            status: 'success',
            data: {
                expected, collected, outstanding,
                collectionRate: expected > 0 ? (collected / expected) * 100 : 0,
                invoiceCount: invoices.length,
            },
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while generating the collection summary.' });
    }
};

// Same underlying facts as the Arrears page, formatted as an exportable
// report rather than an actionable workflow view — kept as its own query
// here (not imported from arrearsController) since each controller owns
// its SQL in this codebase, matching the existing convention.
exports.outstandingFees = async (req, res) => {
    try {
        const { classId, termId, minBalance, maxBalance, format } = req.query;
        const params = [req.user.schoolId];
        let sql = `
            SELECT i.invoice_no, i.total, i.paid_amount, i.balance, i.status,
                   st.first_name, st.last_name, c.name AS class_name, t.name AS term_name, ft.name AS fee_type_name,
                   pr.full_name AS parent_name, pr.phone AS parent_phone,
                   (SELECT MAX(paid_at) FROM payments WHERE invoice_id = i.id AND status = 'success') AS last_payment_date
            FROM invoices i
            JOIN students st ON st.id = i.student_id
            JOIN classes c ON c.id = st.class_id
            JOIN terms t ON t.id = i.term_id
            JOIN fee_structures fs ON fs.id = i.fee_structure_id
            JOIN fee_types ft ON ft.id = fs.fee_type_id
            LEFT JOIN parent_student ps ON ps.student_id = st.id AND ps.is_primary = 1
            LEFT JOIN parents pr ON pr.id = ps.parent_id
            WHERE i.school_id = ? AND i.balance > 0 AND i.status != 'void'`;
        if (classId) { sql += ' AND c.id = ?'; params.push(classId); }
        if (termId) { sql += ' AND t.id = ?'; params.push(termId); }
        if (minBalance) { sql += ' AND i.balance >= ?'; params.push(minBalance); }
        if (maxBalance) { sql += ' AND i.balance <= ?'; params.push(maxBalance); }
        sql += ' ORDER BY i.balance DESC';

        const [rows] = await pool.query(sql, params);
        const data = rows.map((r) => ({
            studentName: `${r.first_name} ${r.last_name}`,
            parentName: r.parent_name || '',
            parentPhone: r.parent_phone || '',
            className: r.class_name,
            termName: r.term_name,
            feeTypeName: r.fee_type_name,
            invoiceNo: r.invoice_no,
            total: r.total,
            paid: r.paid_amount,
            balance: r.balance,
            status: r.status,
            lastPaymentDate: r.last_payment_date || '',
        }));

        if (format === 'csv') {
            return sendCsv(res, 'outstanding-fees.csv', data, [
                { key: 'studentName', label: 'Student' }, { key: 'parentName', label: 'Parent/Guardian' }, { key: 'parentPhone', label: 'Phone' },
                { key: 'className', label: 'Class' }, { key: 'termName', label: 'Term' }, { key: 'feeTypeName', label: 'Fee Type' }, { key: 'status', label: 'Status' }, { key: 'invoiceNo', label: 'Invoice No.' },
                { key: 'total', label: 'Total' }, { key: 'paid', label: 'Paid' }, { key: 'balance', label: 'Balance' }, { key: 'lastPaymentDate', label: 'Last Payment' },
            ]);
        }
        res.status(200).json({ status: 'success', data });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while generating the outstanding fees report.' });
    }
};

// Distinguishes online vs manual collections explicitly, per the spec's
// own requirement ("Reports must distinguish online and manual
// collections") — totals are split, not just a combined sum.
exports.paymentHistory = async (req, res) => {
    try {
        const { startDate, endDate, studentId, parentId, method, status, format } = req.query;
        const params = [req.user.schoolId];
        let sql = `
            SELECT p.*, st.first_name, st.last_name, inv.invoice_no, ft.name AS fee_type_name
            FROM payments p
            JOIN students st ON st.id = p.student_id
            JOIN invoices inv ON inv.id = p.invoice_id
            JOIN fee_structures fs ON fs.id = inv.fee_structure_id
            JOIN fee_types ft ON ft.id = fs.fee_type_id
            WHERE p.school_id = ?`;
        if (startDate) { sql += ' AND DATE(p.created_at) >= ?'; params.push(startDate); }
        if (endDate) { sql += ' AND DATE(p.created_at) <= ?'; params.push(endDate); }
        if (studentId) { sql += ' AND p.student_id = ?'; params.push(studentId); }
        if (parentId) {
            sql += ' AND EXISTS (SELECT 1 FROM parent_student ps WHERE ps.student_id = p.student_id AND ps.parent_id = ?)';
            params.push(parentId);
        }
        if (method) { sql += ' AND p.method = ?'; params.push(method); }
        if (status) { sql += ' AND p.status = ?'; params.push(status); }
        sql += ' ORDER BY p.created_at DESC';

        const [rows] = await pool.query(sql, params);
        const successful = rows.filter((r) => r.status === 'success');
        const summary = {
            totalCollected: successful.reduce((sum, r) => sum + Number(r.amount), 0),
            onlineCollected: successful.filter((r) => r.source === 'online').reduce((sum, r) => sum + Number(r.amount), 0),
            manualCollected: successful.filter((r) => r.source === 'manual').reduce((sum, r) => sum + Number(r.amount), 0),
            count: rows.length,
        };

        const data = rows.map((r) => ({
            date: r.paid_at || r.created_at,
            studentName: `${r.first_name} ${r.last_name}`,
            invoiceNo: r.invoice_no,
            feeTypeName: r.fee_type_name,
            amount: r.amount,
            method: r.method || '',
            source: r.source,
            status: r.status,
            reference: r.reference || r.provider_reference || '',
        }));

        if (format === 'csv') {
            return sendCsv(res, 'payment-history.csv', data, [
                { key: 'date', label: 'Date' }, { key: 'studentName', label: 'Student' }, { key: 'invoiceNo', label: 'Invoice No.' }, { key: 'feeTypeName', label: 'Fee Type' },
                { key: 'amount', label: 'Amount' }, { key: 'method', label: 'Method' }, { key: 'source', label: 'Source' },
                { key: 'status', label: 'Status' }, { key: 'reference', label: 'Reference' },
            ]);
        }
        res.status(200).json({ status: 'success', data: { payments: data, summary } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while generating the payment history report.' });
    }
};

exports.invoiceReport = async (req, res) => {
    try {
        const { termId, classId, status, format } = req.query;
        const params = [req.user.schoolId];
        let sql = `
            SELECT inv.invoice_no, inv.total, inv.paid_amount, inv.balance, inv.status, inv.due_date,
                   s.first_name, s.last_name, c.name AS class_name, t.name AS term_name, ft.name AS fee_type_name
            FROM invoices inv
            JOIN students s ON s.id = inv.student_id
            JOIN classes c ON c.id = s.class_id
            JOIN terms t ON t.id = inv.term_id
            JOIN fee_structures fs ON fs.id = inv.fee_structure_id
            JOIN fee_types ft ON ft.id = fs.fee_type_id
            WHERE inv.school_id = ?`;
        if (termId) { sql += ' AND inv.term_id = ?'; params.push(termId); }
        if (classId) { sql += ' AND s.class_id = ?'; params.push(classId); }
        if (status) { sql += ' AND inv.status = ?'; params.push(status); }
        sql += ' ORDER BY inv.created_at DESC';

        const [rows] = await pool.query(sql, params);
        const data = rows.map((r) => ({
            invoiceNo: r.invoice_no,
            studentName: `${r.first_name} ${r.last_name}`,
            className: r.class_name,
            termName: r.term_name,
            feeTypeName: r.fee_type_name,
            total: r.total,
            paid: r.paid_amount,
            balance: r.balance,
            status: r.status,
            dueDate: r.due_date,
        }));

        if (format === 'csv') {
            return sendCsv(res, 'invoice-report.csv', data, [
                { key: 'invoiceNo', label: 'Invoice No.' }, { key: 'studentName', label: 'Student' }, { key: 'className', label: 'Class' },
                { key: 'termName', label: 'Term' }, { key: 'feeTypeName', label: 'Fee Type' }, { key: 'total', label: 'Total' }, { key: 'paid', label: 'Paid' },
                { key: 'balance', label: 'Balance' }, { key: 'status', label: 'Status' }, { key: 'dueDate', label: 'Due Date' },
            ]);
        }
        res.status(200).json({ status: 'success', data });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while generating the invoice report.' });
    }
};

exports.smsActivity = async (req, res) => {
    try {
        const { startDate, endDate, status, format } = req.query;
        const params = [req.user.schoolId];
        let sql = `
            SELECT sr.*, p.full_name AS parent_name
            FROM sms_reminders sr
            JOIN parents p ON p.id = sr.parent_id
            WHERE sr.school_id = ?`;
        if (startDate) { sql += ' AND DATE(sr.created_at) >= ?'; params.push(startDate); }
        if (endDate) { sql += ' AND DATE(sr.created_at) <= ?'; params.push(endDate); }
        if (status) { sql += ' AND sr.status = ?'; params.push(status); }
        sql += ' ORDER BY sr.created_at DESC';

        const [rows] = await pool.query(sql, params);
        const summary = {
            sent: rows.filter((r) => r.status === 'sent' || r.status === 'delivered').length,
            failed: rows.filter((r) => r.status === 'failed').length,
            total: rows.length,
        };

        const data = rows.map((r) => ({
            date: r.sent_at || r.created_at,
            parentName: r.parent_name,
            phone: r.phone,
            status: r.status,
            failureReason: r.failure_reason || '',
        }));

        if (format === 'csv') {
            return sendCsv(res, 'sms-activity.csv', data, [
                { key: 'date', label: 'Date' }, { key: 'parentName', label: 'Parent' }, { key: 'phone', label: 'Phone' },
                { key: 'status', label: 'Status' }, { key: 'failureReason', label: 'Failure Reason' },
            ]);
        }
        res.status(200).json({ status: 'success', data: { reminders: data, summary } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while generating the SMS activity report.' });
    }
};

exports.studentStatement = async (req, res) => {
    try {
        const [[student]] = await pool.query(
            `SELECT s.*, c.name AS class_name FROM students s JOIN classes c ON c.id = s.class_id WHERE s.id = ? AND s.school_id = ?`,
            [req.params.studentId, req.user.schoolId]
        );
        if (!student) {
            return res.status(404).json({ status: 'error', message: 'Student not found.' });
        }

        const [invoices] = await pool.query(
            `SELECT inv.id, inv.invoice_no, inv.total, inv.paid_amount, inv.balance, inv.status, inv.due_date, t.name AS term_name, ft.name AS fee_type_name
             FROM invoices inv
             JOIN terms t ON t.id = inv.term_id
             JOIN fee_structures fs ON fs.id = inv.fee_structure_id
             JOIN fee_types ft ON ft.id = fs.fee_type_id
             WHERE inv.student_id = ? AND inv.school_id = ? ORDER BY inv.issue_date ASC`,
            [req.params.studentId, req.user.schoolId]
        );
        const [payments] = await pool.query(
            `SELECT amount, method, source, status, paid_at, created_at FROM payments WHERE student_id = ? AND school_id = ? ORDER BY created_at ASC`,
            [req.params.studentId, req.user.schoolId]
        );

        res.status(200).json({
            status: 'success',
            data: {
                student: { id: student.id, name: `${student.first_name} ${student.last_name}`, admissionNo: student.admission_no, className: student.class_name },
                invoices,
                payments,
                totalBilled: invoices.reduce((sum, i) => sum + Number(i.total), 0),
                totalPaid: invoices.reduce((sum, i) => sum + Number(i.paid_amount), 0),
                totalOutstanding: invoices.reduce((sum, i) => sum + Number(i.balance), 0),
            },
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while generating the student statement.' });
    }
};

exports.parentStatement = async (req, res) => {
    try {
        const [[parent]] = await pool.query('SELECT * FROM parents WHERE id = ? AND school_id = ?', [req.params.parentId, req.user.schoolId]);
        if (!parent) {
            return res.status(404).json({ status: 'error', message: 'Parent/guardian not found.' });
        }

        const [invoices] = await pool.query(
            `SELECT inv.id, inv.invoice_no, inv.total, inv.paid_amount, inv.balance, inv.status, inv.due_date,
                    t.name AS term_name, ft.name AS fee_type_name, st.id AS student_id, st.first_name, st.last_name
             FROM invoices inv
             JOIN students st ON st.id = inv.student_id
             JOIN parent_student ps ON ps.student_id = st.id
             JOIN terms t ON t.id = inv.term_id
             JOIN fee_structures fs ON fs.id = inv.fee_structure_id
             JOIN fee_types ft ON ft.id = fs.fee_type_id
             WHERE ps.parent_id = ? AND inv.school_id = ? ORDER BY st.first_name ASC, inv.issue_date ASC`,
            [req.params.parentId, req.user.schoolId]
        );
        const [payments] = await pool.query(
            `SELECT p.amount, p.method, p.source, p.status, p.paid_at, p.created_at, st.first_name, st.last_name
             FROM payments p
             JOIN students st ON st.id = p.student_id
             JOIN parent_student ps ON ps.student_id = st.id
             WHERE ps.parent_id = ? AND p.school_id = ? ORDER BY p.created_at ASC`,
            [req.params.parentId, req.user.schoolId]
        );

        res.status(200).json({
            status: 'success',
            data: {
                parent: { id: parent.id, name: parent.full_name, phone: parent.phone },
                invoices,
                payments,
                totalBilled: invoices.reduce((sum, i) => sum + Number(i.total), 0),
                totalPaid: invoices.reduce((sum, i) => sum + Number(i.paid_amount), 0),
                totalOutstanding: invoices.reduce((sum, i) => sum + Number(i.balance), 0),
            },
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while generating the parent statement.' });
    }
};
