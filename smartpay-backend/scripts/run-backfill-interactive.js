// Run this yourself: node scripts/run-backfill-interactive.js
// Prompts for connection details interactively (password hidden) — nothing
// is hardcoded or logged. Uses mysql2, the same driver the live backend
// already uses successfully against this exact database.
const mysql = require('mysql2/promise');
const readline = require('readline');

function ask(question, { hidden = false } = {}) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        if (!hidden) {
            rl.question(question, (answer) => { rl.close(); resolve(answer); });
            return;
        }
        // Hide input for the password prompt.
        const output = process.stdout;
        let muted = false;
        rl._writeToOutput = function (stringToWrite) {
            if (!muted) output.write(stringToWrite);
        };
        rl.question(question, (answer) => {
            rl.close();
            output.write('\n');
            resolve(answer);
        });
        muted = true;
    });
}

(async () => {
    console.log('SmartPay production backfill: is_primary parent fix\n');
    const host = (await ask('Host [mysql-1f2465ab-smartpay-db.l.aivencloud.com]: ')) || 'mysql-1f2465ab-smartpay-db.l.aivencloud.com';
    const port = (await ask('Port [26515]: ')) || '26515';
    const user = (await ask('User [avnadmin]: ')) || 'avnadmin';
    const password = await ask('Password: ', { hidden: true });
    const database = (await ask('Database [smartpay_db]: ')) || 'smartpay_db';

    console.log('\nConnecting...');
    const connection = await mysql.createConnection({
        host, port: Number(port), user, password, database,
        ssl: { rejectUnauthorized: false },
    });
    console.log('Connected.');

    const [[{ affected: before }]] = await connection.query(`
        SELECT COUNT(DISTINCT ps.student_id) AS affected
        FROM parent_student ps
        LEFT JOIN (SELECT DISTINCT student_id FROM parent_student WHERE is_primary = 1) hp ON hp.student_id = ps.student_id
        WHERE hp.student_id IS NULL
    `);
    console.log(`Students with a linked parent but no primary parent: ${before}`);

    if (before === 0) {
        console.log('Nothing to backfill. Done.');
        await connection.end();
        return;
    }

    const [result] = await connection.query(`
        UPDATE parent_student ps
        JOIN (
            SELECT student_id, MIN(id) AS first_link_id
            FROM parent_student
            GROUP BY student_id
        ) first_links
            ON first_links.student_id = ps.student_id AND first_links.first_link_id = ps.id
        LEFT JOIN (
            SELECT DISTINCT student_id FROM parent_student WHERE is_primary = 1
        ) has_primary
            ON has_primary.student_id = ps.student_id
        SET ps.is_primary = 1
        WHERE has_primary.student_id IS NULL
    `);
    console.log(`Backfill complete. Rows updated: ${result.affectedRows}`);

    await connection.end();
})().catch((e) => {
    console.error('Failed:', e.message);
    process.exit(1);
});
