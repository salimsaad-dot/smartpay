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
    let yearIdA, termIdA, classIdA, feeTypeIdA;

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
        feeTypeIdA = feeTypesA.body.data.find((t) => t.name === 'School Fees').id;
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

    // Required scenario from the fee-management requirements doc (§9):
    // "Void invoice → Excluded from arrears and reminder breakdowns."
    // Arrears exclusion was already covered; this is the reminder half.
    // Scoped to Kofi only (selected_students) so Yaw is never billed —
    // leaving him out of this structure entirely, not just unchecked.
    test('a voided invoice never appears in {{outstanding_breakdown}}, even though it has a positive balance column', async () => {
        const feeTypesA = await request(app).get('/api/fee-types').set('Cookie', cookieA);
        const feedingTypeId = feeTypesA.body.data.find((t) => t.name === 'Feeding').id;
        await request(app).patch(`/api/fee-types/${feedingTypeId}/applicability`).set('Cookie', cookieA).send({ applicability: 'selected_students' });
        await request(app).put(`/api/fee-types/${feedingTypeId}/eligibility`).set('Cookie', cookieA).send({ studentIds: [kofiStudentId] });

        const fsRes = await request(app).post('/api/fee-structures').set('Cookie', cookieA).send({
            academicYearId: yearIdA, termId: termIdA,
            classId: classIdA, feeTypeId: feedingTypeId, items: [{ name: 'Feeding', amount: 250 }],
        });
        await request(app).post('/api/invoices/generate').set('Cookie', cookieA).send({ feeStructureId: fsRes.body.data.id, dueDate: '2026-12-12' });
        const invoices = await request(app).get('/api/invoices').set('Cookie', cookieA);
        const feedingInvoices = invoices.body.data.filter((i) => i.fee_structure_id === fsRes.body.data.id);
        expect(feedingInvoices).toHaveLength(1); // only Kofi — Yaw was never eligible, never billed
        const feedingInvoice = feedingInvoices[0];

        // Void it directly (no API endpoint voids an invoice; payments'
        // own void action only reverses a payment, same direct-DB pattern
        // tests/arrears.integration.test.js already uses).
        await db.query("UPDATE invoices SET status = 'void' WHERE id = ?", [feedingInvoice.id]);

        const res = await request(app).post('/api/reminders/preview').set('Cookie', cookieA)
            .send({ parentId: mensahParentId, studentId: kofiStudentId, templateId: defaultTemplateId });
        expect(res.status).toBe(200);
        expect(res.body.data.message).not.toContain('Feeding');
        expect(res.body.data.message).toContain('School Fees GHS 500.00');

        await db.query('DELETE FROM invoice_items WHERE invoice_id = ?', [feedingInvoice.id]);
        await db.query('DELETE FROM invoices WHERE id = ?', [feedingInvoice.id]);
        await db.query('DELETE FROM fee_structure_items WHERE fee_structure_id = ?', [fsRes.body.data.id]);
        await db.query('DELETE FROM fee_structures WHERE id = ?', [fsRes.body.data.id]);
        await db.query('DELETE FROM student_fee_eligibility WHERE fee_type_id = ?', [feedingTypeId]);
        await request(app).patch(`/api/fee-types/${feedingTypeId}/applicability`).set('Cookie', cookieA).send({ applicability: 'class_wide' });
    });

    // Required scenario (§9): "Mixed academic periods → Message labels
    // periods accurately and does not falsely assign all items to one
    // term." Kofi gets a second invoice in a genuinely different term,
    // scoped to Kofi only (selected_students) so Yaw is never billed —
    // keeping this test's effect isolated to the one student it's about.
    test('a parent with outstanding invoices spanning two different terms sees both terms named, not just one', async () => {
        const term2Res = await request(app).post('/api/terms').set('Cookie', cookieA)
            .send({ academicYearId: yearIdA, name: 'Term 2', startDate: '2027-01-05', endDate: '2027-04-10' });
        const term2Id = term2Res.body.data.id;

        const graduationTypeId = (await request(app).get('/api/fee-types').set('Cookie', cookieA)).body.data.find((t) => t.name === 'Graduation Fees').id;
        await request(app).patch(`/api/fee-types/${graduationTypeId}/applicability`).set('Cookie', cookieA).send({ applicability: 'selected_students' });
        await request(app).put(`/api/fee-types/${graduationTypeId}/eligibility`).set('Cookie', cookieA).send({ studentIds: [kofiStudentId] });

        const fsRes = await request(app).post('/api/fee-structures').set('Cookie', cookieA).send({
            academicYearId: yearIdA, termId: term2Id, classId: classIdA, feeTypeId: graduationTypeId,
            items: [{ name: 'Graduation', amount: 450 }],
        });
        await request(app).post('/api/invoices/generate').set('Cookie', cookieA).send({ feeStructureId: fsRes.body.data.id, dueDate: '2027-04-10' });

        // The default template (since Phase 4) leads with
        // {{outstanding_breakdown}}, not {{term_name}} — a school that
        // wants period info in the message adds {{term_name}} itself, so
        // that's what this test exercises directly, against a custom
        // template, to prove scope.termName doesn't silently collapse a
        // 2-term scope down to just one term's name.
        const periodTemplate = await request(app).post('/api/sms-templates').set('Cookie', cookieA)
            .send({ name: 'Period Test Template', body: 'Periods: {{term_name}}. {{outstanding_breakdown}}. Total: {{total_balance}}. {{payment_link}}' });

        const res = await request(app).post('/api/reminders/preview').set('Cookie', cookieA)
            .send({ parentId: mensahParentId, studentId: kofiStudentId, templateId: periodTemplate.body.data.id });
        expect(res.status).toBe(200);
        expect(res.body.data.message).toContain('Term 1');
        expect(res.body.data.message).toContain('Term 2');
        expect(res.body.data.message).toContain('School Fees GHS 500.00');
        expect(res.body.data.message).toContain('Graduation Fees GHS 450.00');
        // Both term's invoices must be reflected in the total, not
        // silently dropped or double-counted.
        expect(res.body.data.message).toContain('GHS 950.00');

        const invoices = await request(app).get('/api/invoices').set('Cookie', cookieA);
        const term2Invoice = invoices.body.data.find((i) => i.fee_structure_id === fsRes.body.data.id);
        await db.query('DELETE FROM invoice_items WHERE invoice_id = ?', [term2Invoice.id]);
        await db.query('DELETE FROM invoices WHERE id = ?', [term2Invoice.id]);
        await db.query('DELETE FROM fee_structure_items WHERE fee_structure_id = ?', [fsRes.body.data.id]);
        await db.query('DELETE FROM fee_structures WHERE id = ?', [fsRes.body.data.id]);
        await db.query('DELETE FROM student_fee_eligibility WHERE fee_type_id = ?', [graduationTypeId]);
        await request(app).patch(`/api/fee-types/${graduationTypeId}/applicability`).set('Cookie', cookieA).send({ applicability: 'class_wide' });
        await db.query('DELETE FROM terms WHERE id = ?', [term2Id]);
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
