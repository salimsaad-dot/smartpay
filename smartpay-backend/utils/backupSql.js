const pool = require('../db');

// Builds a complete, self-contained SQL backup (schema + data for every
// table) in memory; nothing is written to Render's disk. Called nightly by
// the database-backup GitHub Actions workflow via GET /api/cron/backup,
// which encrypts the result before storing it (added 2026-10-16, after a
// council audit found SmartPay had no copy of its database anywhere).
// Adapted from Academia Hub's backupController, which was proven with a
// real restore.
//
// The file ends with a manifest (row count per table) and an END marker.
// The workflow refuses to store a file without the marker, so a download
// cut off halfway fails loudly; scripts/verify-backup.js restores a backup
// into a scratch database and checks the counts against the manifest.

const END_MARKER = '-- END OF SMARTPAY BACKUP';

// GENERATED columns can't be INSERT targets; leave them out and let MySQL
// recompute them on restore (the bug that once broke an Academia Hub import).
async function generatedColumnsByTable() {
    const [rows] = await pool.query(
        `SELECT table_name AS t, column_name AS c FROM information_schema.columns
         WHERE table_schema = DATABASE() AND extra LIKE '%GENERATED%'`
    );
    const map = {};
    for (const { t, c } of rows) (map[t] ||= new Set()).add(c);
    return map;
}

async function generateBackupSql() {
    const [tableRows] = await pool.query('SHOW FULL TABLES WHERE Table_type = \'BASE TABLE\'');
    const tables = tableRows.map((row) => Object.values(row)[0]);
    const generated = await generatedColumnsByTable();
    const createdAt = new Date().toISOString();

    const parts = [
        `-- SmartPay full database backup\n-- Generated ${createdAt}\n-- Restore: scripts/verify-backup.js, or pipe into mysql.\n\n`,
        'SET FOREIGN_KEY_CHECKS=0;\nSET NAMES utf8mb4;\n\n',
    ];

    // Every CREATE first, then every INSERT, with foreign key checks off
    // (as mysqldump does), so table order never has to follow dependencies.
    for (const table of tables) {
        const [[row]] = await pool.query(`SHOW CREATE TABLE \`${table}\``);
        parts.push(`DROP TABLE IF EXISTS \`${table}\`;\n${row['Create Table']};\n\n`);
    }

    const counts = {};
    for (const table of tables) {
        const excluded = generated[table] || new Set();
        const [rows] = await pool.query(`SELECT * FROM \`${table}\``);
        counts[table] = rows.length;
        if (rows.length === 0) continue;

        const columns = Object.keys(rows[0]).filter((c) => !excluded.has(c));
        const columnList = columns.map((c) => `\`${c}\``).join(', ');
        parts.push(`-- Data for \`${table}\`\n`);
        for (let i = 0; i < rows.length; i += 500) {
            const values = rows.slice(i, i + 500).map((r) => `(${columns.map((c) => pool.escape(r[c])).join(', ')})`);
            parts.push(`INSERT INTO \`${table}\` (${columnList}) VALUES\n${values.join(',\n')};\n`);
        }
        parts.push('\n');
    }

    parts.push('SET FOREIGN_KEY_CHECKS=1;\n\n-- Manifest: rows per table at backup time\n');
    for (const table of tables) parts.push(`-- ROWS ${table} ${counts[table]}\n`);
    parts.push(`${END_MARKER} ${createdAt}\n`);

    return { sql: parts.join(''), tables: tables.length, rows: Object.values(counts).reduce((a, b) => a + b, 0), createdAt };
}

module.exports = { generateBackupSql, END_MARKER };
