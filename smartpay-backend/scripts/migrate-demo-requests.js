// Creates demo_requests: leads from the SmartPay marketing site's
// "Book a demo" form (added 2026-10-15). Platform-level, not tenant data,
// so there is no school_id. Purely additive: a new table, nothing existing
// changes.
//
// Must be run on production BEFORE the code using it is deployed (see
// DESIGN.md, 2026-10-07 login incident). Idempotent — safe to re-run.
const pool = require('../db');

(async () => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS demo_requests (
            id INT AUTO_INCREMENT PRIMARY KEY,
            school_name VARCHAR(150) NOT NULL,
            contact_name VARCHAR(100) NOT NULL,
            role VARCHAR(50) DEFAULT NULL,
            phone VARCHAR(30) NOT NULL,
            email VARCHAR(150) DEFAULT NULL,
            student_count VARCHAR(20) DEFAULT NULL,
            message TEXT DEFAULT NULL,
            status ENUM('new', 'contacted', 'closed') NOT NULL DEFAULT 'new',
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log(`demo_requests is ready (database: ${process.env.DB_NAME}).`);
    process.exit(0);
})().catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
});
