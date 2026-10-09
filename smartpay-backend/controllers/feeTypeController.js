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

const VALID_APPLICABILITY = ['class_wide', 'selected_students'];
const VALID_FREQUENCY = ['termly', 'annual', 'one_time', 'as_needed'];

exports.create = async (req, res) => {
    try {
        const { name, applicability, frequency } = req.body;
        if (!name?.trim()) {
            return res.status(400).json({ status: 'error', message: 'Fee type name is required.' });
        }
        if (applicability && !VALID_APPLICABILITY.includes(applicability)) {
            return res.status(400).json({ status: 'error', message: "applicability must be 'class_wide' or 'selected_students'." });
        }
        if (frequency && !VALID_FREQUENCY.includes(frequency)) {
            return res.status(400).json({ status: 'error', message: "frequency must be one of: termly, annual, one_time, as_needed." });
        }

        const [result] = await pool.query(
            'INSERT INTO fee_types (school_id, name, applicability, frequency) VALUES (?, ?, ?, ?)',
            [req.user.schoolId, name.trim(), applicability || 'class_wide', frequency || 'termly']
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

// Separate from updateStatus (active/inactive) — applicability is a
// billing-behavior switch, not an archive action, and keeping them as
// two single-purpose endpoints matches this codebase's existing
// preference for narrow, explicit mutations over one do-everything PATCH.
exports.updateApplicability = async (req, res) => {
    try {
        const { applicability } = req.body;
        if (!VALID_APPLICABILITY.includes(applicability)) {
            return res.status(400).json({ status: 'error', message: "applicability must be 'class_wide' or 'selected_students'." });
        }

        const [[current]] = await pool.query('SELECT applicability FROM fee_types WHERE id = ? AND school_id = ?', [req.params.id, req.user.schoolId]);
        if (!current) {
            return res.status(404).json({ status: 'error', message: 'Fee type not found.' });
        }

        await pool.query('UPDATE fee_types SET applicability = ? WHERE id = ? AND school_id = ?', [applicability, req.params.id, req.user.schoolId]);
        await logAction(req, {
            action: 'fee_type.applicability_update', entityType: 'fee_type', entityId: Number(req.params.id),
            oldValues: current, newValues: { applicability },
        });

        res.status(200).json({ status: 'success', message: 'Fee type applicability updated.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while updating the fee type.' });
    }
};

// Display-only — purely for the admin's own clarity on the Fee Types
// page (termly/annual/one-time/as-needed). Not enforced: duplicate-
// billing protection is still entirely the per-structure
// UNIQUE(term_id, class_id, fee_type_id) constraint from Phase 1,
// unchanged by this field.
exports.updateFrequency = async (req, res) => {
    try {
        const { frequency } = req.body;
        if (!VALID_FREQUENCY.includes(frequency)) {
            return res.status(400).json({ status: 'error', message: 'frequency must be one of: termly, annual, one_time, as_needed.' });
        }

        const [[current]] = await pool.query('SELECT frequency FROM fee_types WHERE id = ? AND school_id = ?', [req.params.id, req.user.schoolId]);
        if (!current) {
            return res.status(404).json({ status: 'error', message: 'Fee type not found.' });
        }

        await pool.query('UPDATE fee_types SET frequency = ? WHERE id = ? AND school_id = ?', [frequency, req.params.id, req.user.schoolId]);
        await logAction(req, {
            action: 'fee_type.frequency_update', entityType: 'fee_type', entityId: Number(req.params.id),
            oldValues: current, newValues: { frequency },
        });

        res.status(200).json({ status: 'success', message: 'Fee type frequency updated.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while updating the fee type.' });
    }
};

// The eligibility checkbox list — every active student, each flagged
// whether they're currently on this fee type's eligible list. One query,
// not N+1: a single LEFT JOIN against student_fee_eligibility scoped to
// this fee_type_id.
exports.listEligibility = async (req, res) => {
    try {
        const [[feeType]] = await pool.query('SELECT id FROM fee_types WHERE id = ? AND school_id = ?', [req.params.id, req.user.schoolId]);
        if (!feeType) {
            return res.status(404).json({ status: 'error', message: 'Fee type not found.' });
        }

        const [students] = await pool.query(
            `SELECT s.id, s.admission_no, s.first_name, s.last_name, c.name AS class_name,
                    (sfe.id IS NOT NULL) AS eligible
             FROM students s
             JOIN classes c ON c.id = s.class_id
             LEFT JOIN student_fee_eligibility sfe ON sfe.student_id = s.id AND sfe.fee_type_id = ?
             WHERE s.school_id = ? AND s.status = 'active'
             ORDER BY c.name ASC, s.first_name ASC`,
            [req.params.id, req.user.schoolId]
        );
        res.status(200).json({ status: 'success', data: students.map((s) => ({ ...s, eligible: Boolean(s.eligible) })) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while fetching eligibility.' });
    }
};

// Replaces the whole eligible-student set in one transaction — simpler
// and safer than incremental add/remove endpoints for what is always a
// "here's the full checked list, save it" UI action. studentIds not
// belonging to this school are silently ignored by the INSERT...SELECT's
// own WHERE, never trusted from the request body.
exports.updateEligibility = async (req, res) => {
    const { studentIds } = req.body;
    if (!Array.isArray(studentIds)) {
        return res.status(400).json({ status: 'error', message: 'studentIds must be an array.' });
    }

    const connection = await pool.getConnection();
    try {
        const [[feeType]] = await connection.query('SELECT id FROM fee_types WHERE id = ? AND school_id = ?', [req.params.id, req.user.schoolId]);
        if (!feeType) {
            connection.release();
            return res.status(404).json({ status: 'error', message: 'Fee type not found.' });
        }

        await connection.beginTransaction();
        await connection.query('DELETE FROM student_fee_eligibility WHERE fee_type_id = ? AND school_id = ?', [req.params.id, req.user.schoolId]);

        if (studentIds.length > 0) {
            await connection.query(
                `INSERT INTO student_fee_eligibility (school_id, student_id, fee_type_id)
                 SELECT ?, s.id, ? FROM students s WHERE s.id IN (?) AND s.school_id = ?`,
                [req.user.schoolId, req.params.id, studentIds, req.user.schoolId]
            );
        }

        await connection.commit();
        await logAction(req, {
            action: 'fee_type.eligibility_update', entityType: 'fee_type', entityId: Number(req.params.id),
            newValues: { studentCount: studentIds.length },
        });

        res.status(200).json({ status: 'success', message: 'Eligible students updated.', data: { studentCount: studentIds.length } });
    } catch (error) {
        await connection.rollback();
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while updating eligibility.' });
    } finally {
        connection.release();
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
