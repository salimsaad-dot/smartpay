const request = require('supertest');
const app = require('../server');
const db = require('../db');

describe('payments — manual payment recording, voiding, and balance recalculation (real DB, real HTTP)', () => {
    const MARKER = `CI-PAY-${Date.now()}`;
    let cookieA, cookieB;
    let schoolIdA;
    let invoice1Id, invoice2Id;

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
        const classIdA = classRes.body.data.id;

        const s1 = await request(app).post('/api/students').set('Cookie', cookieA)
            .send({ admissionNo: `${MARKER}-S1`, firstName: 'Kofi', lastName: 'Mensah', classId: classIdA, academicYearId: yearIdA });
        const s2 = await request(app).post('/api/students').set('Cookie', cookieA)
            .send({ admissionNo: `${MARKER}-S2`, firstName: 'Ama', lastName: 'Owusu', classId: classIdA, academicYearId: yearIdA });

        const fsRes = await request(app).post('/api/fee-structures').set('Cookie', cookieA).send({
            academicYearId: yearIdA, termId: termIdA, classId: classIdA, name: 'Term 1 Fees',
            items: [{ name: 'Tuition', amount: 400 }, { name: 'ICT', amount: 100 }],
        });
        const feeStructureId = fsRes.body.data.id;

        await request(app).post('/api/invoices/generate').set('Cookie', cookieA).send({ feeStructureId });
        const list = await request(app).get('/api/invoices').set('Cookie', cookieA);
        const inv1 = list.body.data.find((i) => i.student_id === s1.body.data.id);
        const inv2 = list.body.data.find((i) => i.student_id === s2.body.data.id);
        invoice1Id = inv1.id;
        invoice2Id = inv2.id;
    });

    afterAll(async () => {
        await db.query('DELETE FROM payments WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE school_id = ?)', [schoolIdA]);
        await db.query('DELETE FROM invoices WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM fee_structure_items WHERE fee_structure_id IN (SELECT id FROM fee_structures WHERE school_id = ?)', [schoolIdA]);
        await db.query('DELETE FROM fee_structures WHERE school_id = ?', [schoolIdA]);
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

    test('a partial payment correctly recalculates paid_amount/balance/status to partially_paid', async () => {
        const res = await request(app).post('/api/payments').set('Cookie', cookieA)
            .send({ invoiceId: invoice1Id, amount: 200, method: 'cash' });
        expect(res.status).toBe(201);
        expect(res.body.data.invoice.status).toBe('partially_paid');
        expect(res.body.data.invoice.paidAmount).toBe(200);
        expect(res.body.data.invoice.balance).toBe(300);

        const detail = await request(app).get(`/api/invoices/${invoice1Id}`).set('Cookie', cookieA);
        expect(Number(detail.body.data.paid_amount)).toBe(200);
        expect(Number(detail.body.data.balance)).toBe(300);
        expect(detail.body.data.status).toBe('partially_paid');
    });

    test('a second payment that brings the balance to zero transitions status to paid', async () => {
        const res = await request(app).post('/api/payments').set('Cookie', cookieA)
            .send({ invoiceId: invoice1Id, amount: 300, method: 'mobile_money', reference: 'MM-TEST-1' });
        expect(res.status).toBe(201);
        expect(res.body.data.invoice.status).toBe('paid');
        expect(res.body.data.invoice.balance).toBe(0);
    });

    test('a payment exceeding the current outstanding balance is rejected (no overpayment)', async () => {
        const res = await request(app).post('/api/payments').set('Cookie', cookieA)
            .send({ invoiceId: invoice2Id, amount: 1000, method: 'cash' });
        expect(res.status).toBe(400);

        const detail = await request(app).get(`/api/invoices/${invoice2Id}`).set('Cookie', cookieA);
        expect(Number(detail.body.data.paid_amount)).toBe(0);
        expect(detail.body.data.status).toBe('unpaid');
    });

    test('a non-positive amount is rejected', async () => {
        const res = await request(app).post('/api/payments').set('Cookie', cookieA)
            .send({ invoiceId: invoice2Id, amount: 0, method: 'cash' });
        expect(res.status).toBe(400);
    });

    test('an invalid method is rejected', async () => {
        const res = await request(app).post('/api/payments').set('Cookie', cookieA)
            .send({ invoiceId: invoice2Id, amount: 50, method: 'crypto' });
        expect(res.status).toBe(400);
    });

    test('voiding a payment reverses its effect on the invoice balance, without deleting the payment row', async () => {
        const pay = await request(app).post('/api/payments').set('Cookie', cookieA)
            .send({ invoiceId: invoice2Id, amount: 150, method: 'bank_transfer' });
        expect(pay.status).toBe(201);
        const paymentId = pay.body.data.paymentId;

        let detail = await request(app).get(`/api/invoices/${invoice2Id}`).set('Cookie', cookieA);
        expect(Number(detail.body.data.paid_amount)).toBe(150);
        expect(detail.body.data.status).toBe('partially_paid');

        const voidRes = await request(app).post(`/api/payments/${paymentId}/void`).set('Cookie', cookieA)
            .send({ reason: 'Entered against the wrong invoice' });
        expect(voidRes.status).toBe(200);
        expect(voidRes.body.data.invoice.status).toBe('unpaid');
        expect(voidRes.body.data.invoice.paidAmount).toBe(0);
        expect(voidRes.body.data.invoice.balance).toBe(500);

        detail = await request(app).get(`/api/invoices/${invoice2Id}`).set('Cookie', cookieA);
        expect(Number(detail.body.data.paid_amount)).toBe(0);
        expect(Number(detail.body.data.balance)).toBe(500);
        expect(detail.body.data.status).toBe('unpaid');

        const [[row]] = await db.query('SELECT status FROM payments WHERE id = ?', [paymentId]);
        expect(row.status).toBe('void');
    });

    test('voiding without a reason is rejected', async () => {
        const pay = await request(app).post('/api/payments').set('Cookie', cookieA)
            .send({ invoiceId: invoice2Id, amount: 50, method: 'cash' });
        const res = await request(app).post(`/api/payments/${pay.body.data.paymentId}/void`).set('Cookie', cookieA).send({});
        expect(res.status).toBe(400);
    });

    test('voiding an already-voided payment is rejected', async () => {
        const pay = await request(app).post('/api/payments').set('Cookie', cookieA)
            .send({ invoiceId: invoice2Id, amount: 25, method: 'cash' });
        const paymentId = pay.body.data.paymentId;
        const first = await request(app).post(`/api/payments/${paymentId}/void`).set('Cookie', cookieA).send({ reason: 'test' });
        expect(first.status).toBe(200);
        const second = await request(app).post(`/api/payments/${paymentId}/void`).set('Cookie', cookieA).send({ reason: 'test again' });
        expect(second.status).toBe(400);
    });

    test('a voided payment is excluded from paid_amount while a still-active payment on the same invoice still counts', async () => {
        const freshList = await request(app).get('/api/invoices').set('Cookie', cookieA);
        const freshInvoice = freshList.body.data.find((i) => i.id === invoice2Id);
        const startingBalance = Number(freshInvoice.balance);

        const keep = await request(app).post('/api/payments').set('Cookie', cookieA)
            .send({ invoiceId: invoice2Id, amount: 10, method: 'cash' });
        const voidMe = await request(app).post('/api/payments').set('Cookie', cookieA)
            .send({ invoiceId: invoice2Id, amount: 15, method: 'cash' });
        await request(app).post(`/api/payments/${voidMe.body.data.paymentId}/void`).set('Cookie', cookieA).send({ reason: 'test' });

        const detail = await request(app).get(`/api/invoices/${invoice2Id}`).set('Cookie', cookieA);
        expect(Number(detail.body.data.balance)).toBe(startingBalance - 10);
    });

    test("school B cannot record a payment against school A's invoice by guessing the ID", async () => {
        const res = await request(app).post('/api/payments').set('Cookie', cookieB)
            .send({ invoiceId: invoice2Id, amount: 10, method: 'cash' });
        expect(res.status).toBe(404);
    });

    test("school B cannot void school A's payment by guessing the ID", async () => {
        const pay = await request(app).post('/api/payments').set('Cookie', cookieA)
            .send({ invoiceId: invoice2Id, amount: 5, method: 'cash' });
        const res = await request(app).post(`/api/payments/${pay.body.data.paymentId}/void`).set('Cookie', cookieB)
            .send({ reason: 'cross tenant attempt' });
        expect(res.status).toBe(404);
    });

    test("school B cannot see school A's payments in its own payment list", async () => {
        const res = await request(app).get('/api/payments').set('Cookie', cookieB);
        expect(res.body.data).toHaveLength(0);
    });

    test('a payment against a voided invoice is rejected', async () => {
        await db.query("UPDATE invoices SET status = 'void' WHERE id = ?", [invoice1Id]);
        const res = await request(app).post('/api/payments').set('Cookie', cookieA)
            .send({ invoiceId: invoice1Id, amount: 10, method: 'cash' });
        expect(res.status).toBe(400);
        await db.query("UPDATE invoices SET status = 'paid' WHERE id = ?", [invoice1Id]);
    });
});
