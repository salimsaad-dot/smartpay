const request = require('supertest');
const app = require('../server');
const db = require('../db');

// Reproduces the real race that caused a live ER_LOCK_DEADLOCK in
// production (via the actual Send Reminder flow on an invoice): two
// near-simultaneous payment-link generations for the SAME parent, each
// doing createPaymentLink's UPDATE-then-INSERT on payment_links scoped by
// parent_id. Fires truly concurrently (Promise.all, not sequential) so
// InnoDB has a real chance to deadlock one of them — withDeadlockRetry
// should make both requests succeed transparently either way.
describe('concurrent payment-link generation for the same parent (real DB, real HTTP)', () => {
    const MARKER = `CI-PLCONCUR-${Date.now()}`;
    let cookieA;
    let schoolIdA;
    let parentId;

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

        const parentRes = await request(app).post('/api/parents').set('Cookie', cookieA)
            .send({ fullName: 'Mrs Concurrent', phone: '0249999999' });
        parentId = parentRes.body.data.id;
    });

    afterAll(async () => {
        await db.query('DELETE FROM payment_links WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM parents WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM users WHERE email LIKE ?', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM sms_templates WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM fee_types WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM schools WHERE code LIKE ?', [`%${MARKER.toLowerCase()}%`]);
        await db.end();
    });

    test('10 truly concurrent requests for the same parent all succeed (no 500s)', async () => {
        const attempts = Array.from({ length: 10 }, () =>
            request(app).post(`/api/parents/${parentId}/payment-link`).set('Cookie', cookieA)
        );
        const results = await Promise.all(attempts);

        const statuses = results.map((r) => r.status);
        const failures = results.filter((r) => r.status !== 201);
        if (failures.length > 0) {
            // eslint-disable-next-line no-console
            console.log('Failing responses:', failures.map((r) => ({ status: r.status, body: r.body })));
        }
        expect(statuses.every((s) => s === 201)).toBe(true);

        // Exactly one payment link should be left active for this parent —
        // createPaymentLink revokes the previous one before inserting, so
        // 10 successful calls should still converge to a single active row.
        const [activeLinks] = await db.query(
            "SELECT id FROM payment_links WHERE parent_id = ? AND status = 'active'",
            [parentId]
        );
        expect(activeLinks.length).toBe(1);
    });
});
