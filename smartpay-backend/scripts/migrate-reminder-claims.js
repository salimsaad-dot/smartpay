// Creates reminder_send_claims (added 2026-10-16): one row per (school,
// parent, Friday cycle), claimed BEFORE an SMS is sent, so two overlapping
// runs can never text the same parent twice, and a failed send can be
// retried later the same day. See utils/fridayJob.js. Purely additive: a
// new table, nothing existing changes. No foreign keys on purpose, so
// removing a school or parent never trips over old claim rows.
//
// Must be run on production BEFORE the code using it is deployed (see
// DESIGN.md, 2026-10-07 login incident). Idempotent — safe to re-run.
const pool = require('../db');

(async () => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS reminder_send_claims (
            id INT AUTO_INCREMENT PRIMARY KEY,
            school_id INT NOT NULL,
            parent_id INT NOT NULL,
            cycle_key VARCHAR(50) NOT NULL,
            status ENUM('sending', 'sent', 'failed', 'unknown') NOT NULL DEFAULT 'sending',
            attempts INT NOT NULL DEFAULT 1,
            retryable TINYINT(1) NOT NULL DEFAULT 1,
            last_error VARCHAR(255) DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY unique_reminder_claim (school_id, parent_id, cycle_key),
            KEY idx_claim_cycle (school_id, cycle_key, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log(`reminder_send_claims is ready (database: ${process.env.DB_NAME}).`);
    process.exit(0);
})().catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
});
