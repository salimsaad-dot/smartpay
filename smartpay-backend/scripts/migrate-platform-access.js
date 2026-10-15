// Owner control over which schools can use SmartPay (added 2026-10-15):
//   - schools.paid_until: subscription end date. NULL = no expiry, which
//     every existing school gets, so nothing changes for current schools.
//   - platform_admins: the owner's own login for the SmartPay console,
//     separate from every school's users.
// Create the owner account afterwards with scripts/create-platform-admin.js.
//
// Must be run on production BEFORE the code using it is deployed (see
// DESIGN.md, 2026-10-07 login incident). Idempotent — safe to re-run.
const pool = require('../db');

(async () => {
    const [[column]] = await pool.query(
        `SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schools' AND COLUMN_NAME = 'paid_until'`
    );
    if (column.c === 0) {
        await pool.query('ALTER TABLE schools ADD COLUMN paid_until DATE DEFAULT NULL AFTER status');
        console.log('Added schools.paid_until.');
    } else {
        console.log('schools.paid_until already exists, skipping.');
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS platform_admins (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            email VARCHAR(255) NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            token_version INT NOT NULL DEFAULT 1,
            failed_login_attempts INT NOT NULL DEFAULT 0,
            locked_until DATETIME DEFAULT NULL,
            last_login_at DATETIME DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_platform_admin_email (email)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log(`platform_admins is ready (database: ${process.env.DB_NAME}).`);
    process.exit(0);
})().catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
});
