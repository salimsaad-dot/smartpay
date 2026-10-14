// Adds schools.momo_account_name — the registered name parents see on the
// MoMo confirmation prompt, used by the {{school_momo_name}} SMS template
// variable. Requested 2026-10-14 for Eagle Vision, whose parents pay by
// MoMo only (no payment link). Purely additive: a nullable column, no
// existing row changes.
//
// Must be run on production BEFORE the code using it is deployed (see
// DESIGN.md, 2026-10-07 login incident). Idempotent — safe to re-run.
const pool = require('../db');

(async () => {
    const [[column]] = await pool.query(
        `SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schools' AND COLUMN_NAME = 'momo_account_name'`
    );
    if (column.c > 0) {
        console.log(`momo_account_name already exists on schools (database: ${process.env.DB_NAME}), skipping.`);
        process.exit(0);
    }

    await pool.query('ALTER TABLE schools ADD COLUMN momo_account_name VARCHAR(100) DEFAULT NULL AFTER momo_number');
    console.log(`Added schools.momo_account_name (database: ${process.env.DB_NAME}).`);
    process.exit(0);
})().catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
});
