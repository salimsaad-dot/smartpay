// Index for "SMS sent this month per school" (added 2026-10-16). The owner
// console counts each school's sent SMS since the 1st with
// WHERE school_id = ? AND status IN (...) AND created_at >= ?, but the only
// index was school_id, so every school's whole SMS history was scanned on
// each console load. Purely additive. Idempotent.
//
// Run automatically on server start (utils/migrations.js).
const pool = require('../db');

(async () => {
    const [[index]] = await pool.query(
        `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sms_reminders' AND INDEX_NAME = 'idx_school_status_created'`
    );
    if (index.c === 0) {
        await pool.query('ALTER TABLE sms_reminders ADD INDEX idx_school_status_created (school_id, status, created_at)');
        console.log('Added index idx_school_status_created on sms_reminders.');
    } else {
        console.log('Index idx_school_status_created already exists, skipping.');
    }
    process.exit(0);
})().catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
});
