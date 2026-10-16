const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { generateBackupSql, END_MARKER } = require('../utils/backupSql');
const {
    encryptOpensslAes256Cbc, decryptOpensslAes256Cbc, parseManifest, restoreAndVerify, dropDatabase,
} = require('../utils/backupRestore');

// Proves the nightly backup is a real, restorable copy (2026-10-16): build
// a backup of this database, encrypt and decrypt it the way the workflow
// and the restore script do, restore it into a scratch database, and check
// every table's row count matches.
describe('database backup (real DB)', () => {
    const SCRATCH = 'smartpay_restore_test';
    const config = {
        host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER, password: process.env.DB_PASSWORD || '',
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    };

    afterAll(async () => {
        await dropDatabase(config, SCRATCH);
        await db.end();
    });

    test('a backup encrypts, decrypts and restores with every table and row intact', async () => {
        const { sql, tables } = await generateBackupSql();
        expect(sql.trimEnd()).toContain(END_MARKER);
        const manifest = parseManifest(sql);
        expect(Object.keys(manifest)).toHaveLength(tables);

        const restoredSql = decryptOpensslAes256Cbc(encryptOpensslAes256Cbc(sql, 'test-passphrase'), 'test-passphrase');
        expect(restoredSql).toBe(sql);

        const result = await restoreAndVerify(restoredSql, { ...config, database: SCRATCH });
        expect(result.mismatches).toEqual([]);
        expect(result.tables).toBe(tables);
    }, 120000);

    test('the wrong password is refused, and a cut-off backup is rejected', async () => {
        const encrypted = encryptOpensslAes256Cbc('-- tiny\nSELECT 1;\n', 'right');
        expect(() => decryptOpensslAes256Cbc(encrypted, 'wrong')).toThrow(/wrong BACKUP_ENCRYPTION_KEY|damaged/);
        expect(() => parseManifest('-- SmartPay full database backup\nDROP TABLE IF EXISTS `x`;\n')).toThrow(/incomplete/);
    });

    test('restoring into anything that looks like the live database is refused', async () => {
        await expect(restoreAndVerify(`${END_MARKER}\n`, { ...config, database: 'smartpay_db' })).rejects.toThrow(/Refusing/);
    });

    test('the backup endpoint needs the cron secret and returns a complete backup', async () => {
        expect((await request(app).get('/api/cron/backup')).status).toBe(401);
        const res = await request(app).get('/api/cron/backup').set('x-cron-secret', process.env.CRON_SECRET);
        expect(res.status).toBe(200);
        expect(res.headers['content-disposition']).toMatch(/smartpay-backup-\d{4}-\d{2}-\d{2}\.sql/);
        expect(res.text).toContain(END_MARKER);
    }, 60000);
});
