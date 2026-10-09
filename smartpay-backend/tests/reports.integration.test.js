const request = require('supertest');
const app = require('../server');
const db = require('../db');

describe('reports — collections, outstanding, payments, invoices, SMS activity, statements (real DB, real HTTP)', () => {
    const MARKER = `CI-REPORTS-${Date.now()}`;
    let cookieA, cookieB;
    let schoolIdA;
    let classIdA, termIdA;
    let kofiStudentId, yawStudentId;
    let mensahParentId;
    let kofiInvoiceId, yawInvoiceId;

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
        termIdA = termRes.body.data.id;
        const classRes = await request(app).post('/api/classes').set('Cookie', cookieA).send({ name: 'Basic 1' });
        classIdA = classRes.body.data.id;

        const kofi = await request(app).post('/api/students').set('Cookie', cookieA)
            .send({ admissionNo: `${MARKER}-S1`, firstName: 'Kofi', lastName: 'Mensah', classId: classIdA, academicYearId: yearIdA });
        kofiStudentId = kofi.body.data.id;
        const yaw = await request(app).post('/api/students').set('Cookie', cookieA)
            .send({ admissionNo: `${MARKER}-S2`, firstName: 'Yaw', lastName: 'Mensah', classId: classIdA, academicYearId: yearIdA });
        yawStudentId = yaw.body.data.id;

        const mensah = await request(app).post('/api/parents').set('Cookie', cookieA).send({ fullName: 'Mrs Mensah', phone: '0241234567' });
        mensahParentId = mensah.body.data.id;
        await db.query('INSERT INTO parent_student (parent_id, student_id, is_primary) VALUES (?, ?, 1)', [mensahParentId, kofiStudentId]);
        await db.query('INSERT INTO parent_student (parent_id, student_id, is_primary) VALUES (?, ?, 1)', [mensahParentId, yawStudentId]);

        const feeTypesA = await request(app).get('/api/fee-types').set('Cookie', cookieA);
        const feeTypeIdA = feeTypesA.body.data.find((t) => t.name === 'School Fees').id;
        const fsRes = await request(app).post('/api/fee-structures').set('Cookie', cookieA).send({
            academicYearId: yearIdA, termId: termIdA, classId: classIdA, feeTypeId: feeTypeIdA,
            items: [{ name: 'Tuition', amount: 400 }, { name: 'ICT', amount: 100 }],
        });
        await request(app).post('/api/invoices/generate').set('Cookie', cookieA).send({ feeStructureId: fsRes.body.data.id });

        const invoices = await request(app).get('/api/invoices').set('Cookie', cookieA);
        kofiInvoiceId = invoices.body.data.find((i) => i.student_id === kofiStudentId).id;
        yawInvoiceId = invoices.body.data.find((i) => i.student_id === yawStudentId).id;

        // Kofi: fully paid (500/500). Yaw: partially paid (200/500, 300 outstanding).
        await request(app).post('/api/payments').set('Cookie', cookieA).send({ invoiceId: kofiInvoiceId, amount: 500, method: 'cash' });
        await request(app).post('/api/payments').set('Cookie', cookieA).send({ invoiceId: yawInvoiceId, amount: 200, method: 'mobile_money' });
    });

    afterAll(async () => {
        await db.query('DELETE FROM sms_reminders WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM audit_logs WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM sms_templates WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM payment_links WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM payments WHERE school_id = ?', [schoolIdA]);
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
        await db.query('DELETE FROM users WHERE email LIKE ?', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM schools WHERE code LIKE ?', [`%${MARKER.toLowerCase()}%`]);
        await db.end();
    });

    test('collection summary totals expected/collected/outstanding correctly', async () => {
        const res = await request(app).get('/api/reports/collection-summary').set('Cookie', cookieA);
        expect(res.status).toBe(200);
        expect(Number(res.body.data.expected)).toBe(1000);
        expect(Number(res.body.data.collected)).toBe(700);
        expect(Number(res.body.data.outstanding)).toBe(300);
        expect(res.body.data.collectionRate).toBeCloseTo(70, 1);
    });

    test('collection summary filters by class/term', async () => {
        const res = await request(app).get(`/api/reports/collection-summary?classId=${classIdA}&termId=${termIdA}`).set('Cookie', cookieA);
        expect(Number(res.body.data.expected)).toBe(1000);
    });

    test('outstanding fees report excludes the fully-paid invoice and includes status', async () => {
        const res = await request(app).get('/api/reports/outstanding-fees').set('Cookie', cookieA);
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].studentName).toBe('Yaw Mensah');
        expect(Number(res.body.data[0].balance)).toBe(300);
        expect(['unpaid', 'partially_paid']).toContain(res.body.data[0].status);
    });

    test('outstanding fees report exports as CSV with a header row', async () => {
        const res = await request(app).get('/api/reports/outstanding-fees?format=csv').set('Cookie', cookieA);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/csv/);
        expect(res.text.split('\r\n')[0]).toContain('Student');
        expect(res.text).toContain('Yaw Mensah');
    });

    test('payment history lists both payments and splits online/manual totals correctly', async () => {
        const res = await request(app).get('/api/reports/payment-history').set('Cookie', cookieA);
        expect(res.status).toBe(200);
        expect(res.body.data.payments).toHaveLength(2);
        expect(Number(res.body.data.summary.totalCollected)).toBe(700);
        expect(Number(res.body.data.summary.manualCollected)).toBe(700);
        expect(Number(res.body.data.summary.onlineCollected)).toBe(0);
    });

    test('payment history filters by parent (joined through parent_student, since payments has no parent_id column)', async () => {
        const res = await request(app).get(`/api/reports/payment-history?parentId=${mensahParentId}`).set('Cookie', cookieA);
        expect(res.status).toBe(200);
        expect(res.body.data.payments).toHaveLength(2);
    });

    test('payment history filters by method', async () => {
        const res = await request(app).get('/api/reports/payment-history?method=mobile_money').set('Cookie', cookieA);
        expect(res.body.data.payments).toHaveLength(1);
        expect(res.body.data.payments[0].studentName).toBe('Yaw Mensah');
    });

    test('invoice report lists both invoices with correct status', async () => {
        const res = await request(app).get('/api/reports/invoices').set('Cookie', cookieA);
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(2);
        const kofiRow = res.body.data.find((i) => i.studentName === 'Kofi Mensah');
        expect(kofiRow.status).toBe('paid');
    });

    test('sms activity report returns an empty but well-formed summary when nothing has been sent', async () => {
        const res = await request(app).get('/api/reports/sms-activity').set('Cookie', cookieA);
        expect(res.status).toBe(200);
        expect(res.body.data.summary).toEqual({ sent: 0, failed: 0, total: 0 });
    });

    test('student statement shows one student\'s invoices and payments with correct totals', async () => {
        const res = await request(app).get(`/api/reports/student-statement/${yawStudentId}`).set('Cookie', cookieA);
        expect(res.status).toBe(200);
        expect(res.body.data.student.name).toBe('Yaw Mensah');
        expect(res.body.data.invoices).toHaveLength(1);
        expect(res.body.data.payments).toHaveLength(1);
        expect(Number(res.body.data.totalOutstanding)).toBe(300);
    });

    test('parent statement consolidates both of a parent\'s children', async () => {
        const res = await request(app).get(`/api/reports/parent-statement/${mensahParentId}`).set('Cookie', cookieA);
        expect(res.status).toBe(200);
        expect(res.body.data.invoices).toHaveLength(2);
        expect(res.body.data.payments).toHaveLength(2);
        expect(Number(res.body.data.totalBilled)).toBe(1000);
        expect(Number(res.body.data.totalOutstanding)).toBe(300);
    });

    test("school B cannot access school A's reports or statements", async () => {
        const summary = await request(app).get('/api/reports/collection-summary').set('Cookie', cookieB);
        expect(Number(summary.body.data.expected)).toBe(0);

        const statement = await request(app).get(`/api/reports/student-statement/${yawStudentId}`).set('Cookie', cookieB);
        expect(statement.status).toBe(404);

        const parentStatement = await request(app).get(`/api/reports/parent-statement/${mensahParentId}`).set('Cookie', cookieB);
        expect(parentStatement.status).toBe(404);
    });
});
