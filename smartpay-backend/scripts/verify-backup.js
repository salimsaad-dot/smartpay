// Restore drill: proves a downloaded SmartPay backup actually restores.
// Decrypts it, restores it into a scratch database on YOUR LOCAL MySQL
// (XAMPP, from .env), checks every table's row count against the backup's
// own manifest, then drops the scratch database. Never touches production.
//
// Usage (from smartpay-backend, after downloading and unzipping the
// artifact from GitHub > Actions > Database Backup > a run > Artifacts):
//   BACKUP_ENCRYPTION_KEY=... node scripts/verify-backup.js path/to/smartpay-backup-YYYY-MM-DD.sql.enc
// Add --keep to leave the scratch database (smartpay_restore_check) for a look.
//
// For a REAL disaster: decrypt with
//   openssl enc -d -aes-256-cbc -pbkdf2 -in FILE.sql.enc -out FILE.sql -pass pass:"$BACKUP_ENCRYPTION_KEY"
// then load FILE.sql into the new database (e.g. mysql ... < FILE.sql).
require('dotenv').config({ quiet: true });
const fs = require('fs');
const { decryptOpensslAes256Cbc, restoreAndVerify, dropDatabase } = require('../utils/backupRestore');

const file = process.argv.find((a) => a.endsWith('.enc') || a.endsWith('.sql'));
const keep = process.argv.includes('--keep');
const SCRATCH = 'smartpay_restore_check';

(async () => {
    if (!file) {
        console.error('Usage: BACKUP_ENCRYPTION_KEY=... node scripts/verify-backup.js path/to/smartpay-backup-YYYY-MM-DD.sql.enc');
        process.exit(1);
    }
    const raw = fs.readFileSync(file);
    let sql;
    if (file.endsWith('.enc')) {
        const key = (process.env.BACKUP_ENCRYPTION_KEY || '').trim();
        if (!key) {
            console.error('Set BACKUP_ENCRYPTION_KEY to the backup password.');
            process.exit(1);
        }
        sql = decryptOpensslAes256Cbc(raw, key);
        console.log('Decrypted OK.');
    } else {
        sql = raw.toString('utf8');
    }
    const generated = sql.match(/^-- Generated (\S+)/m)?.[1] || 'unknown time';

    const config = {
        host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER, password: process.env.DB_PASSWORD || '',
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    };
    console.log(`Restoring backup from ${generated} into scratch database "${SCRATCH}" on ${config.host}...`);
    const result = await restoreAndVerify(sql, { ...config, database: SCRATCH });
    if (!keep) await dropDatabase(config, SCRATCH);

    if (result.mismatches.length) {
        console.error(`FAILED: ${result.mismatches.length} table(s) restored with the wrong number of rows:`);
        for (const m of result.mismatches) console.error(`  ${m.table}: expected ${m.expected}, restored ${m.restored}`);
        process.exit(1);
    }
    console.log(`PASSED: all ${result.tables} tables restored, ${result.rows} rows, every count matches.${keep ? ` Scratch database "${SCRATCH}" kept.` : ''}`);
    process.exit(0);
})().catch((error) => {
    console.error('Restore check failed:', error.message);
    process.exit(1);
});
