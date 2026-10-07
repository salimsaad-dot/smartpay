const pool = require('../db');
const { logAction } = require('../utils/auditLog');

// Every existing caller (Students/Academic Setup class dropdowns, invoice
// generation, etc.) calls this with no query params and has always
// expected active-only classes — that default is preserved exactly.
// The redesigned Classes page is the one caller that needs to see
// archived classes too, via an explicit ?status=archived or ?status=all.
exports.list = async (req, res) => {
    try {
        const { status } = req.query;
        const params = [req.user.schoolId];
        let sql = `
            SELECT c.*, COUNT(CASE WHEN s.status = 'active' THEN 1 END) AS student_count
            FROM classes c
            LEFT JOIN students s ON s.class_id = c.id AND s.school_id = c.school_id
            WHERE c.school_id = ?`;
        if (!status) {
            sql += " AND c.status = 'active'";
        } else if (status !== 'all') {
            sql += ' AND c.status = ?';
            params.push(status);
        }
        sql += ' GROUP BY c.id ORDER BY c.level ASC, c.name ASC';
        const [classes] = await pool.query(sql, params);
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

// Archive/reactivate — a class is never hard-deleted (students and fee
// structures reference it historically), so "remove" is a status flip.
exports.updateStatus = async (req, res) => {
    try {
        const { status } = req.body;
        if (!['active', 'archived'].includes(status)) {
            return res.status(400).json({ status: 'error', message: "Status must be 'active' or 'archived'." });
        }

        const [[current]] = await pool.query('SELECT status FROM classes WHERE id = ? AND school_id = ?', [req.params.id, req.user.schoolId]);
        if (!current) {
            return res.status(404).json({ status: 'error', message: 'Class not found.' });
        }

        await pool.query('UPDATE classes SET status = ? WHERE id = ? AND school_id = ?', [status, req.params.id, req.user.schoolId]);
        await logAction(req, {
            action: 'class.status_update', entityType: 'class', entityId: req.params.id,
            oldValues: current, newValues: { status },
        });

        res.status(200).json({ status: 'success', message: status === 'active' ? 'Class reactivated.' : 'Class archived.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while updating the class status.' });
    }
};
