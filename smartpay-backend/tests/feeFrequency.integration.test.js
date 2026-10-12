const request = require('supertest');
const app = require('../server');
const db = require('../db');

describe('fee management Phase 3 — display-only frequency label (real DB, real HTTP)', () => {
    const MARKER = `CI-FREQ-${Date.now()}`;
    let cookieA, cookieB;
    let schoolIdA;
    let schoolFeesTypeId;

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

        const feeTypesA = await request(app).get('/api/fee-types').set('Cookie', cookieA);
        schoolFeesTypeId = feeTypesA.body.data.find((t) => t.name === 'School Fees').id;
    });

    afterAll(async () => {
        await db.query('DELETE FROM fee_types WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM audit_logs WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM users WHERE email LIKE ?', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM sms_templates WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM schools WHERE code LIKE ?', [`%${MARKER.toLowerCase()}%`]);
        await db.end();
    });

    test('every auto-seeded default fee type defaults to termly frequency', async () => {
        const res = await request(app).get('/api/fee-types').set('Cookie', cookieA);
        expect(res.body.data.every((t) => t.frequency === 'termly')).toBe(true);
    });

    test('a fee type can be created with a specific frequency', async () => {
        const res = await request(app).post('/api/fee-types').set('Cookie', cookieA)
            .send({ name: 'Graduation Fees Test', frequency: 'one_time' });
        expect(res.status).toBe(201);

        const list = await request(app).get('/api/fee-types').set('Cookie', cookieA);
        const created = list.body.data.find((t) => t.id === res.body.data.id);
        expect(created.frequency).toBe('one_time');
    });

    test('an invalid frequency value is rejected at creation', async () => {
        const res = await request(app).post('/api/fee-types').set('Cookie', cookieA)
            .send({ name: 'Bad Frequency Type', frequency: 'daily' });
        expect(res.status).toBe(400);
    });

    // Added after real usage surfaced a real gap: feeding fees are
    // commonly billed weekly, and the original 4 options had no way to
    // express that.
    test('weekly is a valid frequency', async () => {
        const res = await request(app).post('/api/fee-types').set('Cookie', cookieA)
            .send({ name: 'Weekly Feeding Test', frequency: 'weekly' });
        expect(res.status).toBe(201);

        const list = await request(app).get('/api/fee-types').set('Cookie', cookieA);
        expect(list.body.data.find((t) => t.id === res.body.data.id).frequency).toBe('weekly');
    });

    test('frequency can be updated after creation', async () => {
        const res = await request(app).patch(`/api/fee-types/${schoolFeesTypeId}/frequency`).set('Cookie', cookieA)
            .send({ frequency: 'annual' });
        expect(res.status).toBe(200);

        const list = await request(app).get('/api/fee-types').set('Cookie', cookieA);
        expect(list.body.data.find((t) => t.id === schoolFeesTypeId).frequency).toBe('annual');
    });

    test('an invalid frequency value is rejected on update', async () => {
        const res = await request(app).patch(`/api/fee-types/${schoolFeesTypeId}/frequency`).set('Cookie', cookieA)
            .send({ frequency: 'monthly' });
        expect(res.status).toBe(400);
    });

    test("school B cannot update school A's fee type frequency", async () => {
        const res = await request(app).patch(`/api/fee-types/${schoolFeesTypeId}/frequency`).set('Cookie', cookieB)
            .send({ frequency: 'as_needed' });
        expect(res.status).toBe(404);
    });

    test('changing frequency never touches applicability or status (independent fields)', async () => {
        const before = (await request(app).get('/api/fee-types').set('Cookie', cookieA)).body.data.find((t) => t.id === schoolFeesTypeId);
        await request(app).patch(`/api/fee-types/${schoolFeesTypeId}/frequency`).set('Cookie', cookieA).send({ frequency: 'as_needed' });
        const after = (await request(app).get('/api/fee-types').set('Cookie', cookieA)).body.data.find((t) => t.id === schoolFeesTypeId);
        expect(after.applicability).toBe(before.applicability);
        expect(after.status).toBe(before.status);
        expect(after.frequency).toBe('as_needed');
    });

    // Real usage surfaced this directly: Phase 1's migration backfill
    // created confusing legacy fee types ("Term 1 Fees", "Term 1") from
    // pre-existing structure names, with no way to fix the naming
    // afterward.
    describe('renaming a fee type', () => {
        let renameTypeId;

        beforeAll(async () => {
            const res = await request(app).post('/api/fee-types').set('Cookie', cookieA).send({ name: 'Term 1 Fees (legacy)' });
            renameTypeId = res.body.data.id;
        });

        test('a fee type can be renamed, and the new name shows up immediately', async () => {
            const res = await request(app).patch(`/api/fee-types/${renameTypeId}/name`).set('Cookie', cookieA).send({ name: 'School Fees (Legacy Term 1)' });
            expect(res.status).toBe(200);

            const list = await request(app).get('/api/fee-types').set('Cookie', cookieA);
            expect(list.body.data.find((t) => t.id === renameTypeId).name).toBe('School Fees (Legacy Term 1)');
        });

        test('renaming to an empty name is rejected', async () => {
            const res = await request(app).patch(`/api/fee-types/${renameTypeId}/name`).set('Cookie', cookieA).send({ name: '   ' });
            expect(res.status).toBe(400);
        });

        test('renaming to a name that collides with another active fee type in the same school is rejected', async () => {
            const res = await request(app).patch(`/api/fee-types/${renameTypeId}/name`).set('Cookie', cookieA).send({ name: 'School Fees' });
            expect(res.status).toBe(409);
        });

        test("school B cannot rename school A's fee type", async () => {
            const res = await request(app).patch(`/api/fee-types/${renameTypeId}/name`).set('Cookie', cookieB).send({ name: 'Hijacked' });
            expect(res.status).toBe(404);
        });

        test("renaming a fee type never changes the name already snapshotted onto an existing fee structure", async () => {
            const yearRes = await request(app).post('/api/academic-years').set('Cookie', cookieA)
                .send({ name: '2026/2027', startDate: '2026-09-01', endDate: '2027-07-31' });
            const yearId = yearRes.body.data.id;
            const termRes = await request(app).post('/api/terms').set('Cookie', cookieA)
                .send({ academicYearId: yearId, name: 'Term 1', startDate: '2026-09-01', endDate: '2026-12-12' });
            const classRes = await request(app).post('/api/classes').set('Cookie', cookieA).send({ name: 'Rename Snapshot Test Class' });

            const fsRes = await request(app).post('/api/fee-structures').set('Cookie', cookieA).send({
                academicYearId: yearId, termId: termRes.body.data.id, classId: classRes.body.data.id,
                feeTypeId: renameTypeId, items: [{ name: 'Tuition', amount: 100 }],
            });
            expect(fsRes.body.data).toBeDefined();

            const beforeDetail = await request(app).get(`/api/fee-structures/${fsRes.body.data.id}`).set('Cookie', cookieA);
            expect(beforeDetail.body.data.name).toBe('School Fees (Legacy Term 1)');

            await request(app).patch(`/api/fee-types/${renameTypeId}/name`).set('Cookie', cookieA).send({ name: 'Renamed Again' });

            const afterDetail = await request(app).get(`/api/fee-structures/${fsRes.body.data.id}`).set('Cookie', cookieA);
            expect(afterDetail.body.data.name).toBe('School Fees (Legacy Term 1)'); // unchanged snapshot
            expect(afterDetail.body.data.fee_type_name).toBe('Renamed Again'); // live join reflects the rename

            await db.query('DELETE FROM fee_structure_items WHERE fee_structure_id = ?', [fsRes.body.data.id]);
            await db.query('DELETE FROM fee_structures WHERE id = ?', [fsRes.body.data.id]);
            await db.query('DELETE FROM classes WHERE id = ?', [classRes.body.data.id]);
            await db.query('DELETE FROM terms WHERE id = ?', [termRes.body.data.id]);
            await db.query('DELETE FROM academic_years WHERE id = ?', [yearId]);
        });
    });

    // Real usage surfaced this too: "how can a fee type be removed if
    // it was for a one-time event."
    describe('deleting a fee type', () => {
        test('an unused fee type can be deleted outright', async () => {
            const created = await request(app).post('/api/fee-types').set('Cookie', cookieA).send({ name: 'Never Used Type' });
            const res = await request(app).delete(`/api/fee-types/${created.body.data.id}`).set('Cookie', cookieA);
            expect(res.status).toBe(200);

            const list = await request(app).get('/api/fee-types?status=all').set('Cookie', cookieA);
            expect(list.body.data.find((t) => t.id === created.body.data.id)).toBeUndefined();
        });

        test('deleting a fee type with real fee structures already created from it is rejected (409), not silently ignored', async () => {
            const typeRes = await request(app).post('/api/fee-types').set('Cookie', cookieA).send({ name: 'In-Use Delete Test Type' });
            const inUseTypeId = typeRes.body.data.id;

            const yearRes = await request(app).post('/api/academic-years').set('Cookie', cookieA)
                .send({ name: '2027/2028', startDate: '2027-09-01', endDate: '2028-07-31' });
            const termRes = await request(app).post('/api/terms').set('Cookie', cookieA)
                .send({ academicYearId: yearRes.body.data.id, name: 'Term 1', startDate: '2027-09-01', endDate: '2027-12-12' });
            const classRes = await request(app).post('/api/classes').set('Cookie', cookieA).send({ name: 'Delete Guard Test Class' });
            const fsRes = await request(app).post('/api/fee-structures').set('Cookie', cookieA).send({
                academicYearId: yearRes.body.data.id, termId: termRes.body.data.id, classId: classRes.body.data.id,
                feeTypeId: inUseTypeId, items: [{ name: 'Fee', amount: 50 }],
            });

            const res = await request(app).delete(`/api/fee-types/${inUseTypeId}`).set('Cookie', cookieA);
            expect(res.status).toBe(409);

            // Still there afterward — the rejection actually prevented it.
            const list = await request(app).get('/api/fee-types?status=all').set('Cookie', cookieA);
            expect(list.body.data.find((t) => t.id === inUseTypeId)).toBeDefined();

            await db.query('DELETE FROM fee_structure_items WHERE fee_structure_id = ?', [fsRes.body.data.id]);
            await db.query('DELETE FROM fee_structures WHERE id = ?', [fsRes.body.data.id]);
            await db.query('DELETE FROM classes WHERE id = ?', [classRes.body.data.id]);
            await db.query('DELETE FROM terms WHERE id = ?', [termRes.body.data.id]);
            await db.query('DELETE FROM academic_years WHERE id = ?', [yearRes.body.data.id]);
            await request(app).delete(`/api/fee-types/${inUseTypeId}`).set('Cookie', cookieA); // now unused, should succeed and clean up
        });

        test('deleting an inactive (but unused) fee type still works — status and "in use" are independent checks', async () => {
            const created = await request(app).post('/api/fee-types').set('Cookie', cookieA).send({ name: 'Inactive Unused Type' });
            await request(app).patch(`/api/fee-types/${created.body.data.id}/status`).set('Cookie', cookieA).send({ status: 'inactive' });

            const res = await request(app).delete(`/api/fee-types/${created.body.data.id}`).set('Cookie', cookieA);
            expect(res.status).toBe(200);
        });

        test("school B cannot delete school A's fee type", async () => {
            const created = await request(app).post('/api/fee-types').set('Cookie', cookieA).send({ name: 'Cross Tenant Delete Test' });
            const res = await request(app).delete(`/api/fee-types/${created.body.data.id}`).set('Cookie', cookieB);
            expect(res.status).toBe(404);

            const list = await request(app).get('/api/fee-types?status=all').set('Cookie', cookieA);
            expect(list.body.data.find((t) => t.id === created.body.data.id)).toBeDefined(); // untouched

            await request(app).delete(`/api/fee-types/${created.body.data.id}`).set('Cookie', cookieA);
        });

        test('deleting an unused fee type that had eligibility rows (selected_students) cleans those up too, not left dangling', async () => {
            const created = await request(app).post('/api/fee-types').set('Cookie', cookieA)
                .send({ name: 'Eligibility Cleanup Test', applicability: 'selected_students' });
            const studentsRes = await request(app).get('/api/students').set('Cookie', cookieA);
            if (studentsRes.body.data.length > 0) {
                await request(app).put(`/api/fee-types/${created.body.data.id}/eligibility`).set('Cookie', cookieA)
                    .send({ studentIds: [studentsRes.body.data[0].id] });
            }

            const res = await request(app).delete(`/api/fee-types/${created.body.data.id}`).set('Cookie', cookieA);
            expect(res.status).toBe(200);

            const [[{ count }]] = await db.query('SELECT COUNT(*) AS count FROM student_fee_eligibility WHERE fee_type_id = ?', [created.body.data.id]);
            expect(count).toBe(0);
        });
    });
});
