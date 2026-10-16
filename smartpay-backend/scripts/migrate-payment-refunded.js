// Adds 'refunded' to payments.status (added 2026-10-16): an online payment
// Paystack reports as reversed or refunded stops counting toward the
// invoice, without being confused with a bursar's void. Purely additive:
// the enum gains one value, every existing row keeps its status.
//
// Must be run on production BEFORE the code using it is deployed (see
// DESIGN.md, 2026-10-07 login incident). Idempotent — safe to re-run.
const pool = require('../db');

(async () => {
    const [[column]] = await pool.query(
        `SELECT COLUMN_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments' AND COLUMN_NAME = 'status'`
    );
    if (column.type.includes("'refunded'")) {
        console.log(`payments.status already allows 'refunded' (database: ${process.env.DB_NAME}), skipping.`);
        process.exit(0);
    }
    await pool.query(
        `ALTER TABLE payments MODIFY COLUMN status ENUM('initiated','pending','success','failed','cancelled','void','refunded') NOT NULL DEFAULT 'success'`
    );
    console.log(`payments.status now allows 'refunded' (database: ${process.env.DB_NAME}).`);
    process.exit(0);
})().catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
});
