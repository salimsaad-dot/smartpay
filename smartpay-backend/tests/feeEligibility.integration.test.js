const request = require('supertest');
const app = require('../server');
const db = require('../db');

describe('fee management Phase 2 — selected-student eligibility and generation preview (real DB, real HTTP)', () => {
    const MARKER = `CI-ELIG-${Date.now()}`;
    let cookieA, cookieB;
    let schoolIdA;
    let yearIdA, termIdA, classIdA;
    let kofiId, amaId, yawId;
    let transportTypeId, schoolFeesTypeId;

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
        const classRes = await request(app).post('/api/classes').set('Cookie', cookieA).send({ name: 'Basic 2' });
        classIdA = classRes.body.data.id;

        const kofi = await request(app).post('/api/students').set('Cookie', cookieA)
            .send({ admissionNo: `${MARKER}-S1`, firstName: 'Kofi', lastName: 'Mensah', classId: classIdA, academicYearId: yearIdA });
        kofiId = kofi.body.data.id;
        const ama = await request(app).post('/api/students').set('Cookie', cookieA)
            .send({ admissionNo: `${MARKER}-S2`, firstName: 'Ama', lastName: 'Owusu', classId: classIdA, academicYearId: yearIdA });
        amaId = ama.body.data.id;
        const yaw = await request(app).post('/api/students').set('Cookie', cookieA)
            .send({ admissionNo: `${MARKER}-S3`, firstName: 'Yaw', lastName: 'Boateng', classId: classIdA, academicYearId: yearIdA });
        yawId = yaw.body.data.id;

        const feeTypesA = await request(app).get('/api/fee-types').set('Cookie', cookieA);
        schoolFeesTypeId = feeTypesA.body.data.find((t) => t.name === 'School Fees').id;

        const transportRes = await request(app).post('/api/fee-types').set('Cookie', cookieA)
            .send({ name: 'Transportation Test', applicability: 'selected_students' });
        transportTypeId = transportRes.body.data.id;
    });

    afterAll(async () => {
        await db.query('DELETE FROM student_fee_eligibility WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE school_id = ?)', [schoolIdA]);
        await db.query('DELETE FROM invoices WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM fee_structure_items WHERE fee_structure_id IN (SELECT id FROM fee_structures WHERE school_id = ?)', [schoolIdA]);
        await db.query('DELETE FROM fee_structures WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM fee_types WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
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

    test('a new fee type defaults to class_wide applicability unless specified', async () => {
        const res = await request(app).get('/api/fee-types?status=all').set('Cookie', cookieA);
        const schoolFees = res.body.data.find((t) => t.id === schoolFeesTypeId);
        expect(schoolFees.applicability).toBe('class_wide');
        const transport = res.body.data.find((t) => t.id === transportTypeId);
        expect(transport.applicability).toBe('selected_students');
    });

    test('eligibility list initially shows all active students as not eligible', async () => {
        const res = await request(app).get(`/api/fee-types/${transportTypeId}/eligibility`).set('Cookie', cookieA);
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(3);
        expect(res.body.data.every((s) => s.eligible === false)).toBe(true);
    });

    test('updating eligibility correctly marks selected students and leaves others out', async () => {
        const res = await request(app).put(`/api/fee-types/${transportTypeId}/eligibility`).set('Cookie', cookieA)
            .send({ studentIds: [kofiId, amaId] });
        expect(res.status).toBe(200);
        expect(res.body.data.studentCount).toBe(2);

        const list = await request(app).get(`/api/fee-types/${transportTypeId}/eligibility`).set('Cookie', cookieA);
        const kofiRow = list.body.data.find((s) => s.id === kofiId);
        const yawRow = list.body.data.find((s) => s.id === yawId);
        expect(kofiRow.eligible).toBe(true);
        expect(yawRow.eligible).toBe(false);
    });

    test('re-saving eligibility replaces the set wholesale (not additive)', async () => {
        await request(app).put(`/api/fee-types/${transportTypeId}/eligibility`).set('Cookie', cookieA)
            .send({ studentIds: [yawId] });
        const list = await request(app).get(`/api/fee-types/${transportTypeId}/eligibility`).set('Cookie', cookieA);
        expect(list.body.data.find((s) => s.id === kofiId).eligible).toBe(false);
        expect(list.body.data.find((s) => s.id === yawId).eligible).toBe(true);

        // Restore for the generation tests below.
        await request(app).put(`/api/fee-types/${transportTypeId}/eligibility`).set('Cookie', cookieA)
            .send({ studentIds: [kofiId, amaId] });
    });

    test('generation preview for a selected_students fee structure only counts eligible students', async () => {
        const fsRes = await request(app).post('/api/fee-structures').set('Cookie', cookieA).send({
            academicYearId: yearIdA, termId: termIdA, classId: classIdA, feeTypeId: transportTypeId,
            items: [{ name: 'Transport', amount: 150 }],
        });
        const feeStructureId = fsRes.body.data.id;

        const preview = await request(app).get(`/api/invoices/generation-preview?feeStructureId=${feeStructureId}`).set('Cookie', cookieA);
        expect(preview.status).toBe(200);
        expect(preview.body.data.studentCount).toBe(2);
        expect(Number(preview.body.data.totalAmount)).toBe(150);
        expect(preview.body.data.newInvoiceCount).toBe(2);
        const names = preview.body.data.students.map((s) => s.name).sort();
        expect(names).toEqual(['Ama Owusu', 'Kofi Mensah']);

        await db.query('DELETE FROM fee_structure_items WHERE fee_structure_id = ?', [feeStructureId]);
        await db.query('DELETE FROM fee_structures WHERE id = ?', [feeStructureId]);
    });

    test('actual generation for a selected_students fee structure only bills eligible students, not the whole class', async () => {
        const fsRes = await request(app).post('/api/fee-structures').set('Cookie', cookieA).send({
            academicYearId: yearIdA, termId: termIdA, classId: classIdA, feeTypeId: transportTypeId,
            items: [{ name: 'Transport', amount: 150 }],
        });
        const feeStructureId = fsRes.body.data.id;

        const genRes = await request(app).post('/api/invoices/generate').set('Cookie', cookieA).send({ feeStructureId, dueDate: '2026-12-12' });
        expect(genRes.body.data.created).toBe(2);
        expect(genRes.body.data.totalEligibleStudents).toBe(2);

        const invoices = await request(app).get('/api/invoices').set('Cookie', cookieA).query({ classId: classIdA });
        const transportInvoices = invoices.body.data.filter((i) => i.fee_structure_id === feeStructureId);
        expect(transportInvoices).toHaveLength(2);
        expect(transportInvoices.some((i) => i.student_id === yawId)).toBe(false);
    });

    test('a class_wide fee structure still bills every active student, unaffected by Phase 2', async () => {
        const fsRes = await request(app).post('/api/fee-structures').set('Cookie', cookieA).send({
            academicYearId: yearIdA, termId: termIdA, classId: classIdA, feeTypeId: schoolFeesTypeId,
            items: [{ name: 'Tuition', amount: 500 }],
        });
        const feeStructureId = fsRes.body.data.id;

        const genRes = await request(app).post('/api/invoices/generate').set('Cookie', cookieA).send({ feeStructureId, dueDate: '2026-12-12' });
        expect(genRes.body.data.created).toBe(3);
    });

    test("school B cannot view or modify school A's fee-type eligibility", async () => {
        const list = await request(app).get(`/api/fee-types/${transportTypeId}/eligibility`).set('Cookie', cookieB);
        expect(list.status).toBe(404);

        const update = await request(app).put(`/api/fee-types/${transportTypeId}/eligibility`).set('Cookie', cookieB).send({ studentIds: [] });
        expect(update.status).toBe(404);

        const applicability = await request(app).patch(`/api/fee-types/${transportTypeId}/applicability`).set('Cookie', cookieB).send({ applicability: 'class_wide' });
        expect(applicability.status).toBe(404);
    });

    test('invalid applicability value is rejected', async () => {
        const res = await request(app).post('/api/fee-types').set('Cookie', cookieA)
            .send({ name: 'Bad Applicability Type', applicability: 'nonsense' });
        expect(res.status).toBe(400);
    });
});
