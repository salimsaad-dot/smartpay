// Adds payments.idempotency_key + UNIQUE (school_id, idempotency_key), so a
// "Record payment" submission sent twice (double-click, network retry, two
// tabs) is stored once (added 2026-10-16). Purely additive: a nullable
// column and an index; NULL keys (all existing rows, online payments) are
// allowed any number of times by a UNIQUE index.
//
// Must be run on production BEFORE the code using it is deployed (see
// DESIGN.md, 2026-10-07 login incident). Idempotent — safe to re-run.
const pool = require('../db');

(async () => {
    const [[column]] = await pool.query(
        `SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments' AND COLUMN_NAME = 'idempotency_key'`
    );
    if (column.c === 0) {
        await pool.query('ALTER TABLE payments ADD COLUMN idempotency_key VARCHAR(64) DEFAULT NULL AFTER reference');
        console.log('Added payments.idempotency_key.');
    } else {
        console.log('payments.idempotency_key already exists, skipping.');
    }

    const [[index]] = await pool.query(
        `SELECT COUNT(*) AS c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments' AND INDEX_NAME = 'unique_payment_idempotency'`
    );
    if (index.c === 0) {
        await pool.query('ALTER TABLE payments ADD UNIQUE KEY unique_payment_idempotency (school_id, idempotency_key)');
        console.log('Added unique index on (school_id, idempotency_key).');
    } else {
        console.log('Unique index already exists, skipping.');
    }
    console.log(`Done (database: ${process.env.DB_NAME}).`);
    process.exit(0);
})().catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
});
