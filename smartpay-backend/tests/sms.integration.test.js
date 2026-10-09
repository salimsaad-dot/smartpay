const request = require('supertest');
const app = require('../server');
const db = require('../db');

// Checks whichever provider is actually active via the SMS_PROVIDER
// switch, not a specific adapter's key by name — a hardcoded
// MNOTIFY_API_KEY check would wrongly conclude "not configured" (and
// un-skip the real-send test below) the moment a different provider is
// active with its own real key but no MNOTIFY_API_KEY set at all.
const smsProvider = require('../utils/smsProvider');
const hasRealProviderKey = smsProvider.validateConfiguration();

describe('SMS templates and manual reminders (real DB, real HTTP)', () => {
    const MARKER = `CI-SMS-${Date.now()}`;
    let cookieA, cookieB;
    let schoolIdA;
    let mensahParentId, badPhoneParentId;
    let kofiStudentId, yawStudentId;
    let kofiInvoiceId, yawInvoiceId;
    let defaultTemplateId;

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
        kofiStudentId = kofi.body.data.id;
        const yaw = await request(app).post('/api/students').set('Cookie', cookieA)
            .send({ admissionNo: `${MARKER}-S2`, firstName: 'Yaw', lastName: 'Mensah', classId: classIdA, academicYearId: yearIdA });
        yawStudentId = yaw.body.data.id;

        const mensah = await request(app).post('/api/parents').set('Cookie', cookieA)
            .send({ fullName: 'Mrs Mensah', phone: '0241234567' });
        mensahParentId = mensah.body.data.id;
        const badPhoneParent = await request(app).post('/api/parents').set('Cookie', cookieA)
            .send({ fullName: 'Mr Badphone', phone: '123' });
        badPhoneParentId = badPhoneParent.body.data.id;

        await db.query('INSERT INTO parent_student (parent_id, student_id, is_primary) VALUES (?, ?, 1)', [mensahParentId, kofiStudentId]);
        await db.query('INSERT INTO parent_student (parent_id, student_id, is_primary) VALUES (?, ?, 1)', [mensahParentId, yawStudentId]);

        const feeTypesA = await request(app).get('/api/fee-types').set('Cookie', cookieA);
        const feeTypeIdA = feeTypesA.body.data.find((t) => t.name === 'School Fees').id;
        const fsRes = await request(app).post('/api/fee-structures').set('Cookie', cookieA).send({
            academicYearId: yearIdA, termId: termIdA, classId: classIdA, feeTypeId: feeTypeIdA,
            items: [{ name: 'Tuition', amount: 400 }, { name: 'ICT', amount: 100 }],
        });
        await request(app).post('/api/invoices/generate').set('Cookie', cookieA).send({ feeStructureId: fsRes.body.data.id });
        const list = await request(app).get('/api/invoices').set('Cookie', cookieA);
        kofiInvoiceId = list.body.data.find((i) => i.student_id === kofiStudentId).id;
        yawInvoiceId = list.body.data.find((i) => i.student_id === yawStudentId).id;

        const templates = await request(app).get('/api/sms-templates').set('Cookie', cookieA);
        defaultTemplateId = templates.body.data[0].id;
    });

    afterAll(async () => {
        await db.query('DELETE FROM sms_reminders WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM audit_logs WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM sms_templates WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
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
        await db.query('DELETE FROM users WHERE email LIKE ?', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM schools WHERE code LIKE ?', [`%${MARKER.toLowerCase()}%`]);
        await db.end();
    });

    test('a new school is auto-seeded with one active default SMS template', async () => {
        const res = await request(app).get('/api/sms-templates').set('Cookie', cookieA);
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].status).toBe('active');
        expect(res.body.data[0].body).toContain('{{payment_link}}');
    });

    let friendlyTemplateId;

    test('a new template can be created, and a duplicate name is rejected', async () => {
        const res = await request(app).post('/api/sms-templates').set('Cookie', cookieA)
            .send({ name: 'Friendly Reminder', body: 'Hi {{parent_name}}, please pay {{total_balance}}. {{payment_link}}' });
        expect(res.status).toBe(201);
        friendlyTemplateId = res.body.data.id;

        const dup = await request(app).post('/api/sms-templates').set('Cookie', cookieA)
            .send({ name: 'Friendly Reminder', body: 'Another body' });
        expect(dup.status).toBe(409);
    });

    // Deliberately updates the newly-created template, not the auto-seeded
    // default one (defaultTemplateId) — later tests rely on the default
    // template's original, variable-rich body to verify rendering, and
    // mutating it here would silently break them.
    test('a template can be updated', async () => {
        const res = await request(app).patch(`/api/sms-templates/${friendlyTemplateId}`).set('Cookie', cookieA)
            .send({ name: 'Friendly Reminder', body: 'Updated body {{payment_link}}', status: 'active' });
        expect(res.status).toBe(200);
    });

    test('previewing a single-invoice reminder renders variables correctly with a placeholder link, and creates no real payment link', async () => {
        const before = await db.query('SELECT COUNT(*) AS c FROM payment_links WHERE parent_id = ?', [mensahParentId]);
        const res = await request(app).post('/api/reminders/preview').set('Cookie', cookieA)
            .send({ parentId: mensahParentId, invoiceId: kofiInvoiceId });
        expect(res.status).toBe(200);
        expect(res.body.data.message).toContain('Kofi Mensah');
        expect(res.body.data.message).toContain('secure payment link');
        expect(res.body.data.phone).toBe('0241234567');

        const after = await db.query('SELECT COUNT(*) AS c FROM payment_links WHERE parent_id = ?', [mensahParentId]);
        expect(after[0][0].c).toBe(before[0][0].c);
    });

    test('{{school_momo_number}} renders the school\'s MoMo number when set, and renders empty (not the literal "null") when unset', async () => {
        const noMomo = await request(app).post('/api/sms-templates').set('Cookie', cookieA)
            .send({ name: 'Momo Variable Test', body: 'Pay {{payment_link}} or MoMo: {{school_momo_number}}.' });

        const previewUnset = await request(app).post('/api/reminders/preview').set('Cookie', cookieA)
            .send({ parentId: mensahParentId, invoiceId: kofiInvoiceId, templateId: noMomo.body.data.id });
        expect(previewUnset.body.data.message).toBe('Pay (a secure payment link will be included) or MoMo: .');
        expect(previewUnset.body.data.message).not.toContain('null');

        await request(app).patch('/api/settings/profile').set('Cookie', cookieA).send({ momoNumber: '0241234567' });
        const previewSet = await request(app).post('/api/reminders/preview').set('Cookie', cookieA)
            .send({ parentId: mensahParentId, invoiceId: kofiInvoiceId, templateId: noMomo.body.data.id });
        expect(previewSet.body.data.message).toContain('MoMo: 0241234567');

        await request(app).patch('/api/settings/profile').set('Cookie', cookieA).send({ momoNumber: '' });
    });

    // fee-management Phase 4: {{outstanding_breakdown}} pulls the real
    // fee type name through resolveReminderScope's new fee_structures/
    // fee_types join, not just the invoice total — proven against a
    // real DB row, not a synthetic one (see tests/reminderCore.test.js
    // for the formatting/truncation unit coverage).
    test('{{outstanding_breakdown}} renders the real fee type name and balance for a single invoice', async () => {
        const res = await request(app).post('/api/reminders/preview').set('Cookie', cookieA)
            .send({ parentId: mensahParentId, invoiceId: kofiInvoiceId, templateId: defaultTemplateId });
        expect(res.status).toBe(200);
        expect(res.body.data.message).toContain('School Fees GHS 500.00');
    });

    test('{{outstanding_breakdown}} attributes each child\'s own fee items by name when a parent has multiple children in scope', async () => {
        const res = await request(app).post('/api/reminders/preview').set('Cookie', cookieA)
            .send({ parentId: mensahParentId, templateId: defaultTemplateId });
        expect(res.status).toBe(200);
        expect(res.body.data.message).toContain('Kofi Mensah: School Fees GHS 500.00');
        expect(res.body.data.message).toContain('Yaw Mensah: School Fees GHS 500.00');
    });

    test('previewing a parent-level reminder (no studentId/invoiceId) consolidates both children and sums the balance', async () => {
        const res = await request(app).post('/api/reminders/preview').set('Cookie', cookieA)
            .send({ parentId: mensahParentId });
        expect(res.status).toBe(200);
        expect(res.body.data.message).toContain('Kofi Mensah');
        expect(res.body.data.message).toContain('Yaw Mensah');
        expect(res.body.data.message).toContain('1,000.00');
    });

    test('previewing with no outstanding balance in scope is rejected', async () => {
        await db.query("UPDATE invoices SET balance = 0, status = 'paid' WHERE id = ?", [kofiInvoiceId]);
        const res = await request(app).post('/api/reminders/preview').set('Cookie', cookieA)
            .send({ parentId: mensahParentId, invoiceId: kofiInvoiceId });
        expect(res.status).toBe(400);
        await db.query("UPDATE invoices SET balance = 500, status = 'unpaid' WHERE id = ?", [kofiInvoiceId]);
    });

    test('sending a reminder to a parent with an invalid phone number is rejected cleanly, with no payment link generated', async () => {
        const before = await db.query('SELECT COUNT(*) AS c FROM payment_links WHERE parent_id = ?', [badPhoneParentId]);
        await db.query('INSERT INTO parent_student (parent_id, student_id, is_primary) VALUES (?, ?, 1)', [badPhoneParentId, yawStudentId]);

        const res = await request(app).post('/api/reminders/send').set('Cookie', cookieA)
            .send({ parentId: badPhoneParentId, invoiceId: yawInvoiceId });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/phone/i);

        const after = await db.query('SELECT COUNT(*) AS c FROM payment_links WHERE parent_id = ?', [badPhoneParentId]);
        expect(after[0][0].c).toBe(before[0][0].c);

        await db.query('DELETE FROM parent_student WHERE parent_id = ? AND student_id = ?', [badPhoneParentId, yawStudentId]);
    });

    // Only meaningful when no real key is configured for whichever
    // provider SMS_PROVIDER currently selects — with a real key present,
    // this test's whole premise (provider isn't configured) no longer
    // holds, and deliberately isn't replaced with a real-send equivalent
    // here: unlike Paystack's safe-to-repeat initialize call (starts a
    // transaction, charges nothing), an actual SMS send is a real,
    // billable, irreversible side effect that shouldn't fire on every
    // test run. A real send is verified once, live, outside the
    // automated suite — see smartpay/DESIGN.md.
    (hasRealProviderKey ? test.skip : test)(
        'sending a reminder when the SMS provider has no API key configured fails gracefully with a clean 400, not a crash',
        async () => {
            const res = await request(app).post('/api/reminders/send').set('Cookie', cookieA)
                .send({ parentId: mensahParentId, invoiceId: yawInvoiceId });
            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/not configured/i);
        }
    );

    test("school B cannot preview or send a reminder for school A's parent", async () => {
        const previewRes = await request(app).post('/api/reminders/preview').set('Cookie', cookieB)
            .send({ parentId: mensahParentId, invoiceId: yawInvoiceId });
        expect(previewRes.status).toBe(404);

        const sendRes = await request(app).post('/api/reminders/send').set('Cookie', cookieB)
            .send({ parentId: mensahParentId, invoiceId: yawInvoiceId });
        expect(sendRes.status).toBe(404);
    });

    test('a reminder attempt that fails provider validation is NOT recorded in reminder history (nothing was actually attempted)', async () => {
        const res = await request(app).get('/api/reminders').set('Cookie', cookieA);
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(0);
    });
});
