const request = require('supertest');
const app = require('../server');
const db = require('../db');

// Covers the 2026-10-07 redesign addition: optionally collecting a
// parent/guardian's name + phone directly on POST /students, mirroring
// Academia Hub's enrollOneStudent lookup-or-create-parent pattern —
// real DB, real HTTP, including the sibling-dedup and tenant-isolation
// cases that matter most for this feature.
describe('POST /students — optional inline parent collection (real DB, real HTTP)', () => {
    const MARKER = `CI-ENROLL-${Date.now()}`;
    let cookieA, cookieB;
    let schoolIdA, schoolIdB;
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
        const b = await registerSchool('b');
        cookieB = b.cookie;
        schoolIdB = b.schoolId;

        const yearRes = await request(app).post('/api/academic-years').set('Cookie', cookieA)
            .send({ name: '2026/2027', startDate: '2026-09-01', endDate: '2027-07-31' });
        yearIdA = yearRes.body.data.id;
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
        await db.query('DELETE FROM fee_types WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM sms_templates WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM schools WHERE code LIKE ?', [`%${MARKER.toLowerCase()}%`]);
        await db.end();
    });

    test('creating a student with no parent fields still works exactly as before', async () => {
        const res = await request(app).post('/api/students').set('Cookie', cookieA).send({
            admissionNo: `${MARKER}-NOPARENT`, firstName: 'Kojo', lastName: 'NoParent',
            classId: classIdA, academicYearId: yearIdA,
        });
        expect(res.status).toBe(201);
        expect(res.body.data.parentId).toBeNull();
    });

    test('parent name without phone (or vice versa) is rejected', async () => {
        const res = await request(app).post('/api/students').set('Cookie', cookieA).send({
            admissionNo: `${MARKER}-PARTIAL`, firstName: 'Ama', lastName: 'Partial',
            classId: classIdA, academicYearId: yearIdA, parentFullName: 'Mrs Mensah',
        });
        expect(res.status).toBe(400);
    });

    test('creating a student with parent info creates and links a new parent, marked primary', async () => {
        const res = await request(app).post('/api/students').set('Cookie', cookieA).send({
            admissionNo: `${MARKER}-S1`, firstName: 'Kofi', lastName: 'Mensah',
            classId: classIdA, academicYearId: yearIdA,
            parentFullName: 'Mrs Mensah', parentPhone: '0241234567', relationship: 'Mother',
        });
        expect(res.status).toBe(201);
        expect(res.body.data.parentId).not.toBeNull();

        const detail = await request(app).get(`/api/students/${res.body.data.id}`).set('Cookie', cookieA);
        expect(detail.body.data.parents).toHaveLength(1);
        expect(detail.body.data.parents[0].full_name).toBe('Mrs Mensah');
        expect(detail.body.data.parents[0].is_primary).toBe(1);
        expect(detail.body.data.parents[0].relationship).toBe('Mother');
    });

    test('a sibling with the same parent phone reuses the existing parent instead of duplicating it', async () => {
        const first = await request(app).post('/api/students').set('Cookie', cookieA).send({
            admissionNo: `${MARKER}-SIB1`, firstName: 'Yaw', lastName: 'Owusu',
            classId: classIdA, academicYearId: yearIdA,
            parentFullName: 'Mr Owusu', parentPhone: '0241111111',
        });
        const second = await request(app).post('/api/students').set('Cookie', cookieA).send({
            admissionNo: `${MARKER}-SIB2`, firstName: 'Abena', lastName: 'Owusu',
            classId: classIdA, academicYearId: yearIdA,
            parentFullName: 'Mr Owusu', parentPhone: '0241111111',
        });

        expect(first.body.data.parentId).toBe(second.body.data.parentId);

        const [[count]] = await db.query('SELECT COUNT(*) AS n FROM parents WHERE school_id = ? AND phone = ?', [schoolIdA, '0241111111']);
        expect(count.n).toBe(1);

        // Each sibling's own link is independently primary (two separate
        // students, each with exactly one parent linked so far).
        const secondDetail = await request(app).get(`/api/students/${second.body.data.id}`).set('Cookie', cookieA);
        expect(secondDetail.body.data.parents[0].is_primary).toBe(1);
    });

    test('a matching phone in a different school does not get reused across tenants', async () => {
        const yearB = await request(app).post('/api/academic-years').set('Cookie', cookieB)
            .send({ name: '2026/2027', startDate: '2026-09-01', endDate: '2027-07-31' });
        const classB = await request(app).post('/api/classes').set('Cookie', cookieB).send({ name: 'Basic 1' });

        // try/finally — this test's cleanup must run even if an assertion
        // below fails, or School B's year/class/student/parent orphan the
        // database, which then breaks afterAll's own schools delete on its
        // *next* run (a real failure mode hit live: an earlier version of
        // this test used a global, unscoped phone-count assertion that a
        // sibling test file's reused fixture phone number could break when
        // the full suite ran together, silently skipping everything below
        // it and leaving exactly this kind of orphaned data).
        try {
            const res = await request(app).post('/api/students').set('Cookie', cookieB).send({
                admissionNo: `${MARKER}-CROSS`, firstName: 'Esi', lastName: 'CrossTenant',
                classId: classB.body.data.id, academicYearId: yearB.body.data.id,
                parentFullName: 'Mr Owusu', parentPhone: '0241111111',
            });
            expect(res.status).toBe(201);

            // Scoped per school, not a global count — this database is
            // shared with other test files that may reuse the same fixture
            // phone number, so a global count is never a safe assertion.
            const [[schoolBParent]] = await db.query('SELECT id FROM parents WHERE school_id = ? AND phone = ?', [schoolIdB, '0241111111']);
            expect(schoolBParent).toBeTruthy();
            expect(schoolBParent.id).toBe(res.body.data.parentId);

            const [[schoolAParent]] = await db.query('SELECT id FROM parents WHERE school_id = ? AND phone = ?', [schoolIdA, '0241111111']);
            // School A's own sibling-dedup test earlier in this file also used
            // this phone — confirms it's a genuinely different parent row,
            // not the same one leaking across tenants.
            expect(schoolAParent).toBeTruthy();
            expect(schoolAParent.id).not.toBe(schoolBParent.id);

            await db.query('DELETE FROM parent_student WHERE student_id = ?', [res.body.data.id]);
            await db.query('DELETE FROM parents WHERE id = ?', [res.body.data.parentId]);
            await db.query('DELETE FROM students WHERE id = ?', [res.body.data.id]);
        } finally {
            await db.query('DELETE FROM classes WHERE id = ?', [classB.body.data.id]);
            await db.query('DELETE FROM academic_years WHERE id = ?', [yearB.body.data.id]);
        }
    });
});
