const pool = require('../db');
const { createPaymentLink } = require('./paymentLink');
const { renderTemplate } = require('./smsTemplate');
const { resolveReminderScope, buildVariables, getTemplate } = require('./reminderCore');
const smsProvider = require('./smsProvider');

// A job that's been 'running' longer than this is treated as abandoned
// (server crashed mid-run) rather than genuinely in progress, and its
// lock can be retaken. This job normally finishes in seconds to a few
// minutes even for a large school, so 30 minutes is a generous margin
// before assuming something went wrong, not a tight race.
const STALE_LOCK_MINUTES = 30;

// The Friday cycle is identified by the actual calendar date being
// processed, in the school's own timezone — not "today" in server time,
// since a server in UTC could be on the wrong side of midnight relative
// to a Ghana-based school. This is what makes "same cycle" meaningful
// for both the lock and the per-parent duplicate-prevention check below.
function fridayCycleKey(date, timezone) {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    return `friday-${formatter.format(date)}`;
}

// True once the current time, in the school's own timezone, has reached
// its configured friday_send_time. Only applied to the all-schools
// scheduler path below — the admin-facing manual-run endpoint is
// deliberately exempt (the spec's own "protected manual test/run
// endpoint for development/admin troubleshooting" exists specifically so
// an admin can run it immediately, not wait for the configured time).
function isPastSendTime(now, timezone, sendTime) {
    const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const parts = formatter.formatToParts(now);
    const get = (type) => parts.find((p) => p.type === type).value;
    const currentTime = `${get('hour')}:${get('minute')}:${get('second')}`;
    return currentTime >= String(sendTime).slice(0, 8);
}

// Acquires the job lock for (school, cycle) via the UNIQUE constraint on
// scheduled_jobs(school_id, job_type, cycle_key) — the same TOCTOU-safe
// "insert and catch the duplicate" pattern used everywhere else in this
// codebase (school registration, invoice generation), never a
// SELECT-then-INSERT pre-check. A stale 'running' row (crashed mid-run)
// is reclaimed by flipping it back to 'running' with a fresh start time,
// rather than left to block every future attempt forever.
async function acquireJobLock(schoolId, cycleKey) {
    try {
        const [result] = await pool.query(
            `INSERT INTO scheduled_jobs (school_id, job_type, cycle_key, status, started_at) VALUES (?, 'friday_reminder', ?, 'running', NOW())`,
            [schoolId, cycleKey]
        );
        return result.insertId;
    } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;

        const [[existing]] = await pool.query(
            `SELECT id, status, started_at FROM scheduled_jobs WHERE school_id = ? AND job_type = 'friday_reminder' AND cycle_key = ?`,
            [schoolId, cycleKey]
        );
        if (existing.status === 'completed') return null; // already done — the spec's "if this cycle already completed successfully, stop"
        if (existing.status === 'running') {
            const ageMinutes = (Date.now() - new Date(existing.started_at).getTime()) / 60000;
            if (ageMinutes < STALE_LOCK_MINUTES) return null; // genuinely in progress (or another process got here first) — don't double-run
        }
        // 'failed', or a stale 'running' row — reclaim it.
        await pool.query(`UPDATE scheduled_jobs SET status = 'running', started_at = NOW(), finished_at = NULL, error_message = NULL WHERE id = ?`, [existing.id]);
        return existing.id;
    }
}

// Runs the Friday reminder cycle for one school. Returns a summary of
// what happened, or null if this cycle was already completed/in progress
// (the lock wasn't acquired, so nothing was done).
async function runFridayJobForSchool(schoolId, { now = new Date(), respectSendTime = false } = {}) {
    const [[school]] = await pool.query(
        'SELECT id, name, currency, timezone, friday_reminders_enabled, friday_send_time, friday_template_id, reminder_min_balance, reminder_cooldown_days FROM schools WHERE id = ?',
        [schoolId]
    );
    if (!school || !school.friday_reminders_enabled) return null;

    const timezone = school.timezone || 'Africa/Accra';
    if (respectSendTime && !isPastSendTime(now, timezone, school.friday_send_time)) {
        return null; // not due yet this cycle — a later scheduler firing the same day will pick it up
    }

    const cycleKey = fridayCycleKey(now, timezone);
    const jobId = await acquireJobLock(schoolId, cycleKey);
    if (!jobId) return null;

    let processed = 0, success = 0, failure = 0;
    try {
        let sql = `
            SELECT DISTINCT ps.parent_id
            FROM invoices i
            JOIN students st ON st.id = i.student_id
            JOIN parent_student ps ON ps.student_id = st.id
            WHERE i.school_id = ? AND i.balance > 0 AND i.status != 'void'`;
        const params = [schoolId];
        if (school.reminder_min_balance != null) {
            sql += ' AND i.balance >= ?';
            params.push(school.reminder_min_balance);
        }
        const [parentRows] = await pool.query(sql, params);

        const template = await getTemplate(schoolId, { templateId: school.friday_template_id, preferType: 'friday_reminder' });

        for (const { parent_id: parentId } of parentRows) {
            processed += 1;
            try {
                if (school.reminder_cooldown_days != null) {
                    const [[recent]] = await pool.query(
                        `SELECT id FROM sms_reminders
                         WHERE school_id = ? AND parent_id = ? AND status IN ('sent', 'delivered')
                           AND sent_at >= DATE_SUB(?, INTERVAL ? DAY)
                         ORDER BY sent_at DESC LIMIT 1`,
                        [schoolId, parentId, now, school.reminder_cooldown_days]
                    );
                    if (recent) continue; // still in cooldown — not counted as a failure, simply not due yet
                }

                // Same-cycle duplicate prevention: if this exact cycle
                // already reminded this parent (e.g. a crashed-and-resumed
                // run), skip rather than resend — "never blindly resend
                // successful messages."
                const [[alreadyThisCycle]] = await pool.query(
                    `SELECT id FROM sms_reminders WHERE school_id = ? AND parent_id = ? AND cycle_key = ? AND status IN ('sent', 'delivered') LIMIT 1`,
                    [schoolId, parentId, cycleKey]
                );
                if (alreadyThisCycle) continue;

                const { error, ...scope } = await resolveReminderScope(schoolId, { parentId });
                if (error) continue; // balance was paid off between the query above and now — nothing to remind about

                if (!template) {
                    await pool.query(
                        `INSERT INTO sms_reminders (school_id, parent_id, student_id, cycle_key, phone, message, status, failure_reason)
                         VALUES (?, ?, ?, ?, ?, '', 'failed', 'No active SMS template configured.')`,
                        [schoolId, parentId, scope.studentId, cycleKey, scope.parent.phone]
                    );
                    failure += 1;
                    continue;
                }

                if (!smsProvider.normalizePhoneNumber(scope.parent.phone)) {
                    await pool.query(
                        `INSERT INTO sms_reminders (school_id, parent_id, student_id, cycle_key, phone, message, status, failure_reason)
                         VALUES (?, ?, ?, ?, ?, '', 'failed', 'Invalid or missing phone number.')`,
                        [schoolId, parentId, scope.studentId, cycleKey, scope.parent.phone || '']
                    );
                    failure += 1;
                    continue;
                }

                const connection = await pool.getConnection();
                let link;
                try {
                    await connection.beginTransaction();
                    link = await createPaymentLink(connection, { schoolId, parentId, createdBy: null });
                    await connection.commit();
                } catch (err) {
                    await connection.rollback();
                    throw err;
                } finally {
                    connection.release();
                }
                const [[linkRow]] = await pool.query("SELECT id FROM payment_links WHERE parent_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1", [parentId]);

                const variables = await buildVariables(schoolId, scope, link.url, school);
                const message = renderTemplate(template.body, variables);

                const result = await smsProvider.sendSms(scope.parent.phone, message);
                await pool.query(
                    `INSERT INTO sms_reminders
                        (school_id, parent_id, student_id, cycle_key, phone, message, payment_link_id, status, provider_message_id, sent_at, failure_reason)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        schoolId, parentId, scope.studentId, cycleKey, scope.parent.phone, message, linkRow.id,
                        result.success ? 'sent' : 'failed', result.providerMessageId, result.success ? new Date() : null, result.error,
                    ]
                );
                if (result.success) success += 1; else failure += 1;
            } catch (perParentError) {
                // One bad parent must never abort the rest of the cycle.
                console.error(`Friday job: error processing parent ${parentId} for school ${schoolId}:`, perParentError);
                failure += 1;
            }
        }

        await pool.query(
            `UPDATE scheduled_jobs SET status = 'completed', finished_at = NOW(), processed_count = ?, success_count = ?, failure_count = ? WHERE id = ?`,
            [processed, success, failure, jobId]
        );
    } catch (error) {
        await pool.query(
            `UPDATE scheduled_jobs SET status = 'failed', finished_at = NOW(), processed_count = ?, success_count = ?, failure_count = ?, error_message = ? WHERE id = ?`,
            [processed, success, failure, String(error.message || error).slice(0, 500), jobId]
        );
        throw error;
    }

    return { jobId, cycleKey, processed, success, failure };
}

// Runs the cycle for every school with Friday reminders enabled — what
// the real production scheduler calls. Deliberately called more often
// than once a week (hourly, Fridays only — see
// .github/workflows/friday-reminders.yml) with respectSendTime: true, so
// each school's own configured friday_send_time is honored rather than
// every school firing at one single global time; a school not yet due
// this hour is simply skipped and picked up by a later firing the same
// day. Each school's failure is isolated: one school's crash never
// blocks another's.
async function runFridayJobForAllSchools(options = {}) {
    const [schools] = await pool.query(`SELECT id FROM schools WHERE friday_reminders_enabled = 1 AND status = 'active'`);
    const results = [];
    for (const { id } of schools) {
        try {
            const result = await runFridayJobForSchool(id, { respectSendTime: true, ...options });
            results.push({ schoolId: id, result });
        } catch (error) {
            console.error(`Friday job: school ${id} failed entirely:`, error);
            results.push({ schoolId: id, error: String(error.message || error) });
        }
    }
    return results;
}

module.exports = { runFridayJobForSchool, runFridayJobForAllSchools, fridayCycleKey };
