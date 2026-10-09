const request = require('supertest');
const app = require('../server');
const db = require('../db');

// Covers the new aggregate fields the redesigned Classes/Parents pages rely
// on (student_count, children_count, outstanding_balance, child_class_ids)
// and the new archive/activate status endpoints — real DB, real HTTP, and
// a cross-tenant check since both new status endpoints are admin-only
// mutations scoped by school_id.
describe('classes/parents — redesign aggregates and status endpoints (real DB, real HTTP)', () => {
    const MARKER = `CI-CP-${Date.now()}`;
    let cookieA, cookieB;
    let schoolIdA;
    let classIdA;
    let mensahParentId, owusuParentId;

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

        const yearRes = await request(app).post('/api/academic-years').set('Cookie', cookieA)
            .send({ name: '2026/2027', startDate: '2026-09-01', endDate: '2027-07-31' });
        const yearIdA = yearRes.body.data.id;
        const termRes = await request(app).post('/api/terms').set('Cookie', cookieA)
            .send({ academicYearId: yearIdA, name: 'Term 1', startDate: '2026-09-01', endDate: '2026-12-12' });
        const termIdA = termRes.body.data.id;

        const classRes = await request(app).post('/api/classes').set('Cookie', cookieA).send({ name: 'Basic 1' });
        classIdA = classRes.body.data.id;

        // One active, one inactive student in the same class — student_count
        // must only ever count the active one.
        const kofi = await request(app).post('/api/students').set('Cookie', cookieA)
            .send({ admissionNo: `${MARKER}-S1`, firstName: 'Kofi', lastName: 'Mensah', classId: classIdA, academicYearId: yearIdA });
        const ama = await request(app).post('/api/students').set('Cookie', cookieA)
            .send({ admissionNo: `${MARKER}-S2`, firstName: 'Ama', lastName: 'Inactive', classId: classIdA, academicYearId: yearIdA });
        await db.query('UPDATE students SET status = ? WHERE id = ?', ['inactive', ama.body.data.id]);

        const mensah = await request(app).post('/api/parents').set('Cookie', cookieA).send({ fullName: 'Mrs Mensah', phone: '0241234567' });
        mensahParentId = mensah.body.data.id;
        const owusu = await request(app).post('/api/parents').set('Cookie', cookieA).send({ fullName: 'Mr Owusu', phone: '0241111111' });
        owusuParentId = owusu.body.data.id;

        await db.query('INSERT INTO parent_student (parent_id, student_id, is_primary) VALUES (?, ?, 1)', [mensahParentId, kofi.body.data.id]);

        const feeTypesA = await request(app).get('/api/fee-types').set('Cookie', cookieA);
        const feeTypeIdA = feeTypesA.body.data.find((t) => t.name === 'School Fees').id;
        const fsRes = await request(app).post('/api/fee-structures').set('Cookie', cookieA).send({
            academicYearId: yearIdA, termId: termIdA, classId: classIdA, feeTypeId: feeTypeIdA,
            items: [{ name: 'Tuition', amount: 500 }],
        });
        await request(app).post('/api/invoices/generate').set('Cookie', cookieA).send({ feeStructureId: fsRes.body.data.id });
        // Kofi's invoice is left fully unpaid (500 outstanding) — that 500
        // should land on his parent, Mrs Mensah, via the aggregate query.
    });

    afterAll(async () => {
        await db.query('DELETE FROM payment_links WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM parent_student WHERE student_id IN (SELECT id FROM students WHERE school_id = ?)', [schoolIdA]);
        await db.query('DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE school_id = ?)', [schoolIdA]);
        await db.query('DELETE FROM invoices WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM fee_structure_items WHERE fee_structure_id IN (SELECT id FROM fee_structures WHERE school_id = ?)', [schoolIdA]);
        await db.query('DELETE FROM fee_structures WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM fee_types WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM parents WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM students WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM classes WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM terms WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM academic_years WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM audit_logs WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM users WHERE email LIKE ?', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM sms_templates WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM schools WHERE code LIKE ?', [`%${MARKER.toLowerCase()}%`]);
        await db.end();
    });

    test('GET /classes counts only active students and defaults to active-status classes', async () => {
        const res = await request(app).get('/api/classes').set('Cookie', cookieA);
        const basic1 = res.body.data.find((c) => c.id === classIdA);
        expect(basic1.student_count).toBe(1);
        expect(basic1.status).toBe('active');
    });

    test('archiving a class removes it from the default list but keeps it under ?status=all', async () => {
        await request(app).patch(`/api/classes/${classIdA}/status`).set('Cookie', cookieA).send({ status: 'archived' });

        const defaultList = await request(app).get('/api/classes').set('Cookie', cookieA);
        expect(defaultList.body.data.find((c) => c.id === classIdA)).toBeUndefined();

        const allList = await request(app).get('/api/classes?status=all').set('Cookie', cookieA);
        const archived = allList.body.data.find((c) => c.id === classIdA);
        expect(archived.status).toBe('archived');

        // Reactivate so later assertions (and re-runs) see it as active again.
        await request(app).patch(`/api/classes/${classIdA}/status`).set('Cookie', cookieA).send({ status: 'active' });
    });

    test('a school cannot archive another school\'s class', async () => {
        const res = await request(app).patch(`/api/classes/${classIdA}/status`).set('Cookie', cookieB).send({ status: 'archived' });
        expect(res.status).toBe(404);
    });

    test('GET /parents aggregates children_count, outstanding_balance and child_class_ids correctly', async () => {
        const res = await request(app).get('/api/parents').set('Cookie', cookieA);
        const mensah = res.body.data.find((p) => p.id === mensahParentId);
        const owusu = res.body.data.find((p) => p.id === owusuParentId);

        expect(mensah.children_count).toBe(1);
        expect(Number(mensah.outstanding_balance)).toBe(500);
        expect(mensah.child_class_ids.split(',')).toContain(String(classIdA));

        expect(owusu.children_count).toBe(0);
        expect(Number(owusu.outstanding_balance)).toBe(0);
    });

    test('PATCH /parents/:id/status toggles active/inactive and a cross-tenant request 404s', async () => {
        const toInactive = await request(app).patch(`/api/parents/${mensahParentId}/status`).set('Cookie', cookieA).send({ status: 'inactive' });
        expect(toInactive.status).toBe(200);

        const list = await request(app).get('/api/parents').set('Cookie', cookieA);
        expect(list.body.data.find((p) => p.id === mensahParentId).status).toBe('inactive');

        const crossTenant = await request(app).patch(`/api/parents/${mensahParentId}/status`).set('Cookie', cookieB).send({ status: 'active' });
        expect(crossTenant.status).toBe(404);

        // Restore for idempotency.
        await request(app).patch(`/api/parents/${mensahParentId}/status`).set('Cookie', cookieA).send({ status: 'active' });
    });
});
