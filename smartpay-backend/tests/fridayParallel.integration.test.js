const request = require('supertest');
const app = require('../server');
const db = require('../db');
const smsProvider = require('../utils/smsProvider');
const { runFridayJobForSchool, fridayCycleKey } = require('../utils/fridayJob');

// Parallel, time-sliced Friday sends at a realistic size (2026-10-16): 30
// parents, 4 sending at once, slices that keep running out of time. Every
// parent must get exactly one SMS, with no deadlocks and one active link.
describe('Friday job: parallel sends across time slices (real DB)', () => {
    const MARKER = `CI-PAR-${Date.now()}`;
    const PARENTS = 30;
    let schoolId;
    const phones = [];

    beforeAll(async () => {
        const reg = await request(app).post('/api/auth/register-school').send({
            schoolName: MARKER, code: MARKER.toLowerCase(), adminName: 'CI Admin',
            email: `${MARKER.toLowerCase()}@example.com`, password: 'TestPass123',
        });
        const cookie = reg.headers['set-cookie'][0];
        schoolId = reg.body.data.schoolId;
        const year = await request(app).post('/api/academic-years').set('Cookie', cookie)
            .send({ name: '2026/2027', startDate: '2026-09-01', endDate: '2027-07-31' });
        const term = await request(app).post('/api/terms').set('Cookie', cookie)
            .send({ academicYearId: year.body.data.id, name: 'Term 2', startDate: '2027-01-01', endDate: '2027-04-01' });
        const cls = await request(app).post('/api/classes').set('Cookie', cookie).send({ name: 'Basic 5' });
        for (let n = 0; n < PARENTS; n += 1) {
            const phone = `0242${String(100000 + n).slice(-6)}`;
            const st = await request(app).post('/api/students').set('Cookie', cookie)
                .send({ admissionNo: `${MARKER}-${n}`, firstName: `Kid${n}`, lastName: 'Test', classId: cls.body.data.id, academicYearId: year.body.data.id });
            const pa = await request(app).post('/api/parents').set('Cookie', cookie).send({ fullName: `Parent ${n}`, phone });
            await db.query('INSERT INTO parent_student (parent_id, student_id, is_primary) VALUES (?, ?, 1)', [pa.body.data.id, st.body.data.id]);
            phones.push(phone);
        }
        const feeTypes = (await request(app).get('/api/fee-types').set('Cookie', cookie)).body.data;
        const fs = await request(app).post('/api/fee-structures').set('Cookie', cookie).send({
            academicYearId: year.body.data.id, termId: term.body.data.id, classId: cls.body.data.id,
            feeTypeId: feeTypes.find((t) => t.name === 'School Fees').id, items: [{ name: 'Tuition', amount: 300 }],
        });
        await request(app).post('/api/invoices/generate').set('Cookie', cookie).send({ feeStructureId: fs.body.data.id });
    }, 60000);

    afterAll(async () => {
        for (const t of ['reminder_send_claims', 'scheduled_jobs', 'sms_reminders', 'payment_links']) {
            await db.query(`DELETE FROM ${t} WHERE school_id = ?`, [schoolId]);
        }
        await db.query('DELETE FROM parent_student WHERE student_id IN (SELECT id FROM students WHERE school_id = ?)', [schoolId]);
        await db.query('DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE school_id = ?)', [schoolId]);
        await db.query('DELETE FROM invoices WHERE school_id = ?', [schoolId]);
        await db.query('DELETE FROM fee_structure_items WHERE fee_structure_id IN (SELECT id FROM fee_structures WHERE school_id = ?)', [schoolId]);
        for (const t of ['fee_structures', 'fee_types', 'parents', 'students', 'classes', 'terms', 'academic_years', 'audit_logs', 'sms_templates', 'users']) {
            await db.query(`DELETE FROM ${t} WHERE school_id = ?`, [schoolId]);
        }
        await db.query('DELETE FROM schools WHERE id = ?', [schoolId]);
        await db.end();
    });

    afterEach(() => jest.restoreAllMocks());

    test('every parent gets exactly one SMS across several short slices', async () => {
        const now = new Date(Date.UTC(2027, 1, 5, 9, 0, 0)); // a Friday
        const sendSpy = jest.spyOn(smsProvider, 'sendSms').mockImplementation(async () => {
            await new Promise((r) => setTimeout(r, 40));
            return { success: true, providerMessageId: 'mock', error: null };
        });
        const errorSpy = jest.spyOn(console, 'error');

        const slices = [];
        for (let i = 0; i < 50; i += 1) {
            const result = await runFridayJobForSchool(schoolId, { now, deadline: Date.now() + 150 });
            if (!result) break;
            slices.push(result);
            if (!result.paused) break;
        }

        expect(slices.length).toBeGreaterThan(1); // it really was split up
        expect(slices.at(-1).paused).toBe(false);
        expect(slices.reduce((sum, s) => sum + s.success, 0)).toBe(PARENTS);
        expect(sendSpy).toHaveBeenCalledTimes(PARENTS);
        expect(new Set(sendSpy.mock.calls.map((c) => c[0])).size).toBe(PARENTS);
        expect(errorSpy.mock.calls.filter((c) => String(c[0]).includes('Friday job'))).toHaveLength(0); // no deadlocks

        const [[job]] = await db.query(
            "SELECT status, processed_count, success_count FROM scheduled_jobs WHERE school_id = ? AND cycle_key = ?",
            [schoolId, fridayCycleKey(now, 'Africa/Accra')]
        );
        expect(job).toMatchObject({ status: 'completed', processed_count: PARENTS, success_count: PARENTS });
        const [[{ perParent }]] = await db.query(
            "SELECT MAX(c) AS perParent FROM (SELECT COUNT(*) AS c FROM payment_links WHERE school_id = ? AND status = 'active' GROUP BY parent_id) t",
            [schoolId]
        );
        expect(Number(perParent)).toBe(1);
    }, 60000);
});
