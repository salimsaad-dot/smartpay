const request = require('supertest');
const app = require('../server');
const db = require('../db');

// The earlier tenant-isolation audit (tenantIsolationAudit.integration.test.js)
// proved 36/36 ID-substitution attempts were refused — School B can never
// reach School A's specific resource by id. A council pressure-test of
// that audit (2026-10-07) pointed out that ID-substitution tests only the
// WHERE-clause-on-primary-key path. It does NOT test the three real
// SQL-level aggregate queries this codebase has (`classController.list`'s
// COUNT, `feeStructureController.list`'s SUM/COUNT, `parentController
// .list`'s COUNT DISTINCT + SUM, all via GROUP BY) — a missing/weak scope
// there wouldn't 404, it would return 200 with a silently-contaminated
// number blended from another school's rows.
//
// This test independently verifies that class, by seeding deliberately
// large, obviously-distinguishable data in School B and confirming School
// A's own aggregate numbers reconcile EXACTLY to School A's own raw rows
// — not inflated by School B's — for every aggregate query that exists in
// this codebase today.
describe('Cross-tenant aggregate-query isolation — do dashboard/list totals ever blend in another school\'s rows?', () => {
    const MARKER = `CI-AGGAUDIT-${Date.now()}`;
    let cookieA, cookieB;
    let schoolIdA, schoolIdB;
    const a = {};

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

    async function buildSchool(cookie, suffix, { classCount, feeItems, parentChildCount, parentBalances }) {
        const year = await request(app).post('/api/academic-years').set('Cookie', cookie)
            .send({ name: '2026/2027', startDate: '2026-09-01', endDate: '2027-07-31' });
        const yearId = year.body.data.id;
        await request(app).patch(`/api/academic-years/${yearId}/set-current`).set('Cookie', cookie);

        const term = await request(app).post('/api/terms').set('Cookie', cookie)
            .send({ academicYearId: yearId, name: 'Term 1', startDate: '2026-09-01', endDate: '2026-12-12' });
        const termId = term.body.data.id;
        await request(app).patch(`/api/terms/${termId}/set-current`).set('Cookie', cookie);

        const cls = await request(app).post('/api/classes').set('Cookie', cookie).send({ name: 'Aggregate Test Class' });
        const classId = cls.body.data.id;

        const studentIds = [];
        for (let i = 0; i < classCount; i++) {
            const student = await request(app).post('/api/students').set('Cookie', cookie)
                .send({ admissionNo: `${MARKER}-${suffix}-S${i}`, firstName: `Student${i}`, lastName: 'X', classId, academicYearId: yearId });
            studentIds.push(student.body.data.id);
        }

        const feeTypesRes = await request(app).get('/api/fee-types').set('Cookie', cookie);
        const feeTypeId = feeTypesRes.body.data.find((t) => t.name === 'School Fees').id;
        const fs = await request(app).post('/api/fee-structures').set('Cookie', cookie)
            .send({ academicYearId: yearId, termId, classId, feeTypeId, items: feeItems });
        const feeStructureId = fs.body.data.id;

        await request(app).post('/api/invoices/generate').set('Cookie', cookie).send({ feeStructureId });
        const invoicesRes = await request(app).get('/api/invoices').set('Cookie', cookie);
        const invoiceByStudent = {};
        for (const inv of invoicesRes.body.data) invoiceByStudent[inv.student_id] = inv.id;

        // One parent, linked to the first `parentChildCount` students, with
        // a partial payment on each so a real outstanding balance exists
        // (not just the invoice's untouched total) — this is what
        // `parentController.list`'s SUM(... i.balance ...) actually adds up.
        const parent = await request(app).post('/api/parents').set('Cookie', cookie)
            .send({ fullName: 'Aggregate Test Parent', phone: '0241111111' });
        const parentId = parent.body.data.id;

        let expectedOutstanding = 0;
        for (let i = 0; i < parentChildCount; i++) {
            const studentId = studentIds[i];
            await request(app).post(`/api/students/${studentId}/parents`).set('Cookie', cookie)
                .send({ parentId, relationship: 'Mother' });
            const invoiceId = invoiceByStudent[studentId];
            const { paid, balanceAfter } = parentBalances[i];
            if (paid > 0) {
                await request(app).post('/api/payments').set('Cookie', cookie)
                    .send({ invoiceId, amount: paid, method: 'cash' });
            }
            expectedOutstanding += balanceAfter;
        }

        return {
            classId, feeStructureId, parentId,
            expectedStudentCount: classCount,
            expectedFeeTotal: feeItems.reduce((sum, i) => sum + i.amount, 0),
            expectedFeeItemCount: feeItems.length,
            expectedChildrenCount: parentChildCount,
            expectedOutstanding,
        };
    }

    beforeAll(async () => {
        const regA = await registerSchool('a');
        cookieA = regA.cookie;
        schoolIdA = regA.schoolId;
        const regB = await registerSchool('b');
        cookieB = regB.cookie;
        schoolIdB = regB.schoolId;

        // School A: small, specific numbers.
        Object.assign(a, await buildSchool(cookieA, 'a', {
            classCount: 3,
            feeItems: [{ name: 'Tuition', amount: 100 }, { name: 'Books', amount: 50 }],
            parentChildCount: 2,
            parentBalances: [{ paid: 100, balanceAfter: 50 }, { paid: 0, balanceAfter: 150 }],
        }));

        // School B: deliberately large, obviously-distinguishable numbers —
        // if any of School A's totals below come out inflated by these,
        // the contamination is unmistakable, not a rounding coincidence.
        await buildSchool(cookieB, 'b', {
            classCount: 10,
            feeItems: [{ name: 'Tuition', amount: 90000 }, { name: 'Books', amount: 9999 }],
            parentChildCount: 5,
            parentBalances: [
                { paid: 0, balanceAfter: 99999 }, { paid: 0, balanceAfter: 99999 }, { paid: 0, balanceAfter: 99999 },
                { paid: 0, balanceAfter: 99999 }, { paid: 0, balanceAfter: 99999 },
            ],
        });
    });

    afterAll(async () => {
        for (const schoolId of [schoolIdA, schoolIdB]) {
            await db.query('DELETE FROM payment_attempts WHERE payment_id IN (SELECT id FROM payments WHERE school_id = ?)', [schoolId]);
            await db.query('DELETE FROM payments WHERE school_id = ?', [schoolId]);
            await db.query('DELETE FROM parent_student WHERE student_id IN (SELECT id FROM students WHERE school_id = ?)', [schoolId]);
            await db.query('DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE school_id = ?)', [schoolId]);
            await db.query('DELETE FROM invoices WHERE school_id = ?', [schoolId]);
            await db.query('DELETE FROM fee_structure_items WHERE fee_structure_id IN (SELECT id FROM fee_structures WHERE school_id = ?)', [schoolId]);
            await db.query('DELETE FROM fee_structures WHERE school_id = ?', [schoolId]);
            await db.query('DELETE FROM parents WHERE school_id = ?', [schoolId]);
            await db.query('DELETE FROM students WHERE school_id = ?', [schoolId]);
            await db.query('DELETE FROM classes WHERE school_id = ?', [schoolId]);
            await db.query('DELETE FROM terms WHERE school_id = ?', [schoolId]);
            await db.query('DELETE FROM academic_years WHERE school_id = ?', [schoolId]);
        }
        await db.query('DELETE FROM fee_types WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM audit_logs WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM users WHERE email LIKE ?', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM sms_templates WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM schools WHERE code LIKE ?', [`%${MARKER.toLowerCase()}%`]);
        await db.end();
    });

    test('setup produced every id this test needs', () => {
        expect(a.classId && a.feeStructureId && a.parentId).toBeTruthy();
    });

    test('GET /classes: School A\'s student_count is exactly its own 3, not inflated by School B\'s 10', async () => {
        const res = await request(app).get('/api/classes').set('Cookie', cookieA);
        const row = res.body.data.find((c) => c.id === a.classId);
        expect(row).toBeDefined();
        expect(Number(row.student_count)).toBe(a.expectedStudentCount);
    });

    test('GET /fee-structures: School A\'s total_amount/item_count are exactly its own, not blended with School B\'s 99999-range items', async () => {
        const res = await request(app).get('/api/fee-structures').set('Cookie', cookieA);
        const row = res.body.data.find((f) => f.id === a.feeStructureId);
        expect(row).toBeDefined();
        expect(Number(row.total_amount)).toBe(a.expectedFeeTotal);
        expect(Number(row.item_count)).toBe(a.expectedFeeItemCount);
    });

    test('GET /parents: School A\'s children_count and outstanding_balance are exactly its own, not inflated by School B\'s huge unpaid balances', async () => {
        const res = await request(app).get('/api/parents').set('Cookie', cookieA);
        const row = res.body.data.find((p) => p.id === a.parentId);
        expect(row).toBeDefined();
        expect(Number(row.children_count)).toBe(a.expectedChildrenCount);
        expect(Number(row.outstanding_balance)).toBe(a.expectedOutstanding);
    });
});
