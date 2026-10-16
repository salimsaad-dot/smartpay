const pool = require('../db');
const { SCHOOL_IS_OPEN_SQL } = require('./schoolAccess');
const { createPaymentLink } = require('./paymentLink');
const { renderTemplate, redactPaymentLinks } = require('./smsTemplate');
const { resolveReminderScope, buildVariables, getTemplate } = require('./reminderCore');
const smsProvider = require('./smsProvider');
const opsAlert = require('./opsAlert');
const smsAllowance = require('./smsAllowance');

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

// Time-sliced runs (2026-10-16). A call works until its deadline, then
// stops cleanly and marks the school's job 'paused'; the next call resumes.
// This keeps every HTTP call short (the scheduler and the host both time
// out long requests) however many schools and parents there are. Within a
// call, a few schools and a few parents per school are sent at once:
// 2 x 4 = 8 at most, under the DB pool's 10 connections.
const SCHOOL_CONCURRENCY = 2;
const PARENT_CONCURRENCY = 4;

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

// Parents are sent to in parallel, so a deadlock on payment_links is
// possible in principle; MySQL rolls one side back, and it's safe to rerun.
async function createLinkWithRetry(schoolId, parentId, attempts = 3) {
    for (let attempt = 1; ; attempt += 1) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const link = await createPaymentLink(connection, { schoolId, parentId, createdBy: null });
            await connection.commit();
            return link;
        } catch (err) {
            await connection.rollback();
            if (err.code !== 'ER_LOCK_DEADLOCK' || attempt >= attempts) throw err;
        } finally {
            connection.release();
        }
    }
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
        // 'failed' (including a run left with sends to retry), 'paused' (out
        // of time, more parents to go), or a stale 'running' row: reclaim it,
        // but only if no other run beat us to it.
        const [update] = await pool.query(
            `UPDATE scheduled_jobs SET status = 'running', started_at = NOW(), finished_at = NULL, error_message = NULL
             WHERE id = ? AND (status IN ('failed', 'paused') OR (status = 'running' AND started_at < NOW() - INTERVAL ? MINUTE))`,
            [existing.id, STALE_LOCK_MINUTES]
        );
        return update.affectedRows ? { id: existing.id, retryRun: existing.status === 'failed', resumed: existing.status === 'paused' } : null;
    }
}

// Runs the Friday reminder cycle for one school. Returns a summary of
// what happened, or null if this cycle was already completed/in progress
// (the lock wasn't acquired, so nothing was done).
async function runFridayJobForSchool(schoolId, { now = new Date(), respectSendTime = false, deadline = null, parentConcurrency = PARENT_CONCURRENCY } = {}) {
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
    // A resumed slice adds to the counts of the slices before it.
    const countsSql = lock.resumed
        ? 'processed_count = processed_count + ?, success_count = success_count + ?, failure_count = failure_count + ?'
        : 'processed_count = ?, success_count = ?, failure_count = ?';

    let processed = 0, success = 0, failure = 0, unknown = 0, retryPending = 0, left = 0;
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
            WHERE i.school_id = ? AND i.balance > 0 AND i.status != 'void'
              AND ps.parent_id NOT IN (
                  SELECT c.parent_id FROM reminder_send_claims c
                  WHERE c.school_id = ? AND c.cycle_key = ? AND NOT (c.status = 'failed' AND c.retryable = 1 AND c.attempts < ?))`;
        const params = [schoolId, schoolId, cycleKey, MAX_SEND_ATTEMPTS];
        if (school.reminder_min_balance != null) {
            sql += ' AND i.balance >= ?';
            params.push(school.reminder_min_balance);
        }
        const [parentRows] = await pool.query(sql, params);

        const template = await getTemplate(schoolId, { templateId: school.friday_template_id, preferType: 'friday_reminder' });
        // The school's monthly SMS allowance (utils/smsAllowance.js).
        let { remaining: smsRemaining } = await smsAllowance.getAllowance(schoolId);

        // One parent's whole send. Several run at once (PARENT_CONCURRENCY);
        // claims make that safe, as they already did for overlapping runs.
        const processParent = async (parentId) => {
            processed += 1;
            let claim = null;
            let reserved = false;
            try {
                if (school.reminder_cooldown_days != null) {
                    const [[recent]] = await pool.query(
                        `SELECT id FROM sms_reminders
                         WHERE school_id = ? AND parent_id = ? AND status IN ('sent', 'delivered')
                           AND sent_at >= DATE_SUB(?, INTERVAL ? DAY)
                         ORDER BY sent_at DESC LIMIT 1`,
                        [schoolId, parentId, now, school.reminder_cooldown_days]
                    );
                    if (recent) return; // still in cooldown — not counted as a failure, simply not due yet
                }

                // Same-cycle duplicate prevention: if this exact cycle
                // already reminded this parent (e.g. a crashed-and-resumed
                // run), skip rather than resend — "never blindly resend
                // successful messages."
                const [[alreadyThisCycle]] = await pool.query(
                    `SELECT id FROM sms_reminders WHERE school_id = ? AND parent_id = ? AND cycle_key = ? AND status IN ('sent', 'delivered') LIMIT 1`,
                    [schoolId, parentId, cycleKey]
                );
                if (alreadyThisCycle) return;

                const { error, ...scope } = await resolveReminderScope(schoolId, { parentId });
                if (error) return; // balance was paid off between the query above and now — nothing to remind about

                claim = await claimParent(schoolId, parentId, cycleKey);
                if (!claim) return; // sent, unknown, permanently failed, out of attempts, or being sent by another run

                if (!template) {
                    await pool.query(
                        `INSERT INTO sms_reminders (school_id, parent_id, student_id, cycle_key, phone, message, status, failure_reason)
                         VALUES (?, ?, ?, ?, ?, '', 'failed', 'No active SMS template configured.')`,
                        [schoolId, parentId, scope.studentId, cycleKey, scope.parent.phone]
                    );
                    await settleClaim(claim.claimId, 'failed', { error: 'No active SMS template configured.' });
                    failure += 1;
                    return;
                }

                if (!smsProvider.normalizePhoneNumber(scope.parent.phone)) {
                    await pool.query(
                        `INSERT INTO sms_reminders (school_id, parent_id, student_id, cycle_key, phone, message, status, failure_reason)
                         VALUES (?, ?, ?, ?, ?, '', 'failed', 'Invalid or missing phone number.')`,
                        [schoolId, parentId, scope.studentId, cycleKey, scope.parent.phone || '']
                    );
                    await settleClaim(claim.claimId, 'failed', { error: 'Invalid or missing phone number.' });
                    failure += 1;
                    return;
                }

                const link = await createLinkWithRetry(schoolId, parentId);
                const linkRow = { id: link.id };

                const variables = await buildVariables(schoolId, scope, link.url, school, template.body);
                const message = renderTemplate(template.body, variables);
                if (message.length > smsAllowance.MAX_RENDERED_LENGTH) {
                    await settleClaim(claim.claimId, 'failed', { error: 'Message too long to send.' });
                    claim.settled = true;
                    failure += 1;
                    return;
                }
                if (smsRemaining <= 0) {
                    await settleClaim(claim.claimId, 'failed', { error: 'Monthly SMS allowance reached.' });
                    claim.settled = true;
                    failure += 1;
                    return;
                }
                // Reserve one before sending (other parents are sending at the
                // same time); given back below if this send doesn't succeed.
                smsRemaining -= 1;
                reserved = true;

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
                        schoolId, parentId, scope.studentId, cycleKey, scope.parent.phone, redactPaymentLinks(message), linkRow.id,
                        result.success ? 'sent' : 'failed', result.providerMessageId, result.success ? new Date() : null, result.error,
                    ]
                );
                if (result.success) success += 1;
                else if (result.outcomeUnknown) { unknown += 1; failure += 1; }
                else { failure += 1; smsRemaining += 1; }
            } catch (perParentError) {
                // One bad parent must never abort the rest of the cycle. If
                // the SMS hadn't been sent yet, the claim is released for a
                // retry; if it had, the claim already holds the outcome.
                console.error(`Friday job: error processing parent ${parentId} for school ${schoolId}:`, perParentError);
                if (reserved && !claim.settled) smsRemaining += 1;
                if (claim && !claim.settled) {
                    await settleClaim(claim.claimId, 'failed', { retryable: true, error: perParentError.message }).catch(() => {});
                }
                failure += 1;
            }
        };

        // Workers take the next parent until the list or the time runs out.
        // Out of time = 'paused': the next call (the workflow loops, and the
        // hourly cron is a backstop) resumes, and parents already settled
        // this cycle are left out of the list above.
        let next = 0;
        const worker = async () => {
            while (next < parentRows.length) {
                if (deadline && Date.now() >= deadline) return;
                const { parent_id: parentId } = parentRows[next];
                next += 1;
                await processParent(parentId);
            }
        };
        await Promise.all(Array.from({ length: Math.min(parentConcurrency, parentRows.length) }, worker));
        left = parentRows.length - next;

        if (success) await smsAllowance.noteUsage(schoolId);

        // Sends that can still be retried keep the job open: marked 'failed'
        // with a note, so the next hourly run reclaims it and retries just
        // those parents (everyone already sent is skipped by their claim).
        const [[{ toRetry }]] = await pool.query(
            `SELECT COUNT(*) AS toRetry FROM reminder_send_claims
             WHERE school_id = ? AND cycle_key = ? AND status = 'failed' AND retryable = 1 AND attempts < ?`,
            [schoolId, cycleKey, MAX_SEND_ATTEMPTS]
        );
        const status = left ? 'paused' : toRetry ? 'failed' : 'completed';
        const note = left ? `${left} parent(s) still to go; continuing on the next run`
            : toRetry ? `${toRetry} send(s) to retry on the next run` : null;
        await pool.query(
            `UPDATE scheduled_jobs SET status = ?, finished_at = NOW(), ${countsSql}, error_message = ? WHERE id = ?`,
            [status, processed, success, failure, note, jobId]
        );
        retryPending = Number(toRetry);
    } catch (error) {
        await pool.query(
            `UPDATE scheduled_jobs SET status = 'failed', finished_at = NOW(), ${countsSql}, error_message = ? WHERE id = ?`,
            [processed, success, failure, String(error.message || error).slice(0, 500), jobId]
        );
        throw error;
    }

    return { jobId, cycleKey, processed, success, failure, unknown, retryPending, retryRun: lock.retryRun, paused: left > 0, left };
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
    let next = 0;
    const worker = async () => {
        while (next < schools.length) {
            if (options.deadline && Date.now() >= options.deadline) return;
            const { id } = schools[next];
            next += 1;
            try {
                const result = await runFridayJobForSchool(id, { respectSendTime: true, ...options });
                results.push({ schoolId: id, result });
            } catch (error) {
                console.error(`Friday job: school ${id} failed entirely:`, error);
                results.push({ schoolId: id, error: String(error.message || error) });
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(SCHOOL_CONCURRENCY, schools.length) }, worker));
    // Out of time before reaching these schools: the next call starts them.
    for (const { id } of schools.slice(next)) results.push({ schoolId: id, notStarted: true });
    return results;
}

// More to do after this call: a school paused, or one not reached yet.
const hasMoreWork = (results) => results.some((r) => r.notStarted || r.result?.paused);

module.exports = { runFridayJobForSchool, runFridayJobForAllSchools, hasMoreWork, fridayCycleKey, claimParent, MAX_SEND_ATTEMPTS };
