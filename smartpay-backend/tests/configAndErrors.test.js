const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { checkConfig } = require('../utils/config');
const errorHandler = require('../middleware/errorHandler');

// Startup settings check and the last-resort error handler (2026-10-16).
describe('startup settings check', () => {
    const base = {
        JWT_SECRET: 'x'.repeat(40), DB_HOST: 'h', DB_USER: 'u', DB_NAME: 'n', SMS_PROVIDER: 'mnotify',
        MNOTIFY_API_KEY: 'k', PAYSTACK_SECRET_KEY: 'k', RESEND_API_KEY: 'k', GEMINI_API_KEY: 'k', DEMO_NOTIFY_EMAIL: 'a@b.c',
    };

    test('a complete local configuration has no errors or warnings', () => {
        expect(checkConfig(base)).toMatchObject({ deployed: false, errors: [], warnings: [] });
    });

    test('a missing login secret or database setting stops the server', () => {
        const { errors } = checkConfig({ ...base, JWT_SECRET: '', DB_HOST: '  ' });
        expect(errors.join(' ')).toMatch(/JWT_SECRET/);
        expect(errors.join(' ')).toMatch(/DB_HOST/);
    });

    test('a mistyped SMS_PROVIDER stops the server instead of silently using mNotify', () => {
        expect(checkConfig({ ...base, SMS_PROVIDER: 'mnotfy' }).errors.join(' ')).toMatch(/SMS_PROVIDER "mnotfy" is not recognised/);
    });

    test('on Render, FRONTEND_URL and CRON_SECRET are required too', () => {
        const { deployed, errors } = checkConfig({ ...base, RENDER: 'true' });
        expect(deployed).toBe(true);
        expect(errors.join(' ')).toMatch(/FRONTEND_URL/);
        expect(errors.join(' ')).toMatch(/CRON_SECRET/);
        expect(checkConfig({ ...base, RENDER: 'true', FRONTEND_URL: 'https://x', CRON_SECRET: 's' }).errors).toEqual([]);
    });

    test('optional features missing are warnings, not errors', () => {
        const { errors, warnings } = checkConfig({ ...base, PAYSTACK_SECRET_KEY: '', MNOTIFY_API_KEY: '', JWT_SECRET: 'short-secret' });
        expect(errors).toEqual([]);
        expect(warnings.join(' ')).toMatch(/PAYSTACK_SECRET_KEY/);
        expect(warnings.join(' ')).toMatch(/MNOTIFY_API_KEY/);
        expect(warnings.join(' ')).toMatch(/shorter than 32/);
    });
});

describe('last-resort error handler', () => {
    afterAll(() => db.end());

    const run = (err) => {
        const res = { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
        errorHandler(err, {}, res, () => {});
        return res;
    };

    test('an unexpected error is a 500 with no internal details', () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        const res = run(new Error("ER_NO_SUCH_TABLE: Table 'smartpay_db.secret_table' doesn't exist"));
        expect(res.statusCode).toBe(500);
        expect(JSON.stringify(res.body)).not.toMatch(/secret_table|ER_NO_SUCH_TABLE/);
        console.error.mockRestore();
    });

    test('known client mistakes keep a clear 4xx message', () => {
        expect(run(new Error('Not allowed by CORS')).statusCode).toBe(400);
        expect(run(Object.assign(new Error('x'), { type: 'entity.too.large' })).statusCode).toBe(413);
    });

    test('a malformed JSON body gets a plain 400 through the real app', async () => {
        const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email": ');
        expect(res.status).toBe(400);
        expect(res.body.message).toBe('The request body is not valid JSON.');
    });
});
