const pool = require('../db');

exports.list = async (req, res) => {
    try {
        const { academicYearId } = req.query;
        const params = [req.user.schoolId];
        let sql = 'SELECT * FROM terms WHERE school_id = ?';
        if (academicYearId) {
            sql += ' AND academic_year_id = ?';
            params.push(academicYearId);
        }
        sql += ' ORDER BY start_date ASC';
        const [terms] = await pool.query(sql, params);
        res.status(200).json({ status: 'success', data: terms });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while fetching terms.' });
    }
};

exports.create = async (req, res) => {
    try {
        const { academicYearId, name, startDate, endDate } = req.body;
        if (!academicYearId || !name?.trim() || !startDate || !endDate) {
            return res.status(400).json({ status: 'error', message: 'Academic year, name, start date, and end date are required.' });
        }
        if (new Date(endDate) <= new Date(startDate)) {
            return res.status(400).json({ status: 'error', message: 'End date must be after start date.' });
        }

        // academicYearId must belong to this school — a client-supplied
        // foreign key is exactly the kind of value that must be re-verified
        // server-side, not trusted just because it's a plausible integer.
        const [[year]] = await pool.query(
            'SELECT id FROM academic_years WHERE id = ? AND school_id = ?',
            [academicYearId, req.user.schoolId]
        );
        if (!year) {
            return res.status(404).json({ status: 'error', message: 'Academic year not found.' });
        }

        const [result] = await pool.query(
            'INSERT INTO terms (school_id, academic_year_id, name, start_date, end_date) VALUES (?, ?, ?, ?, ?)',
            [req.user.schoolId, academicYearId, name.trim(), startDate, endDate]
        );
        res.status(201).json({ status: 'success', message: 'Term created.', data: { id: result.insertId } });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ status: 'error', message: 'A term with that name already exists for this academic year.' });
        }
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while creating the term.' });
    }
};

exports.setCurrent = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const [[term]] = await connection.query(
            'SELECT id FROM terms WHERE id = ? AND school_id = ?',
            [req.params.id, req.user.schoolId]
        );
        if (!term) {
            connection.release();
            return res.status(404).json({ status: 'error', message: 'Term not found.' });
        }

        await connection.beginTransaction();
        await connection.query('UPDATE terms SET is_current = 0 WHERE school_id = ?', [req.user.schoolId]);
        await connection.query('UPDATE terms SET is_current = 1 WHERE id = ?', [req.params.id]);
        await connection.commit();

        res.status(200).json({ status: 'success', message: 'Current term updated.' });
    } catch (error) {
        await connection.rollback();
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while updating the current term.' });
    } finally {
        connection.release();
    }
};
