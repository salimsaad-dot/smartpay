const request = require('supertest');
const crypto = require('crypto');
const app = require('../server');
const db = require('../db');
const { finalizePaymentEvent } = require('../utils/paymentFinalizer');

// Payments landing on the same invoice at the same moment (2026-10-16,
// from the council audit): a double-clicked or retried "Record payment",
// and a manual payment racing an online confirmation. Every write path
// locks the invoice first, and manual payments carry an idempotency key.
describe('payment concurrency (real DB, real HTTP)', () => {
    const MARKER = `CI-CONC-${Date.now()}`;
    let cookie;
    let schoolId;
    let studentId;
    let invoiceIds = [];

    beforeAll(async () => {
        const reg = await request(app).post('/api/auth/register-school').send({
            schoolName: MARKER, code: MARKER.toLowerCase(), adminName: 'CI Admin',
            email: `${MARKER.toLowerCase()}@example.com`, password: 'TestPass123',
        });
        cookie = reg.headers['set-cookie'][0];
        schoolId = reg.body.data.schoolId;

        const year = await request(app).post('/api/academic-years').set('Cookie', cookie)
            .send({ name: '2026/2027', startDate: '2026-09-01', endDate: '2027-07-31' });
        const term = await request(app).post('/api/terms').set('Cookie', cookie)
            .send({ academicYearId: year.body.data.id, name: 'Term 1', startDate: '2026-09-01', endDate: '2026-12-12' });
        const cls = await request(app).post('/api/classes').set('Cookie', cookie).send({ name: 'Basic 2' });
        const student = await request(app).post('/api/students').set('Cookie', cookie)
            .send({ admissionNo: `${MARKER}-S1`, firstName: 'Yaw', lastName: 'Asante', classId: cls.body.data.id, academicYearId: year.body.data.id });
        studentId = student.body.data.id;

        // Several fee types -> several separate invoices, one per test.
        const feeTypes = (await request(app).get('/api/fee-types').set('Cookie', cookie)).body.data;
        for (const feeType of feeTypes.slice(0, 4)) {
            const fs = await request(app).post('/api/fee-structures').set('Cookie', cookie).send({
                academicYearId: year.body.data.id, termId: term.body.data.id, classId: cls.body.data.id, feeTypeId: feeType.id,
                items: [{ name: feeType.name, amount: 500 }],
            });
            await request(app).post('/api/invoices/generate').set('Cookie', cookie).send({ feeStructureId: fs.body.data.id });
        }
        invoiceIds = (await request(app).get('/api/invoices').set('Cookie', cookie)).body.data.map((i) => i.id);
    });

    afterAll(async () => {
        await db.query('DELETE FROM payment_attempts WHERE payment_id IN (SELECT id FROM payments WHERE school_id = ?)', [schoolId]);
        await db.query('DELETE FROM payments WHERE school_id = ?', [schoolId]);
        await db.query('DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE school_id = ?)', [schoolId]);
        await db.query('DELETE FROM invoices WHERE school_id = ?', [schoolId]);
        await db.query('DELETE FROM fee_structure_items WHERE fee_structure_id IN (SELECT id FROM fee_structures WHERE school_id = ?)', [schoolId]);
        await db.query('DELETE FROM fee_structures WHERE school_id = ?', [schoolId]);
        for (const t of ['fee_types', 'students', 'classes', 'terms', 'academic_years', 'audit_logs', 'sms_templates', 'users']) {
            await db.query(`DELETE FROM ${t} WHERE school_id = ?`, [schoolId]);
        }
        await db.query('DELETE FROM schools WHERE id = ?', [schoolId]);
        await db.end();
    });

    const record = (invoiceId, amount, extra = {}) =>
        request(app).post('/api/payments').set('Cookie', cookie).send({ invoiceId, amount, method: 'cash', ...extra });
    const invoiceRow = async (id) => (await db.query('SELECT paid_amount, balance FROM invoices WHERE id = ?', [id]))[0][0];
    const successSum = async (id) => Number((await db.query(
        "SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE invoice_id = ? AND status = 'success'", [id]))[0][0].s);

    test('five simultaneous full-balance payments: exactly one is recorded', async () => {
        const invoiceId = invoiceIds[0];
        const results = await Promise.all(Array.from({ length: 5 }, () => record(invoiceId, 500)));
        expect(results.filter((r) => r.status === 201)).toHaveLength(1);
        expect(results.filter((r) => r.status === 400)).toHaveLength(4);
        expect(await successSum(invoiceId)).toBe(500);
        expect(Number((await invoiceRow(invoiceId)).balance)).toBe(0);
    });

    test('the same submission sent three times (double-click / retry) is recorded once', async () => {
        const invoiceId = invoiceIds[1];
        const key = crypto.randomUUID();
        const results = await Promise.all([1, 2, 3].map(() => record(invoiceId, 200, { idempotencyKey: key })));
        expect(results.every((r) => r.status === 201 || r.status === 200)).toBe(true);
        expect(new Set(results.map((r) => r.body.data.paymentId)).size).toBe(1);
        expect(await successSum(invoiceId)).toBe(200);
        expect(Number((await invoiceRow(invoiceId)).balance)).toBe(300);

        // A different submission (new key) for the same amount is a real second payment.
        expect((await record(invoiceId, 200, { idempotencyKey: crypto.randomUUID() })).status).toBe(201);
        expect(await successSum(invoiceId)).toBe(400);
    });

    test('a manual payment racing an online confirmation leaves the stored balance correct', async () => {
        const invoiceId = invoiceIds[2];
        for (let round = 0; round < 4; round += 1) {
            const reference = `sp_${schoolId}_${crypto.randomBytes(12).toString('hex')}`;
            const [ins] = await db.query(
                `INSERT INTO payments (school_id, invoice_id, student_id, amount, source, status, internal_reference, provider)
                 VALUES (?, ?, ?, 25, 'online', 'initiated', ?, 'paystack')`,
                [schoolId, invoiceId, studentId, reference]
            );
            await Promise.all([
                record(invoiceId, 25),
                finalizePaymentEvent({ id: ins.insertId, invoice_id: invoiceId, amount: 25, status: 'initiated' },
                    { status: 'success', amountGhs: 25, currency: 'GHS', channel: 'card', paidAt: new Date(), reference }, 'test'),
            ]);
        }
        const row = await invoiceRow(invoiceId);
        expect(Number(row.paid_amount)).toBe(await successSum(invoiceId));
        expect(Number(row.paid_amount)).toBe(200);
    });

    test('voiding one payment while another is recorded leaves the stored balance correct', async () => {
        const invoiceId = invoiceIds[3];
        const first = await record(invoiceId, 100);
        await Promise.all([
            request(app).post(`/api/payments/${first.body.data.paymentId}/void`).set('Cookie', cookie).send({ reason: 'entered twice' }),
            record(invoiceId, 50),
        ]);
        const row = await invoiceRow(invoiceId);
        expect(Number(row.paid_amount)).toBe(await successSum(invoiceId));
        expect(Number(row.paid_amount)).toBe(50);
    });
});
