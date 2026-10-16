const pool = require('../db');
// Through the module object (not destructured) so tests can stub the job.
const fridayJob = require('../utils/fridayJob');
const { reconcileOnlinePayments } = require('../utils/paymentReconciler');
// Module object, not destructured, so tests can intercept alerts.
const opsAlert = require('../utils/opsAlert');

exports.list = async (req, res) => {
    try {
        const [jobs] = await pool.query(
            `SELECT * FROM scheduled_jobs WHERE school_id = ? ORDER BY started_at DESC LIMIT 50`,
            [req.user.schoolId]
        );
        res.status(200).json({ status: 'success', data: jobs });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while fetching job history.' });
    }
};

// The spec's explicit "protected manual test/run endpoint for
// development/admin troubleshooting" — lets a school admin trigger their
// own Friday cycle on demand (to test their template/settings, or to
// manually catch up a cycle) without needing the real weekly scheduler.
// Scoped to only the caller's own school, unlike the cron endpoint below.
// Time-sliced like the cron (utils/fridayJob.js): a big school comes back
// with paused: true and the page calls again until it's done, so no single
// request runs long enough to be cut off by the proxy.
const MANUAL_SLICE_MS = 20 * 1000;
exports.manualRun = async (req, res) => {
    try {
        const result = await fridayJob.runFridayJobForSchool(req.user.schoolId, { deadline: Date.now() + MANUAL_SLICE_MS });
        if (!result) {
            return res.status(200).json({ status: 'success', message: 'This cycle was already run (or is currently running) — nothing more to do.', data: null });
        }
        res.status(200).json({ status: 'success', message: result.paused ? 'Sending... more to go.' : 'Friday reminder cycle completed.', data: result });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while running the reminder cycle.' });
    }
};

// Called by the external scheduler (a cron-triggered CI workflow or host
// scheduler), never by a logged-in admin — see routes/cronRoutes.js for
// the secret-header guard. Runs every active, Friday-enabled school's
// cycle in one call, each isolated from the others' failures.
// Loud on failure (2026-10-16): a school whose run crashed, or whose every
// SMS failed (provider down or out of credit), makes this return 502, so
// the workflow fails and GitHub emails the owner. Partial failures (a few
// bad phone numbers) don't fail the run but are emailed with the counts.
// Each call is one time slice (FRIDAY_SLICE_SECONDS, default 45); the
// response's more: true tells the workflow to call again.
exports.runForAllSchools = async (req, res) => {
    try {
        const sliceMs = (Number(process.env.FRIDAY_SLICE_SECONDS) || 45) * 1000;
        const results = await fridayJob.runFridayJobForAllSchools({ deadline: Date.now() + sliceMs });
        const crashed = results.filter((r) => r.error);
        // A retry run that re-attempts only the few earlier failures isn't
        // "every SMS failed"; that alarm is for a school's first run.
        const allFailed = results.filter((r) => r.result && !r.result.retryRun && r.result.failure > 0 && r.result.success === 0);
        const someFailed = results.filter((r) => r.result && r.result.failure > 0 && r.result.success > 0);
        if (crashed.length || allFailed.length || someFailed.length) {
            const [schools] = await pool.query('SELECT id, name FROM schools WHERE id IN (?)',
                [[...crashed, ...allFailed, ...someFailed].map((r) => r.schoolId)]);
            const name = (id) => schools.find((s) => s.id === id)?.name || `school ${id}`;
            await opsAlert.alertOwner(`friday:${new Date().toISOString().slice(0, 13)}`, 'Friday reminders had problems', [
                ...crashed.map((r) => `${name(r.schoolId)}: the run crashed (${r.error})`),
                ...allFailed.map((r) => `${name(r.schoolId)}: all ${r.result.failure} SMS failed (provider down or out of credit?)`),
                ...someFailed.map((r) => `${name(r.schoolId)}: ${r.result.failure} of ${r.result.processed} SMS failed (check those parents' phone numbers)`),
            ]);
        }
        const loud = crashed.length > 0 || allFailed.length > 0;
        res.status(loud ? 502 : 200).json({ status: loud ? 'error' : 'success', more: fridayJob.hasMoreWork(results), data: results });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while running the Friday job.' });
    }
};

// Called by the reconcile-payments GitHub Actions workflow every 30 minutes
// (cron-secret protected, no login). Returns 502 when any check failed, so
// the workflow's curl -f fails and GitHub emails the owner instead of the
// problem staying silent.
exports.reconcilePayments = async (req, res) => {
    try {
        const summary = await reconcileOnlinePayments();
        if (summary.credited) {
            await opsAlert.alertOwner(`reconcile-credited:${new Date().toISOString().slice(0, 13)}`, `Reconciliation credited ${summary.credited} payment(s) the webhook missed`, [
                'Parents paid and are now credited; nothing to fix for them.',
                'If this keeps happening, Paystack webhooks are not reaching SmartPay: check the webhook URL in the Paystack dashboard.',
            ]);
        }
        res.status(summary.errors.length ? 502 : 200).json({ status: summary.errors.length ? 'error' : 'success', data: summary });
    } catch (error) {
        console.error('Payment reconciliation failed:', error);
        res.status(500).json({ status: 'error', message: 'Server error while reconciling payments.' });
    }
};
