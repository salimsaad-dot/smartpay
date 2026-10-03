const pool = require('../db');

// Every query here filters by req.user.schoolId — derived server-side from
// the verified session (see middleware/authMiddleware.js), never from a
// client-supplied value. This is the one rule that must never be broken
// anywhere in this file or any other tenant-owned-data controller.

exports.list = async (req, res) => {
    try {
        const [years] = await pool.query(
            'SELECT * FROM academic_years WHERE school_id = ? ORDER BY start_date DESC',
            [req.user.schoolId]
        );
        res.status(200).json({ status: 'success', data: years });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while fetching academic years.' });
    }
};

exports.create = async (req, res) => {
    try {
        const { name, startDate, endDate } = req.body;
        if (!name?.trim() || !startDate || !endDate) {
            return res.status(400).json({ status: 'error', message: 'Name, start date, and end date are required.' });
        }
        if (new Date(endDate) <= new Date(startDate)) {
            return res.status(400).json({ status: 'error', message: 'End date must be after start date.' });
        }

        const [result] = await pool.query(
            'INSERT INTO academic_years (school_id, name, start_date, end_date) VALUES (?, ?, ?, ?)',
            [req.user.schoolId, name.trim(), startDate, endDate]
        );
        res.status(201).json({ status: 'success', message: 'Academic year created.', data: { id: result.insertId } });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ status: 'error', message: 'An academic year with that name already exists.' });
        }
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while creating the academic year.' });
    }
};

// Full-replace semantics, same convention as Academia Hub's "set current
// term": clearing every other year for this school first, then marking
// the one requested, keeps "exactly one current year per school" true by
// construction rather than relying on callers to unset the old one.
exports.setCurrent = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const [[year]] = await connection.query(
            'SELECT id FROM academic_years WHERE id = ? AND school_id = ?',
            [req.params.id, req.user.schoolId]
        );
        if (!year) {
            connection.release();
            return res.status(404).json({ status: 'error', message: 'Academic year not found.' });
        }

        await connection.beginTransaction();
        await connection.query('UPDATE academic_years SET is_current = 0 WHERE school_id = ?', [req.user.schoolId]);
        await connection.query('UPDATE academic_years SET is_current = 1 WHERE id = ?', [req.params.id]);
        await connection.commit();

        res.status(200).json({ status: 'success', message: 'Current academic year updated.' });
    } catch (error) {
        await connection.rollback();
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while updating the current academic year.' });
    } finally {
        connection.release();
    }
};
