const pool = require('../db');
const { logAction } = require('../utils/auditLog');

// Same default-active-only, ?status=all/inactive convention as
// classController.list — every existing caller (the fee structure form's
// dropdown) only ever wants active types and has always expected that
// default.
exports.list = async (req, res) => {
    try {
        const { status } = req.query;
        const params = [req.user.schoolId];
        let sql = 'SELECT * FROM fee_types WHERE school_id = ?';
        if (!status) {
            sql += " AND status = 'active'";
        } else if (status !== 'all') {
            sql += ' AND status = ?';
            params.push(status);
        }
        sql += ' ORDER BY name ASC';
        const [feeTypes] = await pool.query(sql, params);
        res.status(200).json({ status: 'success', data: feeTypes });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while fetching fee types.' });
    }
};

exports.create = async (req, res) => {
    try {
        const { name } = req.body;
        if (!name?.trim()) {
            return res.status(400).json({ status: 'error', message: 'Fee type name is required.' });
        }

        const [result] = await pool.query(
            'INSERT INTO fee_types (school_id, name) VALUES (?, ?)',
            [req.user.schoolId, name.trim()]
        );
        res.status(201).json({ status: 'success', message: 'Fee type created.', data: { id: result.insertId } });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ status: 'error', message: 'A fee type with that name already exists.' });
        }
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while creating the fee type.' });
    }
};

// Never hard-deleted — fee_structures.fee_type_id references it
// (including historically, for structures already generated into real
// invoices), same "archive, never delete" convention as classes.
exports.updateStatus = async (req, res) => {
    try {
        const { status } = req.body;
        if (!['active', 'inactive'].includes(status)) {
            return res.status(400).json({ status: 'error', message: "Status must be 'active' or 'inactive'." });
        }

        const [[current]] = await pool.query('SELECT status FROM fee_types WHERE id = ? AND school_id = ?', [req.params.id, req.user.schoolId]);
        if (!current) {
            return res.status(404).json({ status: 'error', message: 'Fee type not found.' });
        }

        await pool.query('UPDATE fee_types SET status = ? WHERE id = ? AND school_id = ?', [status, req.params.id, req.user.schoolId]);
        await logAction(req, {
            action: 'fee_type.status_update', entityType: 'fee_type', entityId: Number(req.params.id),
            oldValues: current, newValues: { status },
        });

        res.status(200).json({ status: 'success', message: status === 'active' ? 'Fee type reactivated.' : 'Fee type deactivated.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while updating the fee type status.' });
    }
};
