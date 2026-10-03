const request = require('supertest');
const app = require('../server');
const db = require('../db');

describe('arrears — outstanding balances, filters, and parent aggregation (real DB, real HTTP)', () => {
    const MARKER = `CI-ARR-${Date.now()}`;
    let cookieA, cookieB;
    let schoolIdA;
    let classIdA, termIdA;
    let mensahParentId, owusuParentId;
    let kofiInvoiceId, yawInvoiceId, amaInvoiceId;
    let kofiStudentId;

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

        // Kofi and Yaw are siblings under Mrs Mensah; Ama is Mr Owusu's.
        const kofi = await request(app).post('/api/students').set('Cookie', cookieA)
            .send({ admissionNo: `${MARKER}-S1`, firstName: 'Kofi', lastName: 'Mensah', classId: classIdA, academicYearId: yearIdA });
        kofiStudentId = kofi.body.data.id;
        const yaw = await request(app).post('/api/students').set('Cookie', cookieA)
            .send({ admissionNo: `${MARKER}-S2`, firstName: 'Yaw', lastName: 'Mensah', classId: classIdA, academicYearId: yearIdA });
        const ama = await request(app).post('/api/students').set('Cookie', cookieA)
            .send({ admissionNo: `${MARKER}-S3`, firstName: 'Ama', lastName: 'Owusu', classId: classIdA, academicYearId: yearIdA });

        const mensah = await request(app).post('/api/parents').set('Cookie', cookieA)
            .send({ fullName: 'Mrs Mensah', phone: '0241234567' });
        mensahParentId = mensah.body.data.id;
        const owusu = await request(app).post('/api/parents').set('Cookie', cookieA)
            .send({ fullName: 'Mr Owusu', phone: '0241111111' });
        owusuParentId = owusu.body.data.id;

        await db.query('INSERT INTO parent_student (parent_id, student_id, is_primary) VALUES (?, ?, 1)', [mensahParentId, kofiStudentId]);
        await db.query('INSERT INTO parent_student (parent_id, student_id, is_primary) VALUES (?, ?, 1)', [mensahParentId, yaw.body.data.id]);
        await db.query('INSERT INTO parent_student (parent_id, student_id, is_primary) VALUES (?, ?, 1)', [owusuParentId, ama.body.data.id]);

        const fsRes = await request(app).post('/api/fee-structures').set('Cookie', cookieA).send({
            academicYearId: yearIdA, termId: termIdA, classId: classIdA, name: 'Term 1 Fees',
            items: [{ name: 'Tuition', amount: 400 }, { name: 'ICT', amount: 100 }],
        });
        await request(app).post('/api/invoices/generate').set('Cookie', cookieA).send({ feeStructureId: fsRes.body.data.id });

        const list = await request(app).get('/api/invoices').set('Cookie', cookieA);
        kofiInvoiceId = list.body.data.find((i) => i.student_id === kofiStudentId).id;
        yawInvoiceId = list.body.data.find((i) => i.student_id === yaw.body.data.id).id;
        amaInvoiceId = list.body.data.find((i) => i.student_id === ama.body.data.id).id;

        // Kofi: still fully unpaid (500 outstanding).
        // Yaw: partially paid (300 outstanding of 500), with a real payment so last_payment_date is populated.
        await request(app).post('/api/payments').set('Cookie', cookieA).send({ invoiceId: yawInvoiceId, amount: 200, method: 'cash' });
        // Ama: fully paid — must NOT appear in arrears at all.
        await request(app).post('/api/payments').set('Cookie', cookieA).send({ invoiceId: amaInvoiceId, amount: 500, method: 'cash' });
    });

    afterAll(async () => {
        await db.query('DELETE FROM payments WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM payment_links WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM parent_student WHERE student_id IN (SELECT id FROM students WHERE school_id = ?)', [schoolIdA]);
        await db.query('DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE school_id = ?)', [schoolIdA]);
        await db.query('DELETE FROM invoices WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM fee_structure_items WHERE fee_structure_id IN (SELECT id FROM fee_structures WHERE school_id = ?)', [schoolIdA]);
        await db.query('DELETE FROM fee_structures WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM parents WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM students WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM classes WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM terms WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM academic_years WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM users WHERE email LIKE ?', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM schools WHERE code LIKE ?', [`%${MARKER.toLowerCase()}%`]);
        await db.end();
    });

    test('a fully paid invoice never appears in arrears, even though it was generated alongside the unpaid ones', async () => {
        const res = await request(app).get('/api/arrears').set('Cookie', cookieA);
        expect(res.status).toBe(200);
        const invoiceIds = res.body.data.invoices.map((i) => i.id);
        expect(invoiceIds).toContain(kofiInvoiceId);
        expect(invoiceIds).toContain(yawInvoiceId);
        expect(invoiceIds).not.toContain(amaInvoiceId);
    });

    test('summary totals correctly reflect only the outstanding invoices', async () => {
        const res = await request(app).get('/api/arrears').set('Cookie', cookieA);
        expect(res.body.data.summary.invoiceCount).toBe(2);
        expect(res.body.data.summary.studentCount).toBe(2);
        expect(Number(res.body.data.summary.totalOutstanding)).toBe(500 + 300);
    });

    test('each row reports the correct parent/guardian (primary parent) and balance', async () => {
        const res = await request(app).get('/api/arrears').set('Cookie', cookieA);
        const kofiRow = res.body.data.invoices.find((i) => i.id === kofiInvoiceId);
        expect(kofiRow.parent_name).toBe('Mrs Mensah');
        expect(Number(kofiRow.balance)).toBe(500);
        expect(kofiRow.last_payment_date).toBeNull();

        const yawRow = res.body.data.invoices.find((i) => i.id === yawInvoiceId);
        expect(Number(yawRow.balance)).toBe(300);
        expect(yawRow.last_payment_date).not.toBeNull();
    });

    test('filtering by parent returns only that parent\'s children — both siblings for a shared parent', async () => {
        const res = await request(app).get(`/api/arrears?parentId=${mensahParentId}`).set('Cookie', cookieA);
        const invoiceIds = res.body.data.invoices.map((i) => i.id);
        expect(invoiceIds.sort()).toEqual([kofiInvoiceId, yawInvoiceId].sort());
    });

    test('filtering by balance range excludes rows outside it', async () => {
        const res = await request(app).get('/api/arrears?minBalance=400').set('Cookie', cookieA);
        const invoiceIds = res.body.data.invoices.map((i) => i.id);
        expect(invoiceIds).toContain(kofiInvoiceId);
        expect(invoiceIds).not.toContain(yawInvoiceId);
    });

    test('filtering by class and term works', async () => {
        const res = await request(app).get(`/api/arrears?classId=${classIdA}&termId=${termIdA}`).set('Cookie', cookieA);
        expect(res.body.data.invoices.length).toBeGreaterThanOrEqual(2);
    });

    test('a voided invoice with a positive balance never appears in arrears', async () => {
        await db.query("UPDATE invoices SET status = 'void' WHERE id = ?", [kofiInvoiceId]);
        const res = await request(app).get('/api/arrears').set('Cookie', cookieA);
        const invoiceIds = res.body.data.invoices.map((i) => i.id);
        expect(invoiceIds).not.toContain(kofiInvoiceId);
        await db.query("UPDATE invoices SET status = 'unpaid' WHERE id = ?", [kofiInvoiceId]);
    });

    test("school B sees none of school A's arrears", async () => {
        const res = await request(app).get('/api/arrears').set('Cookie', cookieB);
        expect(res.body.data.invoices).toHaveLength(0);
        expect(res.body.data.summary.totalOutstanding).toBe(0);
    });

    test('an admin can generate a payment link for a parent directly from the arrears workflow (reusing the existing endpoint)', async () => {
        const res = await request(app).post(`/api/parents/${mensahParentId}/payment-link`).set('Cookie', cookieA);
        expect(res.status).toBe(201);
        expect(res.body.data.url).toContain('/pay/');
    });
});
