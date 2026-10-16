const fs = require('fs');
const path = require('path');
const db = require('../db');
const { runPendingMigrations, MIGRATIONS } = require('../utils/migrations');

// Migrations apply themselves on server start (2026-10-16), replacing the
// "remember to run this script on production before deploying" step that
// once caused a login outage.
describe('automatic database migrations (real DB)', () => {
    afterAll(() => db.end());
    const quiet = () => {};

    test('every scripts/migrate-*.js file is registered, so none can be forgotten', () => {
        const scripts = fs.readdirSync(path.join(__dirname, '..', 'scripts'))
            .filter((f) => /^migrate-.*\.js$/.test(f)).map((f) => f.replace(/\.js$/, ''));
        expect(scripts.sort()).toEqual([...MIGRATIONS].sort());
    });

    test('applies what is missing, records it, and does nothing the second time', async () => {
        // Forget two migrations so the runner has real work; both are idempotent.
        await db.query("DELETE FROM schema_migrations WHERE name IN ('migrate-payment-refunded', 'migrate-reminder-claims')").catch(() => {});
        const first = await runPendingMigrations({ log: quiet });
        expect(first).toEqual(expect.arrayContaining(['migrate-payment-refunded', 'migrate-reminder-claims']));

        const [rows] = await db.query('SELECT name FROM schema_migrations');
        expect(rows.map((r) => r.name)).toEqual(expect.arrayContaining(MIGRATIONS));

        expect(await runPendingMigrations({ log: quiet })).toEqual([]);
    }, 180000);

    test('a failing migration stops the run, is not recorded, and releases the lock', async () => {
        await expect(runPendingMigrations({ migrations: ['migrate-does-not-exist'], log: quiet })).rejects.toThrow(/migrate-does-not-exist failed/);
        const [[{ n }]] = await db.query("SELECT COUNT(*) AS n FROM schema_migrations WHERE name = 'migrate-does-not-exist'");
        expect(n).toBe(0);
        // The lock was released: a normal run proceeds immediately.
        expect(await runPendingMigrations({ log: quiet })).toEqual([]);
    }, 60000);

    test('two runners starting together: one migrates, the other finds nothing left', async () => {
        await db.query("DELETE FROM schema_migrations WHERE name = 'migrate-demo-requests'");
        const [a, b] = await Promise.all([runPendingMigrations({ log: quiet }), runPendingMigrations({ log: quiet })]);
        expect([...a, ...b].filter((n) => n === 'migrate-demo-requests')).toHaveLength(1);
    }, 120000);
});
