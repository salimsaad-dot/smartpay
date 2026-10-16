// Login hardening (added 2026-10-16):
//   - users.must_change_password + users.temp_password_expires_at: a
//     one-time password the SmartPay owner issues (new school, admin reset)
//     works for 72 hours and must be replaced at first login.
//   - login_attempts: failed logins counted per (account, visitor address),
//     so a stranger typing wrong passwords locks only themselves out, not
//     the school's only admin (or the owner) everywhere.
// Purely additive. Idempotent.
//
// Run automatically on server start (utils/migrations.js).
const pool = require('../db');

async function columnExists(table, column) {
    const [[row]] = await pool.query(
        'SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        [table, column]
    );
    return row.c > 0;
}

(async () => {
    if (!(await columnExists('users', 'must_change_password'))) {
        await pool.query('ALTER TABLE users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0');
        console.log('Added users.must_change_password.');
    }
    if (!(await columnExists('users', 'temp_password_expires_at'))) {
        await pool.query('ALTER TABLE users ADD COLUMN temp_password_expires_at DATETIME DEFAULT NULL');
        console.log('Added users.temp_password_expires_at.');
    }
    await pool.query(`
        CREATE TABLE IF NOT EXISTS login_attempts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            scope ENUM('school', 'platform') NOT NULL,
            account_id INT NOT NULL,
            ip VARCHAR(64) NOT NULL,
            failures INT NOT NULL DEFAULT 0,
            locked_until DATETIME DEFAULT NULL,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY unique_login_attempt (scope, account_id, ip)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log(`Login hardening is ready (database: ${process.env.DB_NAME}).`);
    process.exit(0);
})().catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
});
