const request = require('supertest');
const app = require('../server');
const db = require('../db');

describe('auth flow (real DB, real HTTP)', () => {
    const MARKER = `CI-AUTH-${Date.now()}`;
    const email = `${MARKER.toLowerCase()}@example.com`;
    const password = 'TestPass123';
    let userId;

    beforeAll(async () => {
        const res = await request(app)
            .post('/api/auth/register-school')
            .send({ schoolName: MARKER, code: MARKER.toLowerCase(), adminName: 'CI Admin', email, password });
        userId = res.body.data.userId;
    });

    afterAll(async () => {
        await db.query('DELETE FROM audit_logs WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM sms_templates WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM users WHERE email LIKE ?', [`${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM schools WHERE code LIKE ?', [`${MARKER.toLowerCase()}%`]);
        await db.end();
    });

    test('login with correct credentials succeeds and sets a working session', async () => {
        const res = await request(app).post('/api/auth/login').send({ email, password });
        expect(res.status).toBe(200);
        expect(res.headers['set-cookie']).toBeDefined();
    });

    test('login with a wrong password is rejected', async () => {
        const res = await request(app).post('/api/auth/login').send({ email, password: 'WrongPass123' });
        expect(res.status).toBe(401);
    });

    test('login with a non-existent email is rejected with the same generic message (no user-enumeration signal)', async () => {
        const res = await request(app).post('/api/auth/login').send({ email: 'nobody-here@example.com', password: 'whatever123' });
        expect(res.status).toBe(401);
        expect(res.body.message).toMatch(/invalid email or password/i);
    });

    test('bumping token_version invalidates an already-issued token immediately', async () => {
        const loginRes = await request(app).post('/api/auth/login').send({ email, password });
        const cookie = loginRes.headers['set-cookie'][0];

        const meBefore = await request(app).get('/api/auth/me').set('Cookie', cookie);
        expect(meBefore.status).toBe(200);

        await db.query('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [userId]);

        const meAfter = await request(app).get('/api/auth/me').set('Cookie', cookie);
        expect(meAfter.status).toBe(401);
    });

    test('a weak password is rejected at registration', async () => {
        const res = await request(app)
            .post('/api/auth/register-school')
            .send({ schoolName: 'Weak Pw School', code: `${MARKER.toLowerCase()}-weak`, adminName: 'X', email: `${MARKER.toLowerCase()}-weak@example.com`, password: 'short' });
        expect(res.status).toBe(400);
    });

    test('an invalid school code (bad chars, reserved word) is rejected at registration', async () => {
        const res = await request(app)
            .post('/api/auth/register-school')
            .send({ schoolName: 'Bad Code School', code: 'admin', adminName: 'X', email: `${MARKER.toLowerCase()}-badcode@example.com`, password: 'TestPass123' });
        expect(res.status).toBe(400);
    });
});
