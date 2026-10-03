const request = require('supertest');
const app = require('../server');
const db = require('../db');

describe('audit logs — financial and administrative actions are recorded (real DB, real HTTP)', () => {
    const MARKER = `CI-AUDIT-${Date.now()}`;
    let cookieA, cookieB;
    let schoolIdA;
    let kofiInvoiceId;

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
        const kofi = await request(app).post('/api/students').set('Cookie', cookieA)
            .send({ admissionNo: `${MARKER}-S1`, firstName: 'Kofi', lastName: 'Mensah', classId: classIdA, academicYearId: yearIdA });

        const fsRes = await request(app).post('/api/fee-structures').set('Cookie', cookieA).send({
            academicYearId: yearIdA, termId: termIdA, classId: classIdA, name: 'Term 1 Fees',
            items: [{ name: 'Tuition', amount: 400 }],
        });
        await request(app).post('/api/invoices/generate').set('Cookie', cookieA).send({ feeStructureId: fsRes.body.data.id });
        const invoices = await request(app).get('/api/invoices').set('Cookie', cookieA);
        kofiInvoiceId = invoices.body.data.find((i) => i.student_id === kofi.body.data.id).id;
    });

    afterAll(async () => {
        await db.query('DELETE FROM audit_logs WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM sms_templates WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM payments WHERE school_id = ?', [schoolIdA]);
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

    test('generating invoices is recorded in the audit log', async () => {
        const res = await request(app).get('/api/audit-logs').set('Cookie', cookieA);
        const entry = res.body.data.find((l) => l.action === 'invoice.generate');
        expect(entry).toBeDefined();
        expect(entry.entity_type).toBe('fee_structure');
        expect(JSON.parse(entry.new_values_json).created).toBe(1);
    });

    test('recording and voiding a payment are both recorded with old/new values', async () => {
        const payRes = await request(app).post('/api/payments').set('Cookie', cookieA).send({ invoiceId: kofiInvoiceId, amount: 200, method: 'cash' });
        const paymentId = payRes.body.data.paymentId;

        await request(app).post(`/api/payments/${paymentId}/void`).set('Cookie', cookieA).send({ reason: 'test void' });

        const res = await request(app).get('/api/audit-logs').set('Cookie', cookieA);
        const createEntry = res.body.data.find((l) => l.action === 'payment.create' && l.entity_id === paymentId);
        expect(createEntry).toBeDefined();
        expect(JSON.parse(createEntry.new_values_json).amount).toBe(200);

        const voidEntry = res.body.data.find((l) => l.action === 'payment.void' && l.entity_id === paymentId);
        expect(voidEntry).toBeDefined();
        expect(JSON.parse(voidEntry.old_values_json).status).toBe('success');
        expect(JSON.parse(voidEntry.new_values_json).reason).toBe('test void');
    });

    test('an SMS template change is recorded', async () => {
        const createRes = await request(app).post('/api/sms-templates').set('Cookie', cookieA).send({ name: 'Audit Test Template', body: 'Hello {{parent_name}}' });
        await request(app).patch(`/api/sms-templates/${createRes.body.data.id}`).set('Cookie', cookieA).send({ name: 'Audit Test Template', body: 'Updated body', status: 'active' });

        const res = await request(app).get('/api/audit-logs?entityType=sms_template').set('Cookie', cookieA);
        expect(res.body.data.some((l) => l.action === 'sms_template.create')).toBe(true);
        expect(res.body.data.some((l) => l.action === 'sms_template.update')).toBe(true);
    });

    test('a Friday-settings change is recorded with the merged before/after state', async () => {
        await request(app).patch('/api/settings/friday-reminders').set('Cookie', cookieA).send({ reminderCooldownDays: 5 });

        const res = await request(app).get('/api/audit-logs?action=settings.update').set('Cookie', cookieA);
        expect(res.body.data.length).toBeGreaterThan(0);
        const newValues = JSON.parse(res.body.data[0].new_values_json);
        expect(newValues.reminderCooldownDays).toBe(5);
    });

    test('every logged entry captures the acting user and an IP address', async () => {
        const res = await request(app).get('/api/audit-logs').set('Cookie', cookieA);
        expect(res.body.data.length).toBeGreaterThan(0);
        for (const entry of res.body.data) {
            expect(entry.user_name).toBe('Admin a');
            expect(entry.ip_address).toBeTruthy();
        }
    });

    test("school B cannot see school A's audit log, and a non-admin cannot be invoked at all (no non-admin role exists yet, so this checks tenant isolation only)", async () => {
        const res = await request(app).get('/api/audit-logs').set('Cookie', cookieB);
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(0);
    });
});
