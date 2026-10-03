const pool = require('../db');
const { createPaymentLink } = require('../utils/paymentLink');

exports.list = async (req, res) => {
    try {
        const { search } = req.query;
        const params = [req.user.schoolId];
        let sql = 'SELECT * FROM parents WHERE school_id = ?';
        if (search?.trim()) {
            sql += ' AND (full_name LIKE ? OR phone LIKE ?)';
            params.push(`%${search.trim()}%`, `%${search.trim()}%`);
        }
        sql += ' ORDER BY full_name ASC';
        const [parents] = await pool.query(sql, params);
        res.status(200).json({ status: 'success', data: parents });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while fetching parents.' });
    }
};

exports.create = async (req, res) => {
    try {
        const { fullName, phone, email, address } = req.body;
        if (!fullName?.trim() || !phone?.trim()) {
            return res.status(400).json({ status: 'error', message: 'Full name and phone number are required.' });
        }

        const [result] = await pool.query(
            'INSERT INTO parents (school_id, full_name, phone, email, address) VALUES (?, ?, ?, ?, ?)',
            [req.user.schoolId, fullName.trim(), phone.trim(), email?.trim() || null, address?.trim() || null]
        );
        res.status(201).json({ status: 'success', message: 'Parent/guardian created.', data: { id: result.insertId } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while creating the parent/guardian.' });
    }
};

exports.update = async (req, res) => {
    try {
        const { fullName, phone, email, address } = req.body;
        if (!fullName?.trim() || !phone?.trim()) {
            return res.status(400).json({ status: 'error', message: 'Full name and phone number are required.' });
        }

        const [result] = await pool.query(
            'UPDATE parents SET full_name = ?, phone = ?, email = ?, address = ? WHERE id = ? AND school_id = ?',
            [fullName.trim(), phone.trim(), email?.trim() || null, address?.trim() || null, req.params.id, req.user.schoolId]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ status: 'error', message: 'Parent/guardian not found.' });
        }
        res.status(200).json({ status: 'success', message: 'Parent/guardian updated.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while updating the parent/guardian.' });
    }
};

// A parent's own detail, their linked children, and (eventually, Phase 3+)
// their consolidated balance — the "see everything about this family"
// view the spec calls for.
exports.getById = async (req, res) => {
    try {
        const [[parent]] = await pool.query(
            'SELECT * FROM parents WHERE id = ? AND school_id = ?',
            [req.params.id, req.user.schoolId]
        );
        if (!parent) {
            return res.status(404).json({ status: 'error', message: 'Parent/guardian not found.' });
        }

        const [children] = await pool.query(
            `SELECT s.id, s.admission_no, s.first_name, s.last_name, s.status, c.name AS class_name,
                    ps.relationship, ps.is_primary
             FROM parent_student ps
             JOIN students s ON s.id = ps.student_id
             JOIN classes c ON c.id = s.class_id
             WHERE ps.parent_id = ? AND s.school_id = ?
             ORDER BY s.first_name ASC`,
            [req.params.id, req.user.schoolId]
        );

        res.status(200).json({ status: 'success', data: { ...parent, children } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while fetching the parent/guardian.' });
    }
};

// Generates a fresh secure payment link for this parent, covering ALL
// their children's outstanding balances (scope 'parent_all' — matches the
// workflow's consolidated-payment default). Only the token's hash is ever
// stored, so the raw token can only ever be returned here, once — any
// existing active link for this parent is revoked first rather than
// "reused," since we have no way to show an already-hashed token again.
// This is a minimal, admin-triggered version of link generation; the
// Friday SMS job (a later phase) will call the same underlying insert
// automatically instead of requiring a manual click.
exports.generatePaymentLink = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const [[parent]] = await connection.query(
            'SELECT id FROM parents WHERE id = ? AND school_id = ?',
            [req.params.id, req.user.schoolId]
        );
        if (!parent) {
            connection.release();
            return res.status(404).json({ status: 'error', message: 'Parent/guardian not found.' });
        }

        await connection.beginTransaction();
        const { url, expiresAt } = await createPaymentLink(connection, {
            schoolId: req.user.schoolId,
            parentId: req.params.id,
            createdBy: req.user.userId,
        });
        await connection.commit();

        res.status(201).json({ status: 'success', data: { url, expiresAt } });
    } catch (error) {
        await connection.rollback();
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while generating the payment link.' });
    } finally {
        connection.release();
    }
};
