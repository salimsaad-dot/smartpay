const pool = require('../db');

exports.list = async (req, res) => {
    try {
        const [classes] = await pool.query(
            'SELECT * FROM classes WHERE school_id = ? AND status = ? ORDER BY level ASC, name ASC',
            [req.user.schoolId, 'active']
        );
        res.status(200).json({ status: 'success', data: classes });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while fetching classes.' });
    }
};

exports.create = async (req, res) => {
    try {
        const { name, level } = req.body;
        if (!name?.trim()) {
            return res.status(400).json({ status: 'error', message: 'Class name is required.' });
        }

        const [result] = await pool.query(
            'INSERT INTO classes (school_id, name, level) VALUES (?, ?, ?)',
            [req.user.schoolId, name.trim(), level ?? null]
        );
        res.status(201).json({ status: 'success', message: 'Class created.', data: { id: result.insertId } });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ status: 'error', message: 'A class with that name already exists.' });
        }
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while creating the class.' });
    }
};
