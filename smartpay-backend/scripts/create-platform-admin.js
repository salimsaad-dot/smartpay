// Creates (or resets the password of) the SmartPay owner's console login.
// There is no sign-up screen for this on purpose: only someone with
// database access can make an owner account.
//
// Usage:  node scripts/create-platform-admin.js "Your Name" you@example.com
// It then asks for the password (at least 10 characters). Running it again
// with the same email sets a new password and signs out old sessions.
const readline = require('readline');
const bcrypt = require('bcrypt');
const pool = require('../db');

const [name, email] = process.argv.slice(2);

function ask(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

(async () => {
    if (!name?.trim() || !email?.includes('@')) {
        console.error('Usage: node scripts/create-platform-admin.js "Your Name" you@example.com');
        process.exit(1);
    }
    const password = await ask('Password for the SmartPay console (at least 10 characters): ');
    if (password.length < 10) {
        console.error('Password must be at least 10 characters. Nothing was changed.');
        process.exit(1);
    }

    const hash = await bcrypt.hash(password, 10);
    const normalizedEmail = email.trim().toLowerCase();
    const [result] = await pool.query(
        `INSERT INTO platform_admins (name, email, password_hash) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), password_hash = VALUES(password_hash),
             token_version = token_version + 1, failed_login_attempts = 0, locked_until = NULL`,
        [name.trim(), normalizedEmail, hash]
    );
    console.log(result.affectedRows === 1
        ? `Created the console login for ${normalizedEmail} (database: ${process.env.DB_NAME}).`
        : `Updated the password for ${normalizedEmail} and signed out its old sessions (database: ${process.env.DB_NAME}).`);
    process.exit(0);
})().catch((error) => {
    console.error('Failed:', error.message);
    process.exit(1);
});
