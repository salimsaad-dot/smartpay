// Second login step for the owner console (added 2026-10-16):
//   - platform_admins.totp_secret: the authenticator-app secret, set by
//     scripts/setup-console-2fa.js. NULL = not set up, and the console
//     refuses to log in until it is.
//   - platform_admins.totp_last_step: the time step of the last code used,
//     so the same code can't be used twice.
//   - login_attempts.scope gains 'platform_mfa', so wrong codes lock out
//     separately from wrong passwords.
// Idempotent.
//
// Run automatically on server start (utils/migrations.js).
const pool = require('../db');

async function hasColumn(table, column) {
    const [[row]] = await pool.query(
        'SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        [table, column]
    );
    return row.c > 0;
}

(async () => {
    if (!(await hasColumn('platform_admins', 'totp_secret'))) {
        await pool.query('ALTER TABLE platform_admins ADD COLUMN totp_secret VARCHAR(64) DEFAULT NULL AFTER password_hash');
        console.log('Added platform_admins.totp_secret.');
    }
    if (!(await hasColumn('platform_admins', 'totp_last_step'))) {
        await pool.query('ALTER TABLE platform_admins ADD COLUMN totp_last_step BIGINT DEFAULT NULL AFTER totp_secret');
        console.log('Added platform_admins.totp_last_step.');
    }
    const [[scope]] = await pool.query(
        `SELECT COLUMN_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'login_attempts' AND COLUMN_NAME = 'scope'`
    );
    if (!scope.type.includes('platform_mfa')) {
        await pool.query(`ALTER TABLE login_attempts MODIFY scope ENUM('school', 'platform', 'platform_mfa') NOT NULL`);
        console.log("login_attempts.scope now includes 'platform_mfa'.");
    }
    console.log(`Console two-step login columns are ready (database: ${process.env.DB_NAME}).`);
    process.exit(0);
})().catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
});
