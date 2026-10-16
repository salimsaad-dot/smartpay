// Adds schools.sms_monthly_limit (added 2026-10-16): the most SMS a school
// may send per calendar month on the platform's shared SMS account. NULL =
// no limit, which every existing school gets, so nothing changes until the
// owner sets one in the console. Idempotent.
//
// Run automatically on server start (utils/migrations.js).
const pool = require('../db');

(async () => {
    const [[column]] = await pool.query(
        `SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schools' AND COLUMN_NAME = 'sms_monthly_limit'`
    );
    if (column.c === 0) {
        await pool.query('ALTER TABLE schools ADD COLUMN sms_monthly_limit INT DEFAULT NULL AFTER paid_until');
        console.log('Added schools.sms_monthly_limit.');
    } else {
        console.log('schools.sms_monthly_limit already exists, skipping.');
    }
    process.exit(0);
})().catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
});
