const request = require('supertest');
const app = require('../server');
const db = require('../db');

describe('fee engine — fee structures and invoice generation (real DB, real HTTP)', () => {
    const MARKER = `CI-FEE-${Date.now()}`;
    let cookieA, cookieB;
    let schoolIdA;
    let yearIdA, termIdA, classIdA;
    let feeStructureId;
    let student1Id, student2Id;

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
        yearIdA = yearRes.body.data.id;

        const termRes = await request(app).post('/api/terms').set('Cookie', cookieA)
            .send({ academicYearId: yearIdA, name: 'Term 1', startDate: '2026-09-01', endDate: '2026-12-12' });
        termIdA = termRes.body.data.id;

        const classRes = await request(app).post('/api/classes').set('Cookie', cookieA).send({ name: 'Basic 1' });
        classIdA = classRes.body.data.id;

        const s1 = await request(app).post('/api/students').set('Cookie', cookieA)
            .send({ admissionNo: `${MARKER}-S1`, firstName: 'Kofi', lastName: 'Mensah', classId: classIdA, academicYearId: yearIdA });
        student1Id = s1.body.data.id;
        const s2 = await request(app).post('/api/students').set('Cookie', cookieA)
            .send({ admissionNo: `${MARKER}-S2`, firstName: 'Ama', lastName: 'Owusu', classId: classIdA, academicYearId: yearIdA });
        student2Id = s2.body.data.id;

        const fsRes = await request(app).post('/api/fee-structures').set('Cookie', cookieA).send({
            academicYearId: yearIdA, termId: termIdA, classId: classIdA, name: 'Term 1 Fees',
            items: [
                { name: 'Tuition', amount: 500 },
                { name: 'ICT', amount: 50 },
                { name: 'PTA', amount: 20 },
            ],
        });
        feeStructureId = fsRes.body.data.id;
    });

    afterAll(async () => {
        await db.query('DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE school_id = ?)', [schoolIdA]);
        await db.query('DELETE FROM invoices WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM fee_structure_items WHERE fee_structure_id IN (SELECT id FROM fee_structures WHERE school_id = ?)', [schoolIdA]);
        await db.query('DELETE FROM fee_structures WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM students WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM classes WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM terms WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM academic_years WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM users WHERE email LIKE ?', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM schools WHERE code LIKE ?', [`%${MARKER.toLowerCase()}%`]);
        await db.end();
    });

    test('fee structure total is correctly computed from its items', async () => {
        const res = await request(app).get(`/api/fee-structures/${feeStructureId}`).set('Cookie', cookieA);
        expect(res.status).toBe(200);
        expect(res.body.data.items).toHaveLength(3);
        expect(Number(res.body.data.totalAmount)).toBe(570);
    });

    test('a fee item with a non-positive amount is rejected at creation', async () => {
        const res = await request(app).post('/api/fee-structures').set('Cookie', cookieA).send({
            academicYearId: yearIdA, termId: termIdA, classId: classIdA, name: 'Bad Structure',
            items: [{ name: 'Tuition', amount: 0 }],
        });
        expect(res.status).toBe(400);
    });

    test("school B cannot create a fee structure against school A's term/class by guessing the IDs", async () => {
        const res = await request(app).post('/api/fee-structures').set('Cookie', cookieB).send({
            academicYearId: yearIdA, termId: termIdA, classId: classIdA, name: 'Cross Tenant',
            items: [{ name: 'Tuition', amount: 100 }],
        });
        expect(res.status).toBe(404);
    });

    test('generating invoices creates one invoice per active student, with correctly snapshotted items and totals', async () => {
        const res = await request(app).post('/api/invoices/generate').set('Cookie', cookieA).send({ feeStructureId });
        expect(res.status).toBe(200);
        expect(res.body.data.created).toBe(2);
        expect(res.body.data.skipped).toBe(0);

        const list = await request(app).get('/api/invoices').set('Cookie', cookieA);
        expect(list.body.data).toHaveLength(2);
        for (const inv of list.body.data) {
            expect(Number(inv.total)).toBe(570);
            expect(Number(inv.balance)).toBe(570);
            expect(Number(inv.paid_amount)).toBe(0);
            expect(inv.status).toBe('unpaid');
        }

        const detail = await request(app).get(`/api/invoices/${list.body.data[0].id}`).set('Cookie', cookieA);
        expect(detail.body.data.items).toHaveLength(3);
        expect(detail.body.data.items.map((i) => i.name).sort()).toEqual(['ICT', 'PTA', 'Tuition']);
    });

    test('re-running generation on the same fee structure skips students who already have an invoice (idempotent, not duplicate-billing)', async () => {
        const res = await request(app).post('/api/invoices/generate').set('Cookie', cookieA).send({ feeStructureId });
        expect(res.status).toBe(200);
        expect(res.body.data.created).toBe(0);
        expect(res.body.data.skipped).toBe(2);

        const list = await request(app).get('/api/invoices').set('Cookie', cookieA);
        expect(list.body.data).toHaveLength(2);
    });

    test('a student added to the class AFTER the first generation run is correctly picked up by a second run, without re-billing existing students', async () => {
        const s3 = await request(app).post('/api/students').set('Cookie', cookieA)
            .send({ admissionNo: `${MARKER}-S3`, firstName: 'Yaw', lastName: 'Boateng', classId: classIdA, academicYearId: yearIdA });

        const res = await request(app).post('/api/invoices/generate').set('Cookie', cookieA).send({ feeStructureId });
        expect(res.body.data.created).toBe(1);
        expect(res.body.data.skipped).toBe(2);

        const list = await request(app).get('/api/invoices').set('Cookie', cookieA);
        expect(list.body.data).toHaveLength(3);

        await db.query('DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE student_id = ?)', [s3.body.data.id]);
        await db.query('DELETE FROM invoices WHERE student_id = ?', [s3.body.data.id]);
        await db.query('DELETE FROM students WHERE id = ?', [s3.body.data.id]);
    });

    test('editing a fee structure\'s items after invoices already exist does not change the already-generated invoices (the snapshot rule)', async () => {
        await db.query('UPDATE fee_structure_items SET amount = 9999 WHERE fee_structure_id = ? AND name = ?', [feeStructureId, 'Tuition']);

        const list = await request(app).get('/api/invoices').set('Cookie', cookieA);
        for (const inv of list.body.data) {
            expect(Number(inv.total)).toBe(570);
        }
        const detail = await request(app).get(`/api/invoices/${list.body.data[0].id}`).set('Cookie', cookieA);
        const tuitionItem = detail.body.data.items.find((i) => i.name === 'Tuition');
        expect(Number(tuitionItem.amount)).toBe(500);

        await db.query('UPDATE fee_structure_items SET amount = 500 WHERE fee_structure_id = ? AND name = ?', [feeStructureId, 'Tuition']);
    });

    test("school B cannot view school A's invoices, by list or by ID", async () => {
        const list = await request(app).get('/api/invoices').set('Cookie', cookieB);
        expect(list.body.data).toHaveLength(0);

        const allInvoices = await request(app).get('/api/invoices').set('Cookie', cookieA);
        const detail = await request(app).get(`/api/invoices/${allInvoices.body.data[0].id}`).set('Cookie', cookieB);
        expect(detail.status).toBe(404);
    });

    test("school B cannot generate invoices against school A's fee structure", async () => {
        const res = await request(app).post('/api/invoices/generate').set('Cookie', cookieB).send({ feeStructureId });
        expect(res.status).toBe(404);
    });
});
