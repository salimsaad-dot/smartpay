const request = require('supertest');
const app = require('../server');
const db = require('../db');

describe('school profile settings — momo_number (real DB, real HTTP)', () => {
    const MARKER = `CI-SETTINGS-${Date.now()}`;
    let cookieA, cookieB;
    let schoolIdA;

    async function registerSchool(suffix) {
        const res = await request(app)
            .post('/api/auth/register-school')
            .send({
                schoolName: `${MARKER}-${suffix}`,
                code: `${MARKER.toLowerCase()}-${suffix}`,
                adminName: `Admin ${suffix}`,
                email: `${MARKER.toLowerCase()}-${suffix}@example.com`,
                password: 'TestPass123',
            });
        return { cookie: res.headers['set-cookie'][0], schoolId: res.body.data.schoolId };
    }

    beforeAll(async () => {
        const a = await registerSchool('a');
        cookieA = a.cookie;
        schoolIdA = a.schoolId;
        cookieB = (await registerSchool('b')).cookie;
    });

    afterAll(async () => {
        await db.query('DELETE FROM audit_logs WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM fee_types WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM sms_templates WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM users WHERE email LIKE ?', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM schools WHERE code LIKE ?', [`%${MARKER.toLowerCase()}%`]);
        await db.end();
    });

    test('a brand new school has no momo_number set yet', async () => {
        const res = await request(app).get('/api/settings/profile').set('Cookie', cookieA);
        expect(res.status).toBe(200);
        expect(res.body.data.momo_number).toBeNull();
    });

    test('setting a momo_number and reading it back', async () => {
        const update = await request(app).patch('/api/settings/profile').set('Cookie', cookieA)
            .send({ momoNumber: '0241234567' });
        expect(update.status).toBe(200);
        expect(update.body.data.momoNumber).toBe('0241234567');

        const get = await request(app).get('/api/settings/profile').set('Cookie', cookieA);
        expect(get.body.data.momo_number).toBe('0241234567');
    });

    test('a PATCH with no momoNumber field leaves the existing value untouched (true partial update)', async () => {
        const res = await request(app).patch('/api/settings/profile').set('Cookie', cookieA).send({});
        expect(res.status).toBe(200);
        expect(res.body.data.momoNumber).toBe('0241234567');
    });

    test('an empty string clears the momo_number back to null', async () => {
        const res = await request(app).patch('/api/settings/profile').set('Cookie', cookieA)
            .send({ momoNumber: '' });
        expect(res.status).toBe(200);
        expect(res.body.data.momoNumber).toBeNull();
    });

    test("school B's own profile is unaffected by school A's changes", async () => {
        await request(app).patch('/api/settings/profile').set('Cookie', cookieA).send({ momoNumber: '0551112222' });
        const res = await request(app).get('/api/settings/profile').set('Cookie', cookieB);
        expect(res.body.data.momo_number).toBeNull();
    });
});
