const pool = require('../db');
// Long templates multiply the SMS cost per parent (2026-10-16).
const { MAX_TEMPLATE_LENGTH } = require('../utils/smsAllowance');
const { logAction } = require('../utils/auditLog');

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
        if (body.trim().length > MAX_TEMPLATE_LENGTH) {
            return res.status(400).json({ status: 'error', message: `Keep the message under ${MAX_TEMPLATE_LENGTH} characters (about 3 SMS); longer messages cost more per parent.` });
        }
        const [result] = await pool.query(
            `INSERT INTO sms_templates (school_id, name, body, type) VALUES (?, ?, ?, ?)`,
            [req.user.schoolId, name.trim(), body.trim(), type === 'friday_reminder' ? 'friday_reminder' : 'manual_reminder']
        );

        await logAction(req, {
            action: 'sms_template.create', entityType: 'sms_template', entityId: result.insertId,
            newValues: { name: name.trim(), body: body.trim() },
        });

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
        if (body.trim().length > MAX_TEMPLATE_LENGTH) {
            return res.status(400).json({ status: 'error', message: `Keep the message under ${MAX_TEMPLATE_LENGTH} characters (about 3 SMS); longer messages cost more per parent.` });
        }

        const [[before]] = await pool.query('SELECT name, body, status FROM sms_templates WHERE id = ? AND school_id = ?', [req.params.id, req.user.schoolId]);
        if (!before) {
            return res.status(404).json({ status: 'error', message: 'Template not found.' });
        }

        const newStatus = status === 'inactive' ? 'inactive' : 'active';
        await pool.query(
            `UPDATE sms_templates SET name = ?, body = ?, status = ? WHERE id = ? AND school_id = ?`,
            [name.trim(), body.trim(), newStatus, req.params.id, req.user.schoolId]
        );

        await logAction(req, {
            action: 'sms_template.update', entityType: 'sms_template', entityId: Number(req.params.id),
            oldValues: before, newValues: { name: name.trim(), body: body.trim(), status: newStatus },
        });

        res.status(200).json({ status: 'success', message: 'Template updated.' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ status: 'error', message: 'A template with that name already exists.' });
        }
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while updating the template.' });
    }
};
