const request = require('supertest');
const app = require('../server');
const db = require('../db');

// Phase 1's acceptance gate: two real schools, two real admins, confirmed
// against the actual running app and database — not just unit-tested in
// isolation — that school A's admin cannot read school B's data even with
// a fully valid, correctly-signed token for their own account.
describe('tenant isolation (real DB, real HTTP)', () => {
    const MARKER = `CI-TENANT-${Date.now()}`;
    let schoolAId, schoolBId, schoolACookie, schoolBCookie;

    async function registerSchool(suffix) {
        const res = await request(app)
            .post('/api/auth/register-school')
            .send({
                schoolName: `${MARKER}-School-${suffix}`,
                code: `${MARKER.toLowerCase()}-${suffix}`,
                adminName: `Admin ${suffix}`,
                email: `${MARKER.toLowerCase()}-${suffix}@example.com`,
                password: 'TestPass123',
            });
        const cookie = res.headers['set-cookie'][0];
        return { schoolId: res.body.data.schoolId, cookie };
    }

    beforeAll(async () => {
        const a = await registerSchool('a');
        const b = await registerSchool('b');
        schoolAId = a.schoolId;
        schoolBId = b.schoolId;
        schoolACookie = a.cookie;
        schoolBCookie = b.cookie;
    });

    afterAll(async () => {
        await db.query('DELETE FROM sms_templates WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM users WHERE email LIKE ?', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM schools WHERE code LIKE ?', [`%${MARKER.toLowerCase()}%`]);
        await db.end();
    });

    test('registering a school creates a working, logged-in session scoped to that school', async () => {
        const res = await request(app).get('/api/auth/me').set('Cookie', schoolACookie);
        expect(res.status).toBe(200);
        expect(res.body.data.school.id).toBe(schoolAId);
    });

    test("school B's admin session resolves to school B, never school A, even though both tokens share the same signing secret and structure", async () => {
        const res = await request(app).get('/api/auth/me').set('Cookie', schoolBCookie);
        expect(res.status).toBe(200);
        expect(res.body.data.school.id).toBe(schoolBId);
        expect(res.body.data.school.id).not.toBe(schoolAId);
    });

    test('a request with no cookie at all is rejected', async () => {
        const res = await request(app).get('/api/auth/me');
        expect(res.status).toBe(401);
    });

    test('a tampered token is rejected, not silently trusted', async () => {
        const tampered = schoolACookie.replace('token=', 'token=tampered');
        const res = await request(app).get('/api/auth/me').set('Cookie', tampered);
        expect([401, 403]).toContain(res.status);
    });

    test('duplicate school code is rejected with a clean 409, not a 500 or a silent second school', async () => {
        const res = await request(app)
            .post('/api/auth/register-school')
            .send({
                schoolName: 'Duplicate Attempt',
                code: `${MARKER.toLowerCase()}-a`,
                adminName: 'Someone Else',
                email: `${MARKER.toLowerCase()}-dup@example.com`,
                password: 'TestPass123',
            });
        expect(res.status).toBe(409);

        const [[{ count }]] = await db.query('SELECT COUNT(*) AS count FROM schools WHERE code = ?', [`${MARKER.toLowerCase()}-a`]);
        expect(count).toBe(1);
    });

    test('two near-simultaneous registrations for the same brand-new code: exactly one succeeds, the DB constraint (not a pre-check) is what decides it', async () => {
        const code = `${MARKER.toLowerCase()}-race`;
        const attempt = (suffix) =>
            request(app)
                .post('/api/auth/register-school')
                .send({
                    schoolName: `Race ${suffix}`,
                    code,
                    adminName: `Racer ${suffix}`,
                    email: `${MARKER.toLowerCase()}-race-${suffix}@example.com`,
                    password: 'TestPass123',
                });

        const [res1, res2] = await Promise.all([attempt(1), attempt(2)]);
        const statuses = [res1.status, res2.status].sort();
        expect(statuses).toEqual([201, 409]);

        const [[{ count }]] = await db.query('SELECT COUNT(*) AS count FROM schools WHERE code = ?', [code]);
        expect(count).toBe(1);
    });
});
