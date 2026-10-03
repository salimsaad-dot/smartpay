const pool = require('../db');
const { runFridayJobForSchool, runFridayJobForAllSchools } = require('../utils/fridayJob');

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
exports.manualRun = async (req, res) => {
    try {
        const result = await runFridayJobForSchool(req.user.schoolId);
        if (!result) {
            return res.status(200).json({ status: 'success', message: 'This cycle was already run (or is currently running) — nothing more to do.', data: null });
        }
        res.status(200).json({ status: 'success', message: 'Friday reminder cycle completed.', data: result });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while running the reminder cycle.' });
    }
};

// Called by the external scheduler (a cron-triggered CI workflow or host
// scheduler), never by a logged-in admin — see routes/cronRoutes.js for
// the secret-header guard. Runs every active, Friday-enabled school's
// cycle in one call, each isolated from the others' failures.
exports.runForAllSchools = async (req, res) => {
    try {
        const results = await runFridayJobForAllSchools();
        res.status(200).json({ status: 'success', data: results });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while running the Friday job.' });
    }
};
