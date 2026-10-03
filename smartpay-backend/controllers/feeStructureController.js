const pool = require('../db');

async function verifyOwnedForeignKeys(schoolId, { academicYearId, termId, classId }) {
    const [[year]] = await pool.query('SELECT id FROM academic_years WHERE id = ? AND school_id = ?', [academicYearId, schoolId]);
    if (!year) return 'Academic year not found.';
    const [[term]] = await pool.query('SELECT id FROM terms WHERE id = ? AND school_id = ? AND academic_year_id = ?', [termId, schoolId, academicYearId]);
    if (!term) return 'Term not found for that academic year.';
    const [[cls]] = await pool.query('SELECT id FROM classes WHERE id = ? AND school_id = ?', [classId, schoolId]);
    if (!cls) return 'Class not found.';
    return null;
}

exports.list = async (req, res) => {
    try {
        const { termId, classId } = req.query;
        const params = [req.user.schoolId];
        let sql = `
            SELECT fs.*, c.name AS class_name, t.name AS term_name, ay.name AS academic_year_name,
                   COALESCE(SUM(fsi.amount), 0) AS total_amount, COUNT(fsi.id) AS item_count
            FROM fee_structures fs
            JOIN classes c ON c.id = fs.class_id
            JOIN terms t ON t.id = fs.term_id
            JOIN academic_years ay ON ay.id = fs.academic_year_id
            LEFT JOIN fee_structure_items fsi ON fsi.fee_structure_id = fs.id
            WHERE fs.school_id = ?`;
        if (termId) { sql += ' AND fs.term_id = ?'; params.push(termId); }
        if (classId) { sql += ' AND fs.class_id = ?'; params.push(classId); }
        sql += ' GROUP BY fs.id ORDER BY fs.created_at DESC';

        const [structures] = await pool.query(sql, params);
        res.status(200).json({ status: 'success', data: structures });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while fetching fee structures.' });
    }
};

exports.getById = async (req, res) => {
    try {
        const [[structure]] = await pool.query(
            `SELECT fs.*, c.name AS class_name, t.name AS term_name, ay.name AS academic_year_name
             FROM fee_structures fs JOIN classes c ON c.id = fs.class_id JOIN terms t ON t.id = fs.term_id JOIN academic_years ay ON ay.id = fs.academic_year_id
             WHERE fs.id = ? AND fs.school_id = ?`,
            [req.params.id, req.user.schoolId]
        );
        if (!structure) {
            return res.status(404).json({ status: 'error', message: 'Fee structure not found.' });
        }
        const [items] = await pool.query(
            'SELECT * FROM fee_structure_items WHERE fee_structure_id = ? ORDER BY sort_order ASC, id ASC',
            [req.params.id]
        );
        const totalAmount = items.reduce((sum, i) => sum + Number(i.amount), 0);

        res.status(200).json({ status: 'success', data: { ...structure, items, totalAmount } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while fetching the fee structure.' });
    }
};

// Creates the structure and its line items together in one transaction —
// a fee structure with zero items is a meaningless, half-finished record,
// so there's no reason to allow one to exist even momentarily.
exports.create = async (req, res) => {
    const { academicYearId, termId, classId, name, items } = req.body;
    if (!academicYearId || !termId || !classId || !name?.trim() || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ status: 'error', message: 'Academic year, term, class, name, and at least one fee item are required.' });
    }
    for (const item of items) {
        if (!item.name?.trim() || !(Number(item.amount) > 0)) {
            return res.status(400).json({ status: 'error', message: 'Every fee item needs a name and a positive amount.' });
        }
    }

    const fkError = await verifyOwnedForeignKeys(req.user.schoolId, { academicYearId, termId, classId });
    if (fkError) return res.status(404).json({ status: 'error', message: fkError });

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [result] = await connection.query(
            'INSERT INTO fee_structures (school_id, academic_year_id, term_id, class_id, name) VALUES (?, ?, ?, ?, ?)',
            [req.user.schoolId, academicYearId, termId, classId, name.trim()]
        );
        const structureId = result.insertId;

        for (let i = 0; i < items.length; i++) {
            await connection.query(
                'INSERT INTO fee_structure_items (fee_structure_id, name, description, amount, sort_order) VALUES (?, ?, ?, ?, ?)',
                [structureId, items[i].name.trim(), items[i].description?.trim() || null, Number(items[i].amount), i]
            );
        }

        await connection.commit();
        res.status(201).json({ status: 'success', message: 'Fee structure created.', data: { id: structureId } });
    } catch (error) {
        await connection.rollback();
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ status: 'error', message: 'A fee structure with that name already exists for this term and class.' });
        }
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while creating the fee structure.' });
    } finally {
        connection.release();
    }
};
