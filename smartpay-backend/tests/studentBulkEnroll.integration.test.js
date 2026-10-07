const request = require('supertest');
const app = require('../server');
const db = require('../db');

// Covers POST /students/bulk-enroll — the CSV-driven counterpart to the
// single Add Student form, sharing the same enrollOneStudent core but
// resolving a row's plain-text class/academic-year names first (real DB,
// real HTTP).
describe('POST /students/bulk-enroll (real DB, real HTTP)', () => {
    const MARKER = `CI-BULK-${Date.now()}`;
    let cookieA;
    let schoolIdA;
    let classIdA, yearIdA;

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

        const yearRes = await request(app).post('/api/academic-years').set('Cookie', cookieA)
            .send({ name: '2026/2027', startDate: '2026-09-01', endDate: '2027-07-31' });
        yearIdA = yearRes.body.data.id;
        await request(app).patch(`/api/academic-years/${yearIdA}/set-current`).set('Cookie', cookieA);
        const classRes = await request(app).post('/api/classes').set('Cookie', cookieA).send({ name: 'Basic 1' });
        classIdA = classRes.body.data.id;
    });

    afterAll(async () => {
        await db.query('DELETE FROM parent_student WHERE student_id IN (SELECT id FROM students WHERE school_id = ?)', [schoolIdA]);
        await db.query('DELETE FROM parents WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM students WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM classes WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM academic_years WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM users WHERE email LIKE ?', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM sms_templates WHERE school_id = ?', [schoolIdA]);
        await db.query('DELETE FROM schools WHERE code LIKE ?', [`%${MARKER.toLowerCase()}%`]);
        await db.end();
    });

    test('rejects an empty or missing rows array', async () => {
        const res1 = await request(app).post('/api/students/bulk-enroll').set('Cookie', cookieA).send({ rows: [] });
        expect(res1.status).toBe(400);
        const res2 = await request(app).post('/api/students/bulk-enroll').set('Cookie', cookieA).send({});
        expect(res2.status).toBe(400);
    });

    test('rejects more than 200 rows', async () => {
        const rows = Array.from({ length: 201 }, (_, i) => ({ admissionNo: `X${i}`, firstName: 'A', lastName: 'B', className: 'Basic 1' }));
        const res = await request(app).post('/api/students/bulk-enroll').set('Cookie', cookieA).send({ rows });
        expect(res.status).toBe(400);
    });

    test('a good row succeeds; a row with an unknown class name fails without affecting the others', async () => {
        const res = await request(app).post('/api/students/bulk-enroll').set('Cookie', cookieA).send({
            rows: [
                { admissionNo: `${MARKER}-S1`, firstName: 'Kofi', lastName: 'Mensah', className: 'Basic 1' },
                { admissionNo: `${MARKER}-S2`, firstName: 'Bad', lastName: 'Row', className: 'Nonexistent Class' },
            ],
        });
        expect(res.status).toBe(200);
        expect(res.body.data.successCount).toBe(1);
        expect(res.body.data.failCount).toBe(1);
        expect(res.body.data.results[0].status).toBe('success');
        expect(res.body.data.results[1].status).toBe('error');
        expect(res.body.data.results[1].message).toMatch(/Nonexistent Class/);
    });

    test('academicYear left blank defaults to the current academic year', async () => {
        const res = await request(app).post('/api/students/bulk-enroll').set('Cookie', cookieA).send({
            rows: [{ admissionNo: `${MARKER}-NOYEAR`, firstName: 'Ama', lastName: 'Default', className: 'Basic 1' }],
        });
        expect(res.body.data.successCount).toBe(1);

        const [[student]] = await db.query('SELECT academic_year_id FROM students WHERE admission_no = ?', [`${MARKER}-NOYEAR`]);
        expect(student.academic_year_id).toBe(yearIdA);
    });

    test('a row naming an unknown academic year fails with a clear message', async () => {
        const res = await request(app).post('/api/students/bulk-enroll').set('Cookie', cookieA).send({
            rows: [{ admissionNo: `${MARKER}-BADYEAR`, firstName: 'X', lastName: 'Y', className: 'Basic 1', academicYear: '1999/2000' }],
        });
        expect(res.body.data.failCount).toBe(1);
        expect(res.body.data.results[0].message).toMatch(/1999\/2000/);
    });

    test('a parent given in a row is created and linked; a second row sharing the same phone reuses it (sibling dedup)', async () => {
        const res = await request(app).post('/api/students/bulk-enroll').set('Cookie', cookieA).send({
            rows: [
                { admissionNo: `${MARKER}-SIB1`, firstName: 'Yaw', lastName: 'Owusu', className: 'Basic 1', parentFullName: 'Mr Owusu', parentPhone: '0241111111' },
                { admissionNo: `${MARKER}-SIB2`, firstName: 'Abena', lastName: 'Owusu', className: 'Basic 1', parentFullName: 'Mr Owusu', parentPhone: '0241111111' },
            ],
        });
        expect(res.body.data.successCount).toBe(2);
        expect(res.body.data.results[0].parentId).toBe(res.body.data.results[1].parentId);

        const [[count]] = await db.query('SELECT COUNT(*) AS n FROM parents WHERE school_id = ? AND phone = ?', [schoolIdA, '0241111111']);
        expect(count.n).toBe(1);
    });

    test('a row with only a parent name but no phone (or vice versa) fails cleanly', async () => {
        const res = await request(app).post('/api/students/bulk-enroll').set('Cookie', cookieA).send({
            rows: [{ admissionNo: `${MARKER}-PARTIAL`, firstName: 'X', lastName: 'Y', className: 'Basic 1', parentFullName: 'No Phone Parent' }],
        });
        expect(res.body.data.failCount).toBe(1);
    });

    test('a duplicate admission number within the same batch fails on the second occurrence only', async () => {
        const res = await request(app).post('/api/students/bulk-enroll').set('Cookie', cookieA).send({
            rows: [
                { admissionNo: `${MARKER}-DUP`, firstName: 'First', lastName: 'One', className: 'Basic 1' },
                { admissionNo: `${MARKER}-DUP`, firstName: 'Second', lastName: 'Two', className: 'Basic 1' },
            ],
        });
        expect(res.body.data.successCount).toBe(1);
        expect(res.body.data.failCount).toBe(1);
        expect(res.body.data.results[1].message).toMatch(/already exists/);
    });
});
