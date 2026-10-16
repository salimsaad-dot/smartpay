const request = require('supertest');
const crypto = require('crypto');
const app = require('../server');
const db = require('../db');
const paystackGateway = require('../utils/paystackGateway');

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const hasRealPaystackKey = Boolean(PAYSTACK_SECRET) && !PAYSTACK_SECRET.includes('PLACEHOLDER');

function signWebhook(payload) {
    const rawBody = JSON.stringify(payload);
    const signature = crypto.createHmac('sha512', PAYSTACK_SECRET).update(rawBody).digest('hex');
    return { rawBody, signature };
}

function chargeSuccessPayload({ reference, amountGhs, channel = 'mobile_money' }) {
    return {
        event: 'charge.success',
        data: {
            reference,
            amount: Math.round(amountGhs * 100),
            status: 'success',
            channel,
            paid_at: new Date().toISOString(),
        },
    };
}

describe('online payments — secure payment links, public checkout, and Paystack webhook (real DB, real HTTP)', () => {
    const MARKER = `CI-ONLINE-${Date.now()}`;
    let cookieA, cookieB;
    let schoolIdA, schoolIdB;
    let parentIdA, parentIdB;
    let invoiceId, student1Id;

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
        const b = await registerSchool('b');
        cookieB = b.cookie;
        schoolIdB = b.schoolId;

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
        student1Id = s1.body.data.id;

        const parentRes = await request(app).post('/api/parents').set('Cookie', cookieA)
            .send({ fullName: 'Mrs Mensah', phone: '0241234567', email: 'mensah@example.com' });
        parentIdA = parentRes.body.data.id;

        const parentBRes = await request(app).post('/api/parents').set('Cookie', cookieB)
            .send({ fullName: 'Mr Owusu', phone: '0241111111' });
        parentIdB = parentBRes.body.data.id;

        await db.query('INSERT INTO parent_student (parent_id, student_id, is_primary) VALUES (?, ?, 1)', [parentIdA, student1Id]);

        const feeTypesA = await request(app).get('/api/fee-types').set('Cookie', cookieA);
        const feeTypeIdA = feeTypesA.body.data.find((t) => t.name === 'School Fees').id;
        const fsRes = await request(app).post('/api/fee-structures').set('Cookie', cookieA).send({
            academicYearId: yearIdA, termId: termIdA, classId: classIdA, feeTypeId: feeTypeIdA,
            items: [{ name: 'Tuition', amount: 400 }, { name: 'ICT', amount: 100 }],
        });
        await request(app).post('/api/invoices/generate').set('Cookie', cookieA).send({ feeStructureId: fsRes.body.data.id });
        const list = await request(app).get('/api/invoices').set('Cookie', cookieA);
        invoiceId = list.body.data[0].id;
    });

    afterAll(async () => {
        await db.query('DELETE FROM payment_attempts WHERE payment_id IN (SELECT id FROM payments WHERE school_id = ?)', [schoolIdA]);
        await db.query('DELETE FROM payments WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM payment_links WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM parent_student WHERE student_id = ?', [student1Id]);
        await db.query('DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE school_id = ?)', [schoolIdA]);
        await db.query('DELETE FROM invoices WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM fee_structure_items WHERE fee_structure_id IN (SELECT id FROM fee_structures WHERE school_id = ?)', [schoolIdA]);
        await db.query('DELETE FROM fee_structures WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM fee_types WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        // Scoped by school_id, not a global full_name LIKE match — this
        // database is shared with other test files that reuse the same
        // "Mensah"/"Owusu" fixture names, and a global delete here can hit
        // another test's still-referenced parent row and fail the whole
        // afterAll on an FK constraint (hit live: this exact line broke
        // when run alongside another file using the same names).
        await db.query('DELETE FROM parents WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM parents WHERE school_id = ?', [schoolIdB]);
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

    let rawToken;

    test('admin can generate a secure payment link for a parent', async () => {
        const res = await request(app).post(`/api/parents/${parentIdA}/payment-link`).set('Cookie', cookieA);
        expect(res.status).toBe(201);
        expect(res.body.data.url).toContain('/pay/');
        rawToken = res.body.data.url.split('/pay/')[1];
        expect(rawToken.length).toBeGreaterThan(20);
    });

    test("school B cannot generate a payment link for school A's parent by guessing the ID", async () => {
        const res = await request(app).post(`/api/parents/${parentIdA}/payment-link`).set('Cookie', cookieB);
        expect(res.status).toBe(404);
    });

    test('the raw token is never stored — only its hash exists in the database', async () => {
        const [[row]] = await db.query('SELECT token_hash FROM payment_links WHERE parent_id = ?', [parentIdA]);
        expect(row.token_hash).not.toBe(rawToken);
        expect(row.token_hash).toHaveLength(64);
    });

    test('public checkout resolves the token to the correct parent and child, with no auth required', async () => {
        const res = await request(app).get(`/api/public/checkout/${rawToken}`);
        expect(res.status).toBe(200);
        // Privacy (2026-10-16): no parent name or email, child shortened.
        expect(res.body.data.parentName).toBeUndefined();
        expect(res.body.data.parentEmail).toBeUndefined();
        expect(res.body.data.hasEmailOnFile).toBe(true);
        expect(res.body.data.children).toHaveLength(1);
        expect(res.body.data.children[0].name).toBe('Kofi M.');
        expect(res.body.data.children[0].invoices).toHaveLength(1);
        expect(Number(res.body.data.children[0].invoices[0].balance)).toBe(500);
        // fee-management Phase 5: the public checkout page must make it
        // clear what each invoice is for, not just an invoice number.
        expect(res.body.data.children[0].invoices[0].feeTypeName).toBe('School Fees');
    });

    test('an invalid/garbage token returns 404, not a crash', async () => {
        const res = await request(app).get('/api/public/checkout/not-a-real-token');
        expect(res.status).toBe(404);
    });

    test('a new payment link expires after 10 days, not 30 (limits a forwarded SMS)', async () => {
        const [[row]] = await db.query("SELECT TIMESTAMPDIFF(HOUR, created_at, expires_at) AS h FROM payment_links WHERE parent_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1", [parentIdA]);
        expect(Number(row.h)).toBeGreaterThanOrEqual(239);
        expect(Number(row.h)).toBeLessThanOrEqual(241);
    });

    test('a revoked link is rejected with 410', async () => {
        await db.query("UPDATE payment_links SET status = 'revoked' WHERE parent_id = ?", [parentIdA]);
        const res = await request(app).get(`/api/public/checkout/${rawToken}`);
        expect(res.status).toBe(410);
        await db.query("UPDATE payment_links SET status = 'active' WHERE parent_id = ?", [parentIdA]);
    });

    test('an expired link is rejected with 410', async () => {
        await db.query('UPDATE payment_links SET expires_at = ? WHERE parent_id = ?', [new Date(Date.now() - 1000), parentIdA]);
        const res = await request(app).get(`/api/public/checkout/${rawToken}`);
        expect(res.status).toBe(410);
        await db.query('UPDATE payment_links SET expires_at = ? WHERE parent_id = ?', [new Date(Date.now() + 86400000), parentIdA]);
    });

    test('regenerating a payment link revokes the old one', async () => {
        const res = await request(app).post(`/api/parents/${parentIdA}/payment-link`).set('Cookie', cookieA);
        const newToken = res.body.data.url.split('/pay/')[1];

        const oldLinkCheck = await request(app).get(`/api/public/checkout/${rawToken}`);
        expect(oldLinkCheck.status).toBe(410);

        const newLinkCheck = await request(app).get(`/api/public/checkout/${newToken}`);
        expect(newLinkCheck.status).toBe(200);

        rawToken = newToken;
    });

    test('initializing payment with a non-positive amount is rejected', async () => {
        const res = await request(app).post('/api/public/payments/initialize').send({ token: rawToken, invoiceId, amount: 0 });
        expect(res.status).toBe(400);
    });

    test('initializing payment above the outstanding balance is rejected', async () => {
        const res = await request(app).post('/api/public/payments/initialize').send({ token: rawToken, invoiceId, amount: 999999 });
        expect(res.status).toBe(400);
    });

    test("initializing payment against an invoice that isn't this parent's is rejected", async () => {
        const otherSchoolInvoices = await request(app).get('/api/invoices').set('Cookie', cookieB);
        const fakeInvoiceId = invoiceId + 9999;
        const res = await request(app).post('/api/public/payments/initialize').send({ token: rawToken, invoiceId: fakeInvoiceId, amount: 50 });
        expect(res.status).toBe(404);
    });

    (hasRealPaystackKey ? test : test.skip)(
        'initializing a valid payment returns a real Paystack authorization URL (requires live PAYSTACK_SECRET_KEY)',
        async () => {
            const res = await request(app).post('/api/public/payments/initialize').send({ token: rawToken, invoiceId, amount: 200 });
            expect(res.status).toBe(200);
            expect(res.body.data.authorizationUrl).toContain('paystack.com');
            expect(res.body.data.internalReference).toMatch(/^sp_/);
        }
    );

    test('initializing payment gracefully fails (payment marked failed, not left dangling) when the gateway rejects the request', async () => {
        const res = await request(app).post('/api/public/payments/initialize').send({ token: rawToken, invoiceId, amount: 50 });
        if (hasRealPaystackKey) {
            expect(res.status).toBe(200);
        } else {
            expect(res.status).toBe(502);
        }

        const [[payment]] = await db.query(
            'SELECT status FROM payments WHERE invoice_id = ? AND amount = 50 ORDER BY id DESC LIMIT 1',
            [invoiceId]
        );
        expect(['failed', 'initiated']).toContain(payment.status);
    });

    describe('webhook processing', () => {
        let reference;

        beforeAll(async () => {
            reference = `sp_${schoolIdA}_${crypto.randomBytes(12).toString('hex')}`;
            await db.query(
                `INSERT INTO payments (school_id, invoice_id, student_id, amount, source, status, internal_reference, provider)
                 VALUES (?, ?, ?, 150, 'online', 'initiated', ?, 'paystack')`,
                [schoolIdA, invoiceId, student1Id, reference]
            );
        });

        test('a webhook with an invalid signature is rejected and does not change payment state', async () => {
            const payload = chargeSuccessPayload({ reference, amountGhs: 150 });
            const res = await request(app).post('/api/payments/webhook').set('x-paystack-signature', 'not-a-real-signature').send(payload);
            expect(res.status).toBe(401);

            const [[payment]] = await db.query('SELECT status FROM payments WHERE internal_reference = ?', [reference]);
            expect(payment.status).toBe('initiated');
        });

        test('a correctly signed charge.success webhook marks the payment successful and recalculates the invoice', async () => {
            const invoiceBefore = await request(app).get(`/api/invoices/${invoiceId}`).set('Cookie', cookieA);
            const balanceBefore = Number(invoiceBefore.body.data.balance);

            const payload = chargeSuccessPayload({ reference, amountGhs: 150, channel: 'mobile_money' });
            const { rawBody, signature } = signWebhook(payload);
            const res = await request(app).post('/api/payments/webhook').set('Content-Type', 'application/json').set('x-paystack-signature', signature).send(rawBody);
            expect(res.status).toBe(200);

            const [[payment]] = await db.query('SELECT status, method, paid_at FROM payments WHERE internal_reference = ?', [reference]);
            expect(payment.status).toBe('success');
            expect(payment.method).toBe('mobile_money');
            expect(payment.paid_at).not.toBeNull();

            const invoiceAfter = await request(app).get(`/api/invoices/${invoiceId}`).set('Cookie', cookieA);
            expect(Number(invoiceAfter.body.data.balance)).toBe(balanceBefore - 150);

            const [[attempt]] = await db.query('SELECT status FROM payment_attempts WHERE provider_reference = ?', [reference]);
            expect(attempt.status).toBe('success');
        });

        test('a redelivered webhook for the same reference is idempotent — does not credit the invoice twice', async () => {
            const invoiceBefore = await request(app).get(`/api/invoices/${invoiceId}`).set('Cookie', cookieA);
            const balanceBefore = Number(invoiceBefore.body.data.balance);

            const payload = chargeSuccessPayload({ reference, amountGhs: 150, channel: 'mobile_money' });
            const { rawBody, signature } = signWebhook(payload);
            const res = await request(app).post('/api/payments/webhook').set('Content-Type', 'application/json').set('x-paystack-signature', signature).send(rawBody);
            expect(res.status).toBe(200);

            const invoiceAfter = await request(app).get(`/api/invoices/${invoiceId}`).set('Cookie', cookieA);
            expect(Number(invoiceAfter.body.data.balance)).toBe(balanceBefore);
        });

        test('a webhook for an unknown reference is acknowledged without error', async () => {
            const payload = chargeSuccessPayload({ reference: 'sp_unknown_reference_xyz', amountGhs: 50 });
            const { rawBody, signature } = signWebhook(payload);
            const res = await request(app).post('/api/payments/webhook').set('Content-Type', 'application/json').set('x-paystack-signature', signature).send(rawBody);
            expect(res.status).toBe(200);
        });

        test('a webhook reporting an amount that does not match the payment record is rejected and marks the payment failed, not success', async () => {
            const mismatchRef = `sp_${schoolIdA}_${crypto.randomBytes(12).toString('hex')}`;
            await db.query(
                `INSERT INTO payments (school_id, invoice_id, student_id, amount, source, status, internal_reference, provider)
                 VALUES (?, ?, ?, 75, 'online', 'initiated', ?, 'paystack')`,
                [schoolIdA, invoiceId, student1Id, mismatchRef]
            );
            const payload = chargeSuccessPayload({ reference: mismatchRef, amountGhs: 9999 });
            const { rawBody, signature } = signWebhook(payload);
            const res = await request(app).post('/api/payments/webhook').set('Content-Type', 'application/json').set('x-paystack-signature', signature).send(rawBody);
            expect(res.status).toBe(200);

            const [[payment]] = await db.query('SELECT status FROM payments WHERE internal_reference = ?', [mismatchRef]);
            expect(payment.status).toBe('failed');
        });

        test('a charge.failed webhook marks the payment failed without touching the invoice', async () => {
            const failRef = `sp_${schoolIdA}_${crypto.randomBytes(12).toString('hex')}`;
            await db.query(
                `INSERT INTO payments (school_id, invoice_id, student_id, amount, source, status, internal_reference, provider)
                 VALUES (?, ?, ?, 60, 'online', 'initiated', ?, 'paystack')`,
                [schoolIdA, invoiceId, student1Id, failRef]
            );
            const payload = { event: 'charge.failed', data: { reference: failRef, amount: 6000, status: 'failed', channel: 'card' } };
            const { rawBody, signature } = signWebhook(payload);
            const res = await request(app).post('/api/payments/webhook').set('Content-Type', 'application/json').set('x-paystack-signature', signature).send(rawBody);
            expect(res.status).toBe(200);

            const [[payment]] = await db.query('SELECT status FROM payments WHERE internal_reference = ?', [failRef]);
            expect(payment.status).toBe('failed');
        });
    });

    test('a status check that independently discovers success via a live Paystack check finalizes the payment itself — not just reports it (closes the "webhook never arrives" gap)', async () => {
        const reference = `sp_${schoolIdA}_${crypto.randomBytes(12).toString('hex')}`;
        await db.query(
            `INSERT INTO payments (school_id, invoice_id, student_id, amount, source, status, internal_reference, provider)
             VALUES (?, ?, ?, 80, 'online', 'initiated', ?, 'paystack')`,
            [schoolIdA, invoiceId, student1Id, reference]
        );
        const invoiceBefore = await request(app).get(`/api/invoices/${invoiceId}`).set('Cookie', cookieA);
        const balanceBefore = Number(invoiceBefore.body.data.balance);

        const spy = jest.spyOn(paystackGateway, 'verifyTransaction').mockResolvedValueOnce({
            status: 'success', amountGhs: 80, channel: 'card', paidAt: new Date(), providerReference: reference,
        });

        const res = await request(app).get(`/api/public/payments/${reference}/status`);
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('success');

        const [[payment]] = await db.query('SELECT status FROM payments WHERE internal_reference = ?', [reference]);
        expect(payment.status).toBe('success');

        const invoiceAfter = await request(app).get(`/api/invoices/${invoiceId}`).set('Cookie', cookieA);
        expect(Number(invoiceAfter.body.data.balance)).toBe(balanceBefore - 80);

        spy.mockRestore();
    });

    test('a redelivered webhook after a status-poll already finalized the same payment is a no-op, not a double credit', async () => {
        const reference = `sp_${schoolIdA}_${crypto.randomBytes(12).toString('hex')}`;
        await db.query(
            `INSERT INTO payments (school_id, invoice_id, student_id, amount, source, status, internal_reference, provider)
             VALUES (?, ?, ?, 40, 'online', 'initiated', ?, 'paystack')`,
            [schoolIdA, invoiceId, student1Id, reference]
        );

        const spy = jest.spyOn(paystackGateway, 'verifyTransaction').mockResolvedValueOnce({
            status: 'success', amountGhs: 40, channel: 'mobile_money', paidAt: new Date(), providerReference: reference,
        });
        await request(app).get(`/api/public/payments/${reference}/status`);
        spy.mockRestore();

        const invoiceAfterPoll = await request(app).get(`/api/invoices/${invoiceId}`).set('Cookie', cookieA);
        const balanceAfterPoll = Number(invoiceAfterPoll.body.data.balance);

        const payload = chargeSuccessPayload({ reference, amountGhs: 40, channel: 'mobile_money' });
        const { rawBody, signature } = signWebhook(payload);
        await request(app).post('/api/payments/webhook').set('Content-Type', 'application/json').set('x-paystack-signature', signature).send(rawBody);

        const invoiceAfterWebhook = await request(app).get(`/api/invoices/${invoiceId}`).set('Cookie', cookieA);
        expect(Number(invoiceAfterWebhook.body.data.balance)).toBe(balanceAfterPoll);
    });

    test('a webhook event type outside the recognized charge allowlist is ignored, not processed as a charge update', async () => {
        const reference = `sp_${schoolIdA}_${crypto.randomBytes(12).toString('hex')}`;
        await db.query(
            `INSERT INTO payments (school_id, invoice_id, student_id, amount, source, status, internal_reference, provider)
             VALUES (?, ?, ?, 30, 'online', 'initiated', ?, 'paystack')`,
            [schoolIdA, invoiceId, student1Id, reference]
        );

        const payload = { event: 'charge.dispute.create', data: { reference, amount: 3000, status: 'success', channel: 'card' } };
        const { rawBody, signature } = signWebhook(payload);
        const res = await request(app).post('/api/payments/webhook').set('Content-Type', 'application/json').set('x-paystack-signature', signature).send(rawBody);
        expect(res.status).toBe(200);

        const [[payment]] = await db.query('SELECT status FROM payments WHERE internal_reference = ?', [reference]);
        expect(payment.status).toBe('initiated');
    });

    test('the public payment-status endpoint reports the current status for a given reference', async () => {
        const reference = `sp_${schoolIdA}_${crypto.randomBytes(12).toString('hex')}`;
        await db.query(
            `INSERT INTO payments (school_id, invoice_id, student_id, amount, source, status, internal_reference, provider)
             VALUES (?, ?, ?, 10, 'online', 'success', ?, 'paystack')`,
            [schoolIdA, invoiceId, student1Id, reference]
        );
        const res = await request(app).get(`/api/public/payments/${reference}/status`);
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('success');
        expect(Number(res.body.data.amount)).toBe(10);
    });

    test('the public payment-status endpoint 404s for an unknown reference', async () => {
        const res = await request(app).get('/api/public/payments/totally-unknown/status');
        expect(res.status).toBe(404);
    });

    // Reconciliation fixes (2026-10-16). Each test reproduces a way a parent
    // could pay and never be credited, or be credited wrongly, before the fix.
    describe('payment reconciliation', () => {
        const { reconcileOnlinePayments } = require('../utils/paymentReconciler');
        const { recalculateInvoiceBalance } = require('../utils/invoiceRules');

        async function insertPayment(amount, status, minutesAgo = 0) {
            const reference = `sp_${schoolIdA}_${crypto.randomBytes(12).toString('hex')}`;
            await db.query(
                `INSERT INTO payments (school_id, invoice_id, student_id, amount, source, status, internal_reference, provider, created_at)
                 VALUES (?, ?, ?, ?, 'online', ?, ?, 'paystack', NOW() - INTERVAL ? MINUTE)`,
                [schoolIdA, invoiceId, student1Id, amount, status, reference, minutesAgo]
            );
            return reference;
        }
        const statusOf = async (reference) => (await db.query('SELECT status FROM payments WHERE internal_reference = ?', [reference]))[0][0].status;
        const balance = async () => Number((await request(app).get(`/api/invoices/${invoiceId}`).set('Cookie', cookieA)).body.data.balance);
        const sendWebhook = (payload) => {
            const { rawBody, signature } = signWebhook(payload);
            return request(app).post('/api/payments/webhook').set('Content-Type', 'application/json').set('x-paystack-signature', signature).send(rawBody);
        };
        // Answers Paystack's verify call per reference; anything else is "pending".
        const mockVerify = (answers) => jest.spyOn(paystackGateway, 'verifyTransaction').mockImplementation(async (ref) => {
            const answer = answers[ref];
            if (answer instanceof Error) throw answer;
            return { status: 'pending', amountGhs: 0, channel: 'other', paidAt: null, providerReference: ref, ...(answer || {}) };
        });

        // Earlier tests insert payment rows directly without recalculating
        // the invoice, so bring its stored balance up to date first.
        beforeAll(async () => {
            await recalculateInvoiceBalance(db, invoiceId);
        });
        afterEach(() => jest.restoreAllMocks());

        test('an "abandoned" answer while the MoMo prompt is pending no longer cancels the payment, so the later success is credited', async () => {
            const ref = await insertPayment(20, 'initiated');
            const before = await balance();
            mockVerify({ [ref]: { status: 'cancelled' } });
            const poll = await request(app).get(`/api/public/payments/${ref}/status`);
            expect(poll.body.data.status).toBe('initiated');
            expect(await statusOf(ref)).toBe('initiated');

            expect((await sendWebhook(chargeSuccessPayload({ reference: ref, amountGhs: 20 }))).status).toBe(200);
            expect(await statusOf(ref)).toBe('success');
            expect(await balance()).toBe(before - 20);
        });

        test('a success after a declined attempt on the same checkout wins over "failed"', async () => {
            const ref = await insertPayment(15, 'initiated');
            const before = await balance();
            await sendWebhook({ event: 'charge.failed', data: { reference: ref, amount: 1500, status: 'failed', channel: 'card' } });
            expect(await statusOf(ref)).toBe('failed');
            await sendWebhook(chargeSuccessPayload({ reference: ref, amountGhs: 15 }));
            expect(await statusOf(ref)).toBe('success');
            expect(await balance()).toBe(before - 15);
        });

        test('a payment already wrongly marked "cancelled" (old behaviour) is credited when Paystack confirms it', async () => {
            const ref = await insertPayment(12, 'cancelled');
            const before = await balance();
            await sendWebhook(chargeSuccessPayload({ reference: ref, amountGhs: 12 }));
            expect(await statusOf(ref)).toBe('success');
            expect(await balance()).toBe(before - 12);
        });

        test('a voided payment is never brought back to life by a late success', async () => {
            const ref = await insertPayment(11, 'void');
            const before = await balance();
            jest.spyOn(console, 'error').mockImplementation(() => {});
            await sendWebhook(chargeSuccessPayload({ reference: ref, amountGhs: 11 }));
            expect(await statusOf(ref)).toBe('void');
            expect(await balance()).toBe(before);
        });

        test('money received but not credited (amount mismatch) alerts the owner', async () => {
            const opsAlert = require('../utils/opsAlert');
            const alertSpy = jest.spyOn(opsAlert, 'alertOwner').mockResolvedValue({ sent: true });
            const ref = await insertPayment(6, 'initiated');
            await sendWebhook(chargeSuccessPayload({ reference: ref, amountGhs: 600 }));
            expect(await statusOf(ref)).toBe('failed');
            expect(alertSpy).toHaveBeenCalledWith(`mismatch:${ref}`, expect.stringMatching(/not credited/), expect.any(Array));
        });

        test('a success in the wrong currency is not credited', async () => {
            const ref = await insertPayment(9, 'initiated');
            const before = await balance();
            jest.spyOn(console, 'error').mockImplementation(() => {});
            const payload = chargeSuccessPayload({ reference: ref, amountGhs: 9 });
            payload.data.currency = 'NGN';
            await sendWebhook(payload);
            expect(await statusOf(ref)).toBe('failed');
            expect(await balance()).toBe(before);
        });

        test('a webhook that fails to process (e.g. database paused) returns 500 so Paystack retries, and the retry credits it', async () => {
            const ref = await insertPayment(8, 'initiated');
            const before = await balance();
            jest.spyOn(console, 'error').mockImplementation(() => {});
            // Fail only the webhook's own payment lookup, once. A blanket
            // mockRejectedValueOnce could be swallowed by an unrelated
            // background query and make this test flaky.
            const realQuery = db.query.bind(db);
            let failed = false;
            jest.spyOn(db, 'query').mockImplementation((sql, ...args) => {
                if (!failed && typeof sql === 'string' && sql.includes('FROM payments WHERE internal_reference')) {
                    failed = true;
                    return Promise.reject(new Error('database paused'));
                }
                return realQuery(sql, ...args);
            });
            expect((await sendWebhook(chargeSuccessPayload({ reference: ref, amountGhs: 8 }))).status).toBe(500);
            expect(await statusOf(ref)).toBe('initiated');

            expect((await sendWebhook(chargeSuccessPayload({ reference: ref, amountGhs: 8 }))).status).toBe(200);
            expect(await statusOf(ref)).toBe('success');
            expect(await balance()).toBe(before - 8);
        });

        test('the reconciliation job credits a payment nothing else settled, leaves fresh ones alone, and gives up on very old ones', async () => {
            const lost = await insertPayment(7, 'initiated', 20);
            const fresh = await insertPayment(6, 'initiated', 2);
            const ancient = await insertPayment(5, 'initiated', 49 * 60);
            const before = await balance();
            const verify = mockVerify({
                [lost]: { status: 'success', amountGhs: 7, channel: 'mobile_money', paidAt: new Date(), currency: 'GHS' },
                [ancient]: { status: 'cancelled' },
            });

            const summary = await reconcileOnlinePayments();
            expect(summary.credited).toBeGreaterThanOrEqual(1);
            expect(await statusOf(lost)).toBe('success');
            expect(await statusOf(fresh)).toBe('initiated');
            expect(verify.mock.calls.map((c) => c[0])).not.toContain(fresh);
            expect(await statusOf(ancient)).toBe('cancelled');
            expect(await balance()).toBe(before - 7);
        });

        test('the cron endpoint needs the secret, and reports a failed check with 502 so the scheduler alerts', async () => {
            expect((await request(app).post('/api/cron/reconcile-payments')).status).toBe(401);
            const broken = await insertPayment(4, 'initiated', 20);
            mockVerify({ [broken]: new Error('Paystack timeout') });
            const res = await request(app).post('/api/cron/reconcile-payments').set('x-cron-secret', process.env.CRON_SECRET);
            expect(res.status).toBe(502);
            expect(res.body.data.errors.map((e) => e.reference)).toContain(broken);
            expect(await statusOf(broken)).toBe('initiated');
        });

        // Voids, refunds and overpayment (2026-10-16, council fix list item 3).
        test('a confirmed online payment cannot be voided by the school', async () => {
            const ref = await insertPayment(3, 'success');
            const [[{ id }]] = await db.query('SELECT id FROM payments WHERE internal_reference = ?', [ref]);
            const res = await request(app).post(`/api/payments/${id}/void`).set('Cookie', cookieA).send({ reason: 'trying' });
            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/can't be voided/);
            expect(await statusOf(ref)).toBe('success');
        });

        test('an unsettled online checkout is left out of the payments list unless asked for', async () => {
            const ref = await insertPayment(2, 'initiated');
            const all = await request(app).get('/api/payments').set('Cookie', cookieA);
            expect(all.body.data.map((p) => p.internal_reference)).not.toContain(ref);
            const asked = await request(app).get('/api/payments?status=initiated').set('Cookie', cookieA);
            expect(asked.body.data.map((p) => p.internal_reference)).toContain(ref);
        });

        test('a Paystack refund (transaction reversed) stops the payment counting and the fee is owed again', async () => {
            const ref = await insertPayment(14, 'initiated');
            await sendWebhook(chargeSuccessPayload({ reference: ref, amountGhs: 14 }));
            const afterPay = await balance();
            mockVerify({ [ref]: { status: 'refunded', amountGhs: 14, currency: 'GHS' } });
            const res = await sendWebhook({ event: 'refund.processed', data: { transaction_reference: ref, amount: 1400, currency: 'GHS', status: 'processed' } });
            expect(res.status).toBe(200);
            expect(await statusOf(ref)).toBe('refunded');
            expect(await balance()).toBe(afterPay + 14);

            // Redelivered refund event: no further change.
            await sendWebhook({ event: 'refund.processed', data: { transaction_reference: ref } });
            expect(await balance()).toBe(afterPay + 14);
        });

        test('a refund event Paystack does not report as fully reversed (partial) leaves the payment counted', async () => {
            const ref = await insertPayment(13, 'initiated');
            await sendWebhook(chargeSuccessPayload({ reference: ref, amountGhs: 13 }));
            const afterPay = await balance();
            jest.spyOn(console, 'error').mockImplementation(() => {});
            mockVerify({ [ref]: { status: 'success', amountGhs: 13, currency: 'GHS' } });
            await sendWebhook({ event: 'refund.processed', data: { transaction_reference: ref, amount: 500 } });
            expect(await statusOf(ref)).toBe('success');
            expect(await balance()).toBe(afterPay);
        });

        test('money received beyond the invoice total shows as refund due instead of disappearing', async () => {
            const owed = await balance();
            const ref = await insertPayment(owed, 'initiated');
            // The bursar records the full amount by hand while the parent's
            // online payment for the same amount is still in flight.
            const manual = await request(app).post('/api/payments').set('Cookie', cookieA).send({ invoiceId, amount: owed, method: 'mobile_money' });
            expect(manual.status).toBe(201);
            await sendWebhook(chargeSuccessPayload({ reference: ref, amountGhs: owed }));
            expect(await statusOf(ref)).toBe('success');

            const list = await request(app).get('/api/invoices?overpaid=1').set('Cookie', cookieA);
            const row = list.body.data.find((i) => i.id === invoiceId);
            expect(row).toBeDefined();
            expect(Number(row.refund_due)).toBe(owed);
            expect(Number(row.balance)).toBe(0);

            // Voiding the duplicate manual entry clears it.
            await request(app).post(`/api/payments/${manual.body.data.paymentId}/void`).set('Cookie', cookieA).send({ reason: 'parent also paid online' });
            const after = await request(app).get('/api/invoices?overpaid=1').set('Cookie', cookieA);
            expect(after.body.data.find((i) => i.id === invoiceId)).toBeUndefined();
        });
    });
});
