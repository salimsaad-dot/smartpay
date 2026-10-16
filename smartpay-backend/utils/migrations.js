const path = require('path');
const { execFile } = require('child_process');
const pool = require('../db');

// Applies database migrations automatically when the server starts (added
// 2026-10-16, council fix list). Before this, each schema change was a
// script the owner had to remember to run against production BEFORE
// deploying; forgetting once already caused a login outage (DESIGN.md,
// 2026-10-07), and several changes in a row made it easy to miss one.
//
// schema_migrations records what has run. On start, server.js calls
// runPendingMigrations() before listening: any migration not yet recorded
// is run, in the order below, then recorded. If one fails, the server
// refuses to start, so Render marks the deploy failed and keeps the
// previous version serving instead of running new code on an old schema.
//
// Every migration is an existing, idempotent scripts/migrate-*.js file,
// run as its own process exactly as it was run by hand, so its behaviour
// is unchanged. ADD NEW MIGRATIONS TO THE END OF THIS LIST (a test fails
// if a scripts/migrate-*.js file is missing from it).
const MIGRATIONS = [
    'migrate-fee-types',
    'migrate-fee-eligibility',
    'migrate-fee-frequency',
    'migrate-fee-weekly-frequency',
    'migrate-momo-account-name',
    'migrate-demo-requests',
    'migrate-platform-access',
    'migrate-payment-idempotency',
    'migrate-payment-refunded',
    'migrate-reminder-claims',
    'migrate-redact-sms-links',
    'migrate-login-hardening',
    'migrate-sms-reminder-index',
    'migrate-sms-allowance',
    'migrate-console-2fa',
];

const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');
const LOCK_NAME = 'smartpay_schema_migrations';

function runScript(name) {
    return new Promise((resolve, reject) => {
        execFile(process.execPath, [path.join(SCRIPTS_DIR, `${name}.js`)], {
            cwd: path.join(__dirname, '..'), env: process.env, timeout: 5 * 60 * 1000,
        }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`${name} failed: ${(stderr || stdout || error.message).trim().slice(-500)}`));
            } else {
                resolve(stdout.trim());
            }
        });
    });
}

async function runPendingMigrations({ migrations = MIGRATIONS, log = console.log } = {}) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            name VARCHAR(100) PRIMARY KEY,
            applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Two copies starting at once (Render overlaps them during a deploy):
    // only one migrates; the other waits, then finds nothing left to do.
    const connection = await pool.getConnection();
    try {
        const [[{ locked }]] = await connection.query('SELECT GET_LOCK(?, 120) AS locked', [LOCK_NAME]);
        if (Number(locked) !== 1) throw new Error('Could not get the migration lock within 2 minutes.');
        try {
            const [rows] = await connection.query('SELECT name FROM schema_migrations');
            const done = new Set(rows.map((r) => r.name));
            const applied = [];
            for (const name of migrations) {
                if (done.has(name)) continue;
                log(`Applying migration ${name}...`);
                const output = await runScript(name);
                if (output) log(output);
                await connection.query('INSERT INTO schema_migrations (name) VALUES (?)', [name]);
                applied.push(name);
            }
            return applied;
        } finally {
            await connection.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]);
        }
    } finally {
        connection.release();
    }
}

module.exports = { runPendingMigrations, MIGRATIONS };
