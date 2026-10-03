const request = require('supertest');
const app = require('../server');
const db = require('../db');

// Phase 2's own acceptance gate, same discipline as Phase 1: tenant
// isolation isn't a one-time proof at the auth layer — it has to be
// re-verified for every new tenant-owned table, since each one is a new
// place a missing `WHERE school_id = ?` could slip in.
describe('academic data (real DB, real HTTP)', () => {
    const MARKER = `CI-ACAD-${Date.now()}`;
    let cookieA, cookieB;
    let yearIdA, termIdA, classIdA, studentIdA, parentIdA;

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
        return res.headers['set-cookie'][0];
    }

    beforeAll(async () => {
        cookieA = await registerSchool('a');
        cookieB = await registerSchool('b');

        const yearRes = await request(app).post('/api/academic-years').set('Cookie', cookieA)
            .send({ name: '2026/2027', startDate: '2026-09-01', endDate: '2027-07-31' });
        yearIdA = yearRes.body.data.id;

        const termRes = await request(app).post('/api/terms').set('Cookie', cookieA)
            .send({ academicYearId: yearIdA, name: 'Term 1', startDate: '2026-09-01', endDate: '2026-12-12' });
        termIdA = termRes.body.data.id;

        const classRes = await request(app).post('/api/classes').set('Cookie', cookieA)
            .send({ name: 'Basic 1', level: 1 });
        classIdA = classRes.body.data.id;

        const studentRes = await request(app).post('/api/students').set('Cookie', cookieA)
            .send({ admissionNo: `${MARKER}-S1`, firstName: 'Kofi', lastName: 'Mensah', classId: classIdA, academicYearId: yearIdA });
        studentIdA = studentRes.body.data.id;

        const parentRes = await request(app).post('/api/parents').set('Cookie', cookieA)
            .send({ fullName: 'Kwame Mensah', phone: '0244000111' });
        parentIdA = parentRes.body.data.id;
    });

    afterAll(async () => {
        await db.query('DELETE FROM parent_student WHERE student_id = ?', [studentIdA]);
        await db.query('DELETE FROM students WHERE admission_no LIKE ?', [`${MARKER}%`]);
        await db.query('DELETE FROM parents WHERE phone = ?', ['0244000111']);
        await db.query('DELETE FROM terms WHERE academic_year_id = ?', [yearIdA]);
        await db.query('DELETE FROM classes WHERE name = ? AND school_id IN (SELECT id FROM schools WHERE code LIKE ?)', ['Basic 1', `${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM academic_years WHERE id = ?', [yearIdA]);
        await db.query('DELETE FROM audit_logs WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM sms_templates WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM users WHERE email LIKE ?', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM schools WHERE code LIKE ?', [`%${MARKER.toLowerCase()}%`]);
        await db.end();
    });

    test('school A can list its own academic years, terms, classes, students, parents', async () => {
        const [years, terms, classes, students, parents] = await Promise.all([
            request(app).get('/api/academic-years').set('Cookie', cookieA),
            request(app).get('/api/terms').set('Cookie', cookieA),
            request(app).get('/api/classes').set('Cookie', cookieA),
            request(app).get('/api/students').set('Cookie', cookieA),
            request(app).get('/api/parents').set('Cookie', cookieA),
        ]);
        expect(years.body.data.some((y) => y.id === yearIdA)).toBe(true);
        expect(terms.body.data.some((t) => t.id === termIdA)).toBe(true);
        expect(classes.body.data.some((c) => c.id === classIdA)).toBe(true);
        expect(students.body.data.some((s) => s.id === studentIdA)).toBe(true);
        expect(parents.body.data.some((p) => p.id === parentIdA)).toBe(true);
    });

    test("school B sees none of school A's academic years, terms, classes, students, or parents", async () => {
        const [years, terms, classes, students, parents] = await Promise.all([
            request(app).get('/api/academic-years').set('Cookie', cookieB),
            request(app).get('/api/terms').set('Cookie', cookieB),
            request(app).get('/api/classes').set('Cookie', cookieB),
            request(app).get('/api/students').set('Cookie', cookieB),
            request(app).get('/api/parents').set('Cookie', cookieB),
        ]);
        expect(years.body.data.some((y) => y.id === yearIdA)).toBe(false);
        expect(terms.body.data.some((t) => t.id === termIdA)).toBe(false);
        expect(classes.body.data.some((c) => c.id === classIdA)).toBe(false);
        expect(students.body.data.some((s) => s.id === studentIdA)).toBe(false);
        expect(parents.body.data.some((p) => p.id === parentIdA)).toBe(false);
    });

    test("school B cannot fetch school A's student or parent by ID directly (IDOR check), even though the IDs are guessable small integers", async () => {
        const studentRes = await request(app).get(`/api/students/${studentIdA}`).set('Cookie', cookieB);
        expect(studentRes.status).toBe(404);
        const parentRes = await request(app).get(`/api/parents/${parentIdA}`).set('Cookie', cookieB);
        expect(parentRes.status).toBe(404);
    });

    test("school B cannot create a student against school A's class or academic year by guessing the ID", async () => {
        const res = await request(app).post('/api/students').set('Cookie', cookieB)
            .send({ admissionNo: `${MARKER}-CROSS`, firstName: 'Cross', lastName: 'Tenant', classId: classIdA, academicYearId: yearIdA });
        expect(res.status).toBe(404);
    });

    test('linking a parent to a student (sibling-capable design) works, and a duplicate link is rejected', async () => {
        const linkRes = await request(app).post(`/api/students/${studentIdA}/parents`).set('Cookie', cookieA)
            .send({ parentId: parentIdA, relationship: 'Father', isPrimary: true });
        expect(linkRes.status).toBe(201);

        const dupRes = await request(app).post(`/api/students/${studentIdA}/parents`).set('Cookie', cookieA)
            .send({ parentId: parentIdA, relationship: 'Father', isPrimary: true });
        expect(dupRes.status).toBe(409);

        const studentDetail = await request(app).get(`/api/students/${studentIdA}`).set('Cookie', cookieA);
        expect(studentDetail.body.data.parents).toHaveLength(1);

        const parentDetail = await request(app).get(`/api/parents/${parentIdA}`).set('Cookie', cookieA);
        expect(parentDetail.body.data.children).toHaveLength(1);
    });

    test('a second student linked to the same parent makes them siblings, visible from the parent record', async () => {
        const student2Res = await request(app).post('/api/students').set('Cookie', cookieA)
            .send({ admissionNo: `${MARKER}-S2`, firstName: 'Ama', lastName: 'Mensah', classId: classIdA, academicYearId: yearIdA });
        const studentId2 = student2Res.body.data.id;

        await request(app).post(`/api/students/${studentId2}/parents`).set('Cookie', cookieA)
            .send({ parentId: parentIdA, relationship: 'Daughter' });

        const parentDetail = await request(app).get(`/api/parents/${parentIdA}`).set('Cookie', cookieA);
        expect(parentDetail.body.data.children).toHaveLength(2);

        await db.query('DELETE FROM parent_student WHERE student_id = ?', [studentId2]);
        await db.query('DELETE FROM students WHERE id = ?', [studentId2]);
    });

    test('duplicate admission number within the same school is rejected', async () => {
        const res = await request(app).post('/api/students').set('Cookie', cookieA)
            .send({ admissionNo: `${MARKER}-S1`, firstName: 'Duplicate', lastName: 'Admission', classId: classIdA, academicYearId: yearIdA });
        expect(res.status).toBe(409);
    });

    test('set-current works and enforces exactly one current year/term per school', async () => {
        const year2Res = await request(app).post('/api/academic-years').set('Cookie', cookieA)
            .send({ name: '2027/2028', startDate: '2027-09-01', endDate: '2028-07-31' });
        const yearId2 = year2Res.body.data.id;

        await request(app).patch(`/api/academic-years/${yearIdA}/set-current`).set('Cookie', cookieA);
        await request(app).patch(`/api/academic-years/${yearId2}/set-current`).set('Cookie', cookieA);

        const years = await request(app).get('/api/academic-years').set('Cookie', cookieA);
        const currentOnes = years.body.data.filter((y) => y.is_current);
        expect(currentOnes).toHaveLength(1);
        expect(currentOnes[0].id).toBe(yearId2);

        await db.query('DELETE FROM academic_years WHERE id = ?', [yearId2]);
    });
});
