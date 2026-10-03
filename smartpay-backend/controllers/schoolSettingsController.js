const pool = require('../db');
const { logAction } = require('../utils/auditLog');

exports.getFridaySettings = async (req, res) => {
    try {
        const [[school]] = await pool.query(
            'SELECT friday_reminders_enabled, friday_send_time, friday_template_id, reminder_min_balance, reminder_cooldown_days FROM schools WHERE id = ?',
            [req.user.schoolId]
        );
        res.status(200).json({ status: 'success', data: school });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while fetching Friday reminder settings.' });
    }
};

// A true partial update — only fields actually present in the request
// body are changed, starting from the school's current row. Earlier this
// unconditionally overwrote every column from the body regardless of
// what was sent, so a caller updating only `reminderCooldownDays` would
// silently disable Friday reminders and wipe the template/min-balance as
// a side effect (every missing field defaulted to false/null). A PATCH
// endpoint must never do that.
exports.updateFridaySettings = async (req, res) => {
    try {
        const { fridayTemplateId } = req.body;
        if (fridayTemplateId) {
            const [[template]] = await pool.query('SELECT id FROM sms_templates WHERE id = ? AND school_id = ?', [fridayTemplateId, req.user.schoolId]);
            if (!template) {
                return res.status(400).json({ status: 'error', message: 'That template does not belong to your school.' });
            }
        }

        const [[current]] = await pool.query(
            'SELECT friday_reminders_enabled, friday_send_time, friday_template_id, reminder_min_balance, reminder_cooldown_days FROM schools WHERE id = ?',
            [req.user.schoolId]
        );

        const merged = {
            fridayRemindersEnabled: 'fridayRemindersEnabled' in req.body ? (req.body.fridayRemindersEnabled ? 1 : 0) : current.friday_reminders_enabled,
            fridaySendTime: 'fridaySendTime' in req.body ? (req.body.fridaySendTime || '08:00:00') : current.friday_send_time,
            fridayTemplateId: 'fridayTemplateId' in req.body ? (req.body.fridayTemplateId || null) : current.friday_template_id,
            reminderMinBalance: 'reminderMinBalance' in req.body
                ? (req.body.reminderMinBalance === '' || req.body.reminderMinBalance == null ? null : Number(req.body.reminderMinBalance))
                : current.reminder_min_balance,
            reminderCooldownDays: 'reminderCooldownDays' in req.body
                ? (req.body.reminderCooldownDays === '' || req.body.reminderCooldownDays == null ? null : Number(req.body.reminderCooldownDays))
                : current.reminder_cooldown_days,
        };

        await pool.query(
            `UPDATE schools SET
                friday_reminders_enabled = ?,
                friday_send_time = ?,
                friday_template_id = ?,
                reminder_min_balance = ?,
                reminder_cooldown_days = ?
             WHERE id = ?`,
            [merged.fridayRemindersEnabled, merged.fridaySendTime, merged.fridayTemplateId, merged.reminderMinBalance, merged.reminderCooldownDays, req.user.schoolId]
        );

        await logAction(req, {
            action: 'settings.update', entityType: 'school', entityId: req.user.schoolId,
            oldValues: current, newValues: merged,
        });

        res.status(200).json({ status: 'success', message: 'Friday reminder settings updated.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while updating Friday reminder settings.' });
    }
};
