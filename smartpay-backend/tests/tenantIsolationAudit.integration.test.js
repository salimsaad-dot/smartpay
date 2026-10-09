const request = require('supertest');
const app = require('../server');
const db = require('../db');

// A deliberate, adversarial product-tester pass, not a developer's own
// "does my feature work" test: two real schools, a full real resource
// set in School A, then School B's authenticated session tries to
// read/write every single one of School A's resources by ID. Every
// attempt must be refused (404/403), never a 200 carrying real data —
// that is the entire multi-tenancy guarantee this app exists to keep.
describe('Cross-tenant isolation audit — every resource type, real DB, real HTTP', () => {
    const MARKER = `CI-TENANTAUDIT-${Date.now()}`;
    let cookieA, cookieB;
    let schoolIdA;
    const ids = {}; // every School A resource id this test creates

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

        // Build a full, real resource graph in School A.
        const year = await request(app).post('/api/academic-years').set('Cookie', cookieA)
            .send({ name: '2026/2027', startDate: '2026-09-01', endDate: '2027-07-31' });
        ids.yearId = year.body.data.id;
        await request(app).patch(`/api/academic-years/${ids.yearId}/set-current`).set('Cookie', cookieA);

        const term = await request(app).post('/api/terms').set('Cookie', cookieA)
            .send({ academicYearId: ids.yearId, name: 'Term 1', startDate: '2026-09-01', endDate: '2026-12-12' });
        ids.termId = term.body.data.id;
        await request(app).patch(`/api/terms/${ids.termId}/set-current`).set('Cookie', cookieA);

        const cls = await request(app).post('/api/classes').set('Cookie', cookieA).send({ name: 'Basic 1' });
        ids.classId = cls.body.data.id;

        const student = await request(app).post('/api/students').set('Cookie', cookieA)
            .send({ admissionNo: `${MARKER}-S1`, firstName: 'Kofi', lastName: 'Secret', classId: ids.classId, academicYearId: ids.yearId });
        ids.studentId = student.body.data.id;

        const parent = await request(app).post('/api/parents').set('Cookie', cookieA)
            .send({ fullName: 'Mrs Secret', phone: '0241230000' });
        ids.parentId = parent.body.data.id;
        await request(app).post(`/api/students/${ids.studentId}/parents`).set('Cookie', cookieA)
            .send({ parentId: ids.parentId, relationship: 'Mother' });

        const feeTypesA = await request(app).get('/api/fee-types').set('Cookie', cookieA);
        ids.feeTypeId = feeTypesA.body.data.find((t) => t.name === 'School Fees').id;
        const fs = await request(app).post('/api/fee-structures').set('Cookie', cookieA)
            .send({ academicYearId: ids.yearId, termId: ids.termId, classId: ids.classId, feeTypeId: ids.feeTypeId, items: [{ name: 'Tuition', amount: 500 }] });
        ids.feeStructureId = fs.body.data.id;

        await request(app).post('/api/invoices/generate').set('Cookie', cookieA).send({ feeStructureId: ids.feeStructureId });
        const invoices = await request(app).get('/api/invoices').set('Cookie', cookieA);
        ids.invoiceId = invoices.body.data.find((i) => i.student_id === ids.studentId).id;

        const payment = await request(app).post('/api/payments').set('Cookie', cookieA)
            .send({ invoiceId: ids.invoiceId, amount: 100, method: 'cash' });
        ids.paymentId = payment.body.data.paymentId;

        const template = await request(app).post('/api/sms-templates').set('Cookie', cookieA)
            .send({ name: 'Audit Template', body: 'Hi {{student_name}}' });
        ids.templateId = template.body.data.id;

        const link = await request(app).post(`/api/parents/${ids.parentId}/payment-link`).set('Cookie', cookieA);
        ids.paymentLinkToken = link.body.data?.url?.split('/pay/')[1];
    });

    afterAll(async () => {
        await db.query('DELETE FROM payment_attempts WHERE payment_id IN (SELECT id FROM payments WHERE school_id = ?)', [schoolIdA]);
        await db.query('DELETE FROM payments WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM payment_links WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM sms_reminders WHERE school_id = ?', [schoolIdA]);
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

    test('setup created every resource this audit needs', () => {
        expect(Object.values(ids).every((v) => v !== undefined && v !== null)).toBe(true);
    });

    // --- Reads: School B must never see School A's data ---
    test.each([
        ['GET /academic-years does not include School A\'s year', async () => {
            const res = await request(app).get('/api/academic-years').set('Cookie', cookieB);
            expect(res.body.data.find((y) => y.id === ids.yearId)).toBeUndefined();
        }],
        ['GET /terms does not include School A\'s term', async () => {
            const res = await request(app).get('/api/terms').set('Cookie', cookieB);
            expect(res.body.data.find((t) => t.id === ids.termId)).toBeUndefined();
        }],
        ['GET /classes does not include School A\'s class', async () => {
            const res = await request(app).get('/api/classes').set('Cookie', cookieB);
            expect(res.body.data.find((c) => c.id === ids.classId)).toBeUndefined();
        }],
        ['GET /students does not include School A\'s student', async () => {
            const res = await request(app).get('/api/students').set('Cookie', cookieB);
            expect(res.body.data.find((s) => s.id === ids.studentId)).toBeUndefined();
        }],
        ['GET /students/:id 404s for School A\'s student', async () => {
            const res = await request(app).get(`/api/students/${ids.studentId}`).set('Cookie', cookieB);
            expect(res.status).toBe(404);
        }],
        ['GET /parents does not include School A\'s parent', async () => {
            const res = await request(app).get('/api/parents').set('Cookie', cookieB);
            expect(res.body.data.find((p) => p.id === ids.parentId)).toBeUndefined();
        }],
        ['GET /parents/:id 404s for School A\'s parent', async () => {
            const res = await request(app).get(`/api/parents/${ids.parentId}`).set('Cookie', cookieB);
            expect(res.status).toBe(404);
        }],
        ['GET /fee-structures does not include School A\'s structure', async () => {
            const res = await request(app).get('/api/fee-structures').set('Cookie', cookieB);
            expect(res.body.data.find((f) => f.id === ids.feeStructureId)).toBeUndefined();
        }],
        ['GET /fee-structures/:id 404s for School A\'s structure', async () => {
            const res = await request(app).get(`/api/fee-structures/${ids.feeStructureId}`).set('Cookie', cookieB);
            expect(res.status).toBe(404);
        }],
        ['GET /fee-types does not include School A\'s fee type', async () => {
            const res = await request(app).get('/api/fee-types').set('Cookie', cookieB);
            expect(res.body.data.find((t) => t.id === ids.feeTypeId)).toBeUndefined();
        }],
        ['PATCH /fee-types/:id/status 404s for School A\'s fee type', async () => {
            const res = await request(app).patch(`/api/fee-types/${ids.feeTypeId}/status`).set('Cookie', cookieB).send({ status: 'inactive' });
            expect(res.status).toBe(404);
        }],
        ['GET /invoices does not include School A\'s invoice', async () => {
            const res = await request(app).get('/api/invoices').set('Cookie', cookieB);
            expect(res.body.data.find((i) => i.id === ids.invoiceId)).toBeUndefined();
        }],
        ['GET /invoices/:id 404s for School A\'s invoice', async () => {
            const res = await request(app).get(`/api/invoices/${ids.invoiceId}`).set('Cookie', cookieB);
            expect(res.status).toBe(404);
        }],
        ['GET /payments does not include School A\'s payment', async () => {
            const res = await request(app).get('/api/payments').set('Cookie', cookieB);
            expect(res.body.data.find((p) => p.id === ids.paymentId)).toBeUndefined();
        }],
        ['GET /sms-templates does not include School A\'s template', async () => {
            const res = await request(app).get('/api/sms-templates').set('Cookie', cookieB);
            expect(res.body.data.find((t) => t.id === ids.templateId)).toBeUndefined();
        }],
        ['GET /arrears does not include School A\'s invoice', async () => {
            const res = await request(app).get('/api/arrears').set('Cookie', cookieB);
            expect(res.body.data.invoices.find((i) => i.id === ids.invoiceId)).toBeUndefined();
        }],
        ['GET /reports/student-statement/:id 404s for School A\'s student', async () => {
            const res = await request(app).get(`/api/reports/student-statement/${ids.studentId}`).set('Cookie', cookieB);
            expect(res.status).toBe(404);
        }],
        ['GET /reports/parent-statement/:id 404s for School A\'s parent', async () => {
            const res = await request(app).get(`/api/reports/parent-statement/${ids.parentId}`).set('Cookie', cookieB);
            expect(res.status).toBe(404);
        }],
        ['GET /audit-logs does not include School A\'s actions', async () => {
            const res = await request(app).get('/api/audit-logs').set('Cookie', cookieB);
            expect(res.body.data.length).toBe(0);
        }],
    ])('%s', async (_name, fn) => fn());

    // --- Writes/mutations: School B must never be able to act on School A's data ---
    test.each([
        ['PATCH /academic-years/:id/set-current 404s on School A\'s year', async () => {
            const res = await request(app).patch(`/api/academic-years/${ids.yearId}/set-current`).set('Cookie', cookieB);
            expect(res.status).toBe(404);
        }],
        ['PATCH /terms/:id/set-current 404s on School A\'s term', async () => {
            const res = await request(app).patch(`/api/terms/${ids.termId}/set-current`).set('Cookie', cookieB);
            expect(res.status).toBe(404);
        }],
        ['PATCH /classes/:id/status 404s on School A\'s class', async () => {
            const res = await request(app).patch(`/api/classes/${ids.classId}/status`).set('Cookie', cookieB).send({ status: 'archived' });
            expect(res.status).toBe(404);
        }],
        ['PATCH /parents/:id 404s on School A\'s parent', async () => {
            const res = await request(app).patch(`/api/parents/${ids.parentId}`).set('Cookie', cookieB).send({ fullName: 'Hijacked', phone: '0240000000' });
            expect(res.status).toBe(404);
        }],
        ['PATCH /parents/:id/status 404s on School A\'s parent', async () => {
            const res = await request(app).patch(`/api/parents/${ids.parentId}/status`).set('Cookie', cookieB).send({ status: 'inactive' });
            expect(res.status).toBe(404);
        }],
        ['POST /parents/:id/payment-link 404s on School A\'s parent (can\'t mint a link for someone else\'s parent)', async () => {
            const res = await request(app).post(`/api/parents/${ids.parentId}/payment-link`).set('Cookie', cookieB);
            expect(res.status).toBe(404);
        }],
        ['POST /students/:id/parents 404s linking into School A\'s student', async () => {
            const res = await request(app).post(`/api/students/${ids.studentId}/parents`).set('Cookie', cookieB).send({ parentId: ids.parentId });
            expect(res.status).toBe(404);
        }],
        ['PATCH /sms-templates/:id 404s on School A\'s template', async () => {
            const res = await request(app).patch(`/api/sms-templates/${ids.templateId}`).set('Cookie', cookieB).send({ name: 'Hijacked', body: 'x' });
            expect(res.status).toBe(404);
        }],
        ['POST /payments/:id/void 404s on School A\'s payment', async () => {
            const res = await request(app).post(`/api/payments/${ids.paymentId}/void`).set('Cookie', cookieB).send({ reason: 'hijack attempt' });
            expect(res.status).toBe(404);
        }],
        ['POST /invoices/generate 404s using School A\'s fee structure id', async () => {
            const res = await request(app).post('/api/invoices/generate').set('Cookie', cookieB).send({ feeStructureId: ids.feeStructureId });
            expect(res.status).toBe(404);
        }],
        ['POST /payments 404s posting against School A\'s invoice id', async () => {
            const res = await request(app).post('/api/payments').set('Cookie', cookieB).send({ invoiceId: ids.invoiceId, amount: 1, method: 'cash' });
            expect(res.status).toBe(404);
        }],
        ['POST /fee-structures 404s using School A\'s class/term/year ids', async () => {
            const feeTypesB = await request(app).get('/api/fee-types').set('Cookie', cookieB);
            const feeTypeIdB = feeTypesB.body.data.find((t) => t.name === 'School Fees').id;
            const res = await request(app).post('/api/fee-structures').set('Cookie', cookieB)
                .send({ academicYearId: ids.yearId, termId: ids.termId, classId: ids.classId, feeTypeId: feeTypeIdB, items: [{ name: 'x', amount: 1 }] });
            expect(res.status).toBe(404);
        }],
        ['POST /students 404s using School A\'s class/year ids (can\'t enroll into another school\'s class)', async () => {
            const res = await request(app).post('/api/students').set('Cookie', cookieB)
                .send({ admissionNo: 'HIJACK-1', firstName: 'X', lastName: 'Y', classId: ids.classId, academicYearId: ids.yearId });
            expect(res.status).toBe(404);
        }],
        ['POST /terms 404s using School A\'s academic year id', async () => {
            const res = await request(app).post('/api/terms').set('Cookie', cookieB)
                .send({ academicYearId: ids.yearId, name: 'Hijack Term', startDate: '2026-09-01', endDate: '2026-12-01' });
            expect(res.status).toBe(404);
        }],
        ['POST /reminders/preview 404s for School A\'s parent/invoice', async () => {
            const res = await request(app).post('/api/reminders/preview').set('Cookie', cookieB).send({ parentId: ids.parentId, invoiceId: ids.invoiceId });
            expect(res.status).toBe(404);
        }],
        ['POST /reminders/send 404s for School A\'s parent/invoice', async () => {
            const res = await request(app).post('/api/reminders/send').set('Cookie', cookieB).send({ parentId: ids.parentId, invoiceId: ids.invoiceId });
            expect(res.status).toBe(404);
        }],
    ])('%s', async (_name, fn) => fn());

    // --- The public, token-scoped checkout surface: a guessed/adjacent
    // token or id must never expose School A's real checkout data. ---
    test('the public checkout link only ever shows School A\'s own data, to anyone holding the token', async () => {
        if (!ids.paymentLinkToken) return; // link generation may have failed upstream; not this test's concern
        const res = await request(app).get(`/api/public/checkout/${ids.paymentLinkToken}`);
        expect(res.status).toBe(200);
        expect(res.body.data.parentName).toBe('Mrs Secret');
    });

    test('a nonexistent/garbage public token is rejected cleanly, not with a 500 or data leak', async () => {
        const res = await request(app).get('/api/public/checkout/not-a-real-token-at-all');
        expect(res.status).toBe(404);
    });
});
