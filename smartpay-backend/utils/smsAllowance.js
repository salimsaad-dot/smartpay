const pool = require('../db');
const opsAlert = require('./opsAlert');

// Per-school SMS allowance (added 2026-10-16, council fix list). Every
// school sends through the platform owner's one SMS account, so without a
// cap a single school (or a compromised admin login) could spend the
// owner's whole SMS credit. schools.sms_monthly_limit is set by the owner
// in the console; NULL means no limit. Counts SMS sent or delivered since
// the 1st of the month (indexed: idx_school_status_created).

// Templates are capped where they're saved; this is the rendered message,
// whose fee breakdown can grow it. ~5 SMS units (153 characters each).
const MAX_TEMPLATE_LENGTH = 480;
const MAX_RENDERED_LENGTH = 765;
const WARN_AT = 0.8;

async function getAllowance(schoolId) {
    const [[row]] = await pool.query(
        `SELECT s.name, s.sms_monthly_limit AS monthlyLimit,
                (SELECT COUNT(*) FROM sms_reminders r WHERE r.school_id = s.id AND r.status IN ('sent', 'delivered')
                   AND r.created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')) AS used
         FROM schools s WHERE s.id = ?`,
        [schoolId]
    );
    const limit = row?.monthlyLimit === null || row?.monthlyLimit === undefined ? null : Number(row.monthlyLimit);
    const used = Number(row?.used || 0);
    return { schoolName: row?.name, limit, used, remaining: limit === null ? Infinity : Math.max(limit - used, 0) };
}

// Called after a send: emails the owner once when a school passes 80% and
// once when it reaches its limit (keys include the month, so once a month).
async function noteUsage(schoolId) {
    const a = await getAllowance(schoolId);
    if (a.limit === null || a.limit === 0) return a;
    const month = new Date().toISOString().slice(0, 7);
    if (a.used >= a.limit) {
        await opsAlert.alertOwner(`sms-limit:${schoolId}:${month}`, `${a.schoolName} reached its SMS allowance`, [
            `${a.used} of ${a.limit} SMS used this month. Reminders for this school are paused until next month.`,
            'Raise the allowance in the SmartPay console if the school has paid for more.',
        ]);
    } else if (a.used >= a.limit * WARN_AT) {
        await opsAlert.alertOwner(`sms-limit-warn:${schoolId}:${month}`, `${a.schoolName} has used 80% of its SMS allowance`, [
            `${a.used} of ${a.limit} SMS used this month.`,
        ]);
    }
    return a;
}

module.exports = { getAllowance, noteUsage, MAX_TEMPLATE_LENGTH, MAX_RENDERED_LENGTH };
