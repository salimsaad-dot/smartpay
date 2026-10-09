const request = require('supertest');
const app = require('../server');
const db = require('../db');

describe('fee management Phase 3 — display-only frequency label (real DB, real HTTP)', () => {
    const MARKER = `CI-FREQ-${Date.now()}`;
    let cookieA, cookieB;
    let schoolIdA;
    let schoolFeesTypeId;

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

        const feeTypesA = await request(app).get('/api/fee-types').set('Cookie', cookieA);
        schoolFeesTypeId = feeTypesA.body.data.find((t) => t.name === 'School Fees').id;
    });

    afterAll(async () => {
        await db.query('DELETE FROM fee_types WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM audit_logs WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM users WHERE email LIKE ?', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM sms_templates WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM schools WHERE code LIKE ?', [`%${MARKER.toLowerCase()}%`]);
        await db.end();
    });

    test('every auto-seeded default fee type defaults to termly frequency', async () => {
        const res = await request(app).get('/api/fee-types').set('Cookie', cookieA);
        expect(res.body.data.every((t) => t.frequency === 'termly')).toBe(true);
    });

    test('a fee type can be created with a specific frequency', async () => {
        const res = await request(app).post('/api/fee-types').set('Cookie', cookieA)
            .send({ name: 'Graduation Fees Test', frequency: 'one_time' });
        expect(res.status).toBe(201);

        const list = await request(app).get('/api/fee-types').set('Cookie', cookieA);
        const created = list.body.data.find((t) => t.id === res.body.data.id);
        expect(created.frequency).toBe('one_time');
    });

    test('an invalid frequency value is rejected at creation', async () => {
        const res = await request(app).post('/api/fee-types').set('Cookie', cookieA)
            .send({ name: 'Bad Frequency Type', frequency: 'weekly' });
        expect(res.status).toBe(400);
    });

    test('frequency can be updated after creation', async () => {
        const res = await request(app).patch(`/api/fee-types/${schoolFeesTypeId}/frequency`).set('Cookie', cookieA)
            .send({ frequency: 'annual' });
        expect(res.status).toBe(200);

        const list = await request(app).get('/api/fee-types').set('Cookie', cookieA);
        expect(list.body.data.find((t) => t.id === schoolFeesTypeId).frequency).toBe('annual');
    });

    test('an invalid frequency value is rejected on update', async () => {
        const res = await request(app).patch(`/api/fee-types/${schoolFeesTypeId}/frequency`).set('Cookie', cookieA)
            .send({ frequency: 'monthly' });
        expect(res.status).toBe(400);
    });

    test("school B cannot update school A's fee type frequency", async () => {
        const res = await request(app).patch(`/api/fee-types/${schoolFeesTypeId}/frequency`).set('Cookie', cookieB)
            .send({ frequency: 'as_needed' });
        expect(res.status).toBe(404);
    });

    test('changing frequency never touches applicability or status (independent fields)', async () => {
        const before = (await request(app).get('/api/fee-types').set('Cookie', cookieA)).body.data.find((t) => t.id === schoolFeesTypeId);
        await request(app).patch(`/api/fee-types/${schoolFeesTypeId}/frequency`).set('Cookie', cookieA).send({ frequency: 'as_needed' });
        const after = (await request(app).get('/api/fee-types').set('Cookie', cookieA)).body.data.find((t) => t.id === schoolFeesTypeId);
        expect(after.applicability).toBe(before.applicability);
        expect(after.status).toBe(before.status);
        expect(after.frequency).toBe('as_needed');
    });
});
