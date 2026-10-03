const pool = require('../db');

exports.list = async (req, res) => {
    try {
        const [templates] = await pool.query(
            'SELECT * FROM sms_templates WHERE school_id = ? ORDER BY created_at ASC',
            [req.user.schoolId]
        );
        res.status(200).json({ status: 'success', data: templates });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while fetching SMS templates.' });
    }
};

exports.create = async (req, res) => {
    try {
        const { name, body, type } = req.body;
        if (!name?.trim() || !body?.trim()) {
            return res.status(400).json({ status: 'error', message: 'Name and message body are required.' });
        }
        const [result] = await pool.query(
            `INSERT INTO sms_templates (school_id, name, body, type) VALUES (?, ?, ?, ?)`,
            [req.user.schoolId, name.trim(), body.trim(), type === 'friday_reminder' ? 'friday_reminder' : 'manual_reminder']
        );
        res.status(201).json({ status: 'success', message: 'Template created.', data: { id: result.insertId } });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ status: 'error', message: 'A template with that name already exists.' });
        }
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while creating the template.' });
    }
};

exports.update = async (req, res) => {
    try {
        const { name, body, status } = req.body;
        if (!name?.trim() || !body?.trim()) {
            return res.status(400).json({ status: 'error', message: 'Name and message body are required.' });
        }
        const [result] = await pool.query(
            `UPDATE sms_templates SET name = ?, body = ?, status = ? WHERE id = ? AND school_id = ?`,
            [name.trim(), body.trim(), status === 'inactive' ? 'inactive' : 'active', req.params.id, req.user.schoolId]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ status: 'error', message: 'Template not found.' });
        }
        res.status(200).json({ status: 'success', message: 'Template updated.' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ status: 'error', message: 'A template with that name already exists.' });
        }
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while updating the template.' });
    }
};
