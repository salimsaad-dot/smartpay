// Regenerates schema.sql (structure only, no data) from whatever database
// this machine's .env currently points at. Run manually after any schema
// change — this project has no migrations directory by convention, same
// as Academia Hub — schema.sql exists only to bootstrap a throwaway
// database in CI, not as a source of truth (the live database is that).
const fs = require('fs');
const path = require('path');
const db = require('../db');

(async () => {
    const [tableRows] = await db.query('SHOW TABLES');
    const tableNames = tableRows.map((row) => Object.values(row)[0]);

    let sql = '-- SmartPay schema (structure only, no data) — generated for CI database bootstrapping.\n' +
        '-- Not a migrations system; this project has no tracked migrations directory by convention.\n' +
        '-- Regenerate after any schema change: node scripts/generate-schema.js\n\n' +
        'SET FOREIGN_KEY_CHECKS=0;\n\n';

    for (const table of tableNames) {
        const [[createRow]] = await db.query(`SHOW CREATE TABLE \`${table}\``);
        sql += `DROP TABLE IF EXISTS \`${table}\`;\n${createRow['Create Table']};\n\n`;
    }

    sql += 'SET FOREIGN_KEY_CHECKS=1;\n';

    fs.writeFileSync(path.join(__dirname, '..', 'schema.sql'), sql);
    console.log(`schema.sql written: ${tableNames.length} tables, ${sql.length} bytes.`);
    await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
