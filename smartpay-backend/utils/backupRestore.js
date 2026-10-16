const crypto = require('crypto');
const mysql = require('mysql2/promise');
const { END_MARKER } = require('./backupSql');

// Restoring and checking SmartPay backups (added 2026-10-16). Used by
// scripts/verify-backup.js (restore drill on a downloaded backup) and by
// tests/backup.integration.test.js (proves every backup restores).

// The database-backup workflow encrypts with
//   openssl enc -aes-256-cbc -salt -pbkdf2 -pass pass:KEY
// whose file format is "Salted__" + 8-byte salt + ciphertext, with key and
// IV from PBKDF2-HMAC-SHA256 (10,000 iterations). Done here in Node so a
// restore needs no openssl install. The same command with -d also decrypts.
function deriveKeyIv(passphrase, salt) {
    const bytes = crypto.pbkdf2Sync(passphrase, salt, 10000, 48, 'sha256');
    return { key: bytes.subarray(0, 32), iv: bytes.subarray(32, 48) };
}

function decryptOpensslAes256Cbc(buffer, passphrase) {
    if (buffer.subarray(0, 8).toString('latin1') !== 'Salted__') {
        throw new Error('Not an encrypted SmartPay backup (missing "Salted__" header).');
    }
    const salt = buffer.subarray(8, 16);
    const { key, iv } = deriveKeyIv(passphrase, salt);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    try {
        return Buffer.concat([decipher.update(buffer.subarray(16)), decipher.final()]).toString('utf8');
    } catch {
        throw new Error('Could not decrypt the backup: wrong BACKUP_ENCRYPTION_KEY, or the file is damaged.');
    }
}

// Same format as openssl's encrypt; used by the tests.
function encryptOpensslAes256Cbc(text, passphrase) {
    const salt = crypto.randomBytes(8);
    const { key, iv } = deriveKeyIv(passphrase, salt);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([Buffer.from('Salted__', 'latin1'), salt, cipher.update(text, 'utf8'), cipher.final()]);
}

function parseManifest(sql) {
    if (!sql.includes(END_MARKER)) throw new Error('Backup is incomplete: the end-of-backup marker is missing.');
    const counts = {};
    for (const [, table, n] of sql.matchAll(/^-- ROWS (\S+) (\d+)$/gm)) counts[table] = Number(n);
    return counts;
}

// The generator ends every statement with ";\n", and string values never
// contain a raw newline (escaped as \n), so splitting there is safe. One
// statement at a time keeps each under a small max_allowed_packet (XAMPP
// ships 1MB).
function splitStatements(sql) {
    return sql.split(/;\n/).map((s) => s.trim()).filter((s) => s && !/^(--[^\n]*\n?)+$/.test(s));
}

// Restores into a fresh, separate database (never the live one) and
// compares each table's row count with the manifest.
async function restoreAndVerify(sql, { host, port, user, password, ssl, database }) {
    if (!/restore|scratch|verify|test/i.test(database)) {
        throw new Error(`Refusing to restore into "${database}": use a scratch database name containing "restore" or "test".`);
    }
    const expected = parseManifest(sql);
    const conn = await mysql.createConnection({ host, port, user, password, ...(ssl ? { ssl } : {}) });
    try {
        await conn.query(`DROP DATABASE IF EXISTS \`${database}\``);
        await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        await conn.query(`USE \`${database}\``);

        // MySQL 8's default collation doesn't exist in MariaDB (local XAMPP).
        const [[{ v }]] = await conn.query('SELECT VERSION() AS v');
        const body = /mariadb/i.test(v) ? sql.replace(/utf8mb4_0900_ai_ci/g, 'utf8mb4_unicode_ci') : sql;

        for (const statement of splitStatements(body)) await conn.query(statement);

        const mismatches = [];
        for (const [table, count] of Object.entries(expected)) {
            const [[{ n }]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
            if (Number(n) !== count) mismatches.push({ table, expected: count, restored: Number(n) });
        }
        return { tables: Object.keys(expected).length, rows: Object.values(expected).reduce((a, b) => a + b, 0), mismatches };
    } finally {
        await conn.end();
    }
}

async function dropDatabase(config, database) {
    const conn = await mysql.createConnection({ host: config.host, port: config.port, user: config.user, password: config.password, ...(config.ssl ? { ssl: config.ssl } : {}) });
    try {
        await conn.query(`DROP DATABASE IF EXISTS \`${database}\``);
    } finally {
        await conn.end();
    }
}

module.exports = { decryptOpensslAes256Cbc, encryptOpensslAes256Cbc, parseManifest, splitStatements, restoreAndVerify, dropDatabase };
