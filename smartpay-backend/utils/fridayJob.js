const pool = require('../db');
const { SCHOOL_IS_OPEN_SQL } = require('./schoolAccess');
const { createPaymentLink } = require('./paymentLink');
const { renderTemplate } = require('./smsTemplate');
const { resolveReminderScope, buildVariables, getTemplate } = require('./reminderCore');
const smsProvider = require('./smsProvider');
const opsAlert = require('./opsAlert');

// A job that's been 'running' longer than this is treated as abandoned
// (server crashed mid-run) rather than genuinely in progress, and its
// lock can be retaken. This job normally finishes in seconds to a few
// minutes even for a large school, so 30 minutes is a generous margin
// before assuming something went wrong, not a tight race.
const STALE_LOCK_MINUTES = 30;

// A parent's send is tried at most this many times per Friday (the first run
// plus retries on later hourly runs the same day). Permanent problems (no
// template, invalid phone) are never retried.
const MAX_SEND_ATTEMPTS = 3;

// Per-parent claims (reminder_send_claims, added 2026-10-16). A parent is
// claimed BEFORE the SMS is sent; the UNIQUE (school, parent, cycle) key
// means only one run can ever hold the claim, so overlapping runs (a slow
// run still going when the next hourly run reclaims a stale lock) can't
// text the same parent twice. Before this the SMS was sent first and only
// recorded afterwards, leaving a window for duplicates.
//
// Returns { claimId, attempt } or null when this parent must be skipped:
// already sent, outcome unknown, a permanent failure, out of attempts, or
// another run is sending right now.
async function claimParent(schoolId, parentId, cycleKey) {
    try {
        const [result] = await pool.query(
            `INSERT INTO reminder_send_claims (school_id, parent_id, cycle_key, status, attempts) VALUES (?, ?, ?, 'sending', 1)`,
            [schoolId, parentId, cycleKey]
        );
        return { claimId: result.insertId, attempt: 1 };
    } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
    }
    const [[claim]] = await pool.query(
        'SELECT id, status, attempts, retryable FROM reminder_send_claims WHERE school_id = ? AND parent_id = ? AND cycle_key = ?',
        [schoolId, parentId, cycleKey]
    );
    if (!claim || claim.status !== 'failed' || !claim.retryable || claim.attempts >= MAX_SEND_ATTEMPTS) return null;
    // Retry: take it back only if no other run did first.
    const [update] = await pool.query(
        `UPDATE reminder_send_claims SET status = 'sending', attempts = attempts + 1, last_error = NULL
         WHERE id = ? AND status = 'failed' AND retryable = 1 AND attempts < ?`,
        [claim.id, MAX_SEND_ATTEMPTS]
    );
    return update.affectedRows ? { claimId: claim.id, attempt: claim.attempts + 1 } : null;
}

async function settleClaim(claimId, status, { retryable = false, error = null } = {}) {
    await pool.query(
        'UPDATE reminder_send_claims SET status = ?, retryable = ?, last_error = ? WHERE id = ?',
        [status, retryable ? 1 : 0, error ? String(error).slice(0, 255) : null, claimId]
    );
}

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
        return { id: result.insertId, retryRun: false };
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
        // 'failed' (including a run left with sends to retry), or a stale
        // 'running' row: reclaim it, but only if no other run beat us to it.
        const [update] = await pool.query(
            `UPDATE scheduled_jobs SET status = 'running', started_at = NOW(), finished_at = NULL, error_message = NULL
             WHERE id = ? AND (status = 'failed' OR (status = 'running' AND started_at < NOW() - INTERVAL ? MINUTE))`,
            [existing.id, STALE_LOCK_MINUTES]
        );
        return update.affectedRows ? { id: existing.id, retryRun: existing.status === 'failed' } : null;
    }
}

// Runs the Friday reminder cycle for one school. Returns a summary of
// what happened, or null if this cycle was already completed/in progress
// (the lock wasn't acquired, so nothing was done).
async function runFridayJobForSchool(schoolId, { now = new Date(), respectSendTime = false } = {}) {
    const [[school]] = await pool.query(
        'SELECT id, name, currency, momo_number, momo_account_name, timezone, friday_reminders_enabled, friday_send_time, friday_template_id, reminder_min_balance, reminder_cooldown_days FROM schools WHERE id = ?',
        [schoolId]
    );
    if (!school || !school.friday_reminders_enabled) return null;

    const timezone = school.timezone || 'Africa/Accra';
    if (respectSendTime && !isPastSendTime(now, timezone, school.friday_send_time)) {
        return null; // not due yet this cycle — a later scheduler firing the same day will pick it up
    }

    const cycleKey = fridayCycleKey(now, timezone);
    const lock = await acquireJobLock(schoolId, cycleKey);
    if (!lock) return null;
    const jobId = lock.id;

    let processed = 0, success = 0, failure = 0, unknown = 0, retryPending = 0;
    try {
        // A claim still 'sending' from an earlier run means that run stopped
        // between sending and recording. The SMS may have gone out, so it is
        // never resent; the owner is told instead.
        const [stuck] = await pool.query(
            `UPDATE reminder_send_claims SET status = 'unknown', retryable = 0, last_error = 'The run stopped mid-send; this SMS may or may not have been sent.'
             WHERE school_id = ? AND cycle_key = ? AND status = 'sending' AND updated_at < NOW() - INTERVAL ? MINUTE`,
            [schoolId, cycleKey, STALE_LOCK_MINUTES]
        );
        if (stuck.affectedRows) {
            await opsAlert.alertOwner(`friday-unknown:${schoolId}:${cycleKey}`, 'Friday reminders: some sends have an unknown outcome', [
                `${school.name}: ${stuck.affectedRows} parent(s) may or may not have received this Friday's SMS (a run stopped mid-send).`,
                'They will not be texted again today, to avoid a duplicate. Check the Reminders page if needed.',
            ]);
        }

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
            let claim = null;
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

                claim = await claimParent(schoolId, parentId, cycleKey);
                if (!claim) continue; // sent, unknown, permanently failed, out of attempts, or being sent by another run

                if (!template) {
                    await pool.query(
                        `INSERT INTO sms_reminders (school_id, parent_id, student_id, cycle_key, phone, message, status, failure_reason)
                         VALUES (?, ?, ?, ?, ?, '', 'failed', 'No active SMS template configured.')`,
                        [schoolId, parentId, scope.studentId, cycleKey, scope.parent.phone]
                    );
                    await settleClaim(claim.claimId, 'failed', { error: 'No active SMS template configured.' });
                    failure += 1;
                    continue;
                }

                if (!smsProvider.normalizePhoneNumber(scope.parent.phone)) {
                    await pool.query(
                        `INSERT INTO sms_reminders (school_id, parent_id, student_id, cycle_key, phone, message, status, failure_reason)
                         VALUES (?, ?, ?, ?, ?, '', 'failed', 'Invalid or missing phone number.')`,
                        [schoolId, parentId, scope.studentId, cycleKey, scope.parent.phone || '']
                    );
                    await settleClaim(claim.claimId, 'failed', { error: 'Invalid or missing phone number.' });
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

                const variables = await buildVariables(schoolId, scope, link.url, school, template.body);
                const message = renderTemplate(template.body, variables);

                const result = await smsProvider.sendSms(scope.parent.phone, message);
                // Settle the claim first: once the provider has answered, that
                // answer must stick even if recording the history row fails.
                if (result.success) {
                    await settleClaim(claim.claimId, 'sent');
                } else if (result.outcomeUnknown) {
                    await settleClaim(claim.claimId, 'unknown', { error: result.error });
                } else {
                    await settleClaim(claim.claimId, 'failed', { retryable: true, error: result.error });
                }
                claim.settled = true;
                await pool.query(
                    `INSERT INTO sms_reminders
                        (school_id, parent_id, student_id, cycle_key, phone, message, payment_link_id, status, provider_message_id, sent_at, failure_reason)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        schoolId, parentId, scope.studentId, cycleKey, scope.parent.phone, message, linkRow.id,
                        result.success ? 'sent' : 'failed', result.providerMessageId, result.success ? new Date() : null, result.error,
                    ]
                );
                if (result.success) success += 1;
                else if (result.outcomeUnknown) { unknown += 1; failure += 1; }
                else failure += 1;
            } catch (perParentError) {
                // One bad parent must never abort the rest of the cycle. If
                // the SMS hadn't been sent yet, the claim is released for a
                // retry; if it had, the claim already holds the outcome.
                console.error(`Friday job: error processing parent ${parentId} for school ${schoolId}:`, perParentError);
                if (claim && !claim.settled) {
                    await settleClaim(claim.claimId, 'failed', { retryable: true, error: perParentError.message }).catch(() => {});
                }
                failure += 1;
            }
        }

        // Sends that can still be retried keep the job open: marked 'failed'
        // with a note, so the next hourly run reclaims it and retries just
        // those parents (everyone already sent is skipped by their claim).
        const [[{ toRetry }]] = await pool.query(
            `SELECT COUNT(*) AS toRetry FROM reminder_send_claims
             WHERE school_id = ? AND cycle_key = ? AND status = 'failed' AND retryable = 1 AND attempts < ?`,
            [schoolId, cycleKey, MAX_SEND_ATTEMPTS]
        );
        await pool.query(
            `UPDATE scheduled_jobs SET status = ?, finished_at = NOW(), processed_count = ?, success_count = ?, failure_count = ?, error_message = ? WHERE id = ?`,
            [toRetry ? 'failed' : 'completed', processed, success, failure,
                toRetry ? `${toRetry} send(s) to retry on the next run` : null, jobId]
        );
        retryPending = Number(toRetry);
    } catch (error) {
        await pool.query(
            `UPDATE scheduled_jobs SET status = 'failed', finished_at = NOW(), processed_count = ?, success_count = ?, failure_count = ?, error_message = ? WHERE id = ?`,
            [processed, success, failure, String(error.message || error).slice(0, 500), jobId]
        );
        throw error;
    }

    return { jobId, cycleKey, processed, success, failure, unknown, retryPending, retryRun: lock.retryRun };
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
    // Suspended schools and lapsed subscriptions get no reminders (and so
    // spend none of the platform's SMS credit).
    const [schools] = await pool.query(`SELECT s.id FROM schools s WHERE s.friday_reminders_enabled = 1 AND ${SCHOOL_IS_OPEN_SQL}`);
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

module.exports = { runFridayJobForSchool, runFridayJobForAllSchools, fridayCycleKey, claimParent, MAX_SEND_ATTEMPTS };
