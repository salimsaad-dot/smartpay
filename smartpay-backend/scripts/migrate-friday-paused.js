// Adds 'paused' to scheduled_jobs.status (added 2026-10-16): the Friday run
// is now time-sliced, and a school's job that ran out of time in one call
// is 'paused' until the next call resumes it (utils/fridayJob.js).
// Idempotent.
//
// Run automatically on server start (utils/migrations.js).
const pool = require('../db');

(async () => {
    const [[column]] = await pool.query(
        `SELECT COLUMN_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scheduled_jobs' AND COLUMN_NAME = 'status'`
    );
    if (!column.type.includes('paused')) {
        await pool.query(`ALTER TABLE scheduled_jobs MODIFY status ENUM('running', 'completed', 'failed', 'paused') NOT NULL DEFAULT 'running'`);
        console.log("scheduled_jobs.status now includes 'paused'.");
    } else {
        console.log("scheduled_jobs.status already includes 'paused', skipping.");
    }
    process.exit(0);
})().catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
});
