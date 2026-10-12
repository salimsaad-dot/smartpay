// Adds 'weekly' to fee_types.frequency — a real gap surfaced by live
// usage: feeding fees are commonly billed weekly, not just
// termly/annual/one-time/as-needed. Purely additive (MODIFY COLUMN to
// widen the ENUM) — no existing row's value changes, nothing to
// backfill.
//
// Idempotent — safe to re-run.
const pool = require('../db');

(async () => {
    const [[column]] = await pool.query(
        `SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fee_types' AND COLUMN_NAME = 'frequency'`
    );
    if (column.COLUMN_TYPE.includes("'weekly'")) {
        console.log('weekly already present in fee_types.frequency, skipping.');
        process.exit(0);
    }

    await pool.query(
        `ALTER TABLE fee_types MODIFY COLUMN frequency ENUM('weekly','termly','annual','one_time','as_needed') NOT NULL DEFAULT 'termly'`
    );
    console.log('Added weekly to fee_types.frequency.');
    process.exit(0);
})().catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
});
