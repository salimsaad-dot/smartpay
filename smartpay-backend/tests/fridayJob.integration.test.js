const request = require('supertest');
const app = require('../server');
const db = require('../db');
// Mocked against utils/smsProvider (the SMS_PROVIDER switch), not a
// specific adapter directly — fridayJob.js itself now goes through that
// switch (added 2026-10-07), so spying on a specific adapter module
// stopped actually intercepting fridayJob's real calls the moment the
// active provider became something other than that one adapter. Caught
// live: this exact mismatch let a real, unmocked send reach the real
// Arkesel API during a routine test run.
const smsProvider = require('../utils/smsProvider');
const { fridayCycleKey } = require('../utils/fridayJob');

describe('Friday automation job — cycle locks, filtering, and cron trigger (real DB, real HTTP)', () => {
    const MARKER = `CI-FRIDAY-${Date.now()}`;
    let cookieA, cookieB;
    let schoolIdA, schoolIdB;
    let parentIdA, lowBalanceParentId, badPhoneParentId;
    let kofiStudentId;

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
        const yearIdA = yearRes.body.data.id;
        const termRes = await request(app).post('/api/terms').set('Cookie', cookieA)
            .send({ academicYearId: yearIdA, name: 'Term 1', startDate: '2026-09-01', endDate: '2026-12-12' });
        const termIdA = termRes.body.data.id;
        const classRes = await request(app).post('/api/classes').set('Cookie', cookieA).send({ name: 'Basic 1' });
        const classIdA = classRes.body.data.id;

        const kofi = await request(app).post('/api/students').set('Cookie', cookieA)
            .send({ admissionNo: `${MARKER}-S1`, firstName: 'Kofi', lastName: 'Mensah', classId: classIdA, academicYearId: yearIdA });
        kofiStudentId = kofi.body.data.id;
        const lowBalStudent = await request(app).post('/api/students').set('Cookie', cookieA)
            .send({ admissionNo: `${MARKER}-S2`, firstName: 'Ama', lastName: 'Owusu', classId: classIdA, academicYearId: yearIdA });
        const badPhoneStudent = await request(app).post('/api/students').set('Cookie', cookieA)
            .send({ admissionNo: `${MARKER}-S3`, firstName: 'Yaw', lastName: 'Boateng', classId: classIdA, academicYearId: yearIdA });

        const mensah = await request(app).post('/api/parents').set('Cookie', cookieA).send({ fullName: 'Mrs Mensah', phone: '0241234567' });
        parentIdA = mensah.body.data.id;
        const owusu = await request(app).post('/api/parents').set('Cookie', cookieA).send({ fullName: 'Mr Owusu', phone: '0241111111' });
        lowBalanceParentId = owusu.body.data.id;
        const boateng = await request(app).post('/api/parents').set('Cookie', cookieA).send({ fullName: 'Mrs Boateng', phone: 'not-a-number' });
        badPhoneParentId = boateng.body.data.id;

        await db.query('INSERT INTO parent_student (parent_id, student_id, is_primary) VALUES (?, ?, 1)', [parentIdA, kofiStudentId]);
        await db.query('INSERT INTO parent_student (parent_id, student_id, is_primary) VALUES (?, ?, 1)', [lowBalanceParentId, lowBalStudent.body.data.id]);
        await db.query('INSERT INTO parent_student (parent_id, student_id, is_primary) VALUES (?, ?, 1)', [badPhoneParentId, badPhoneStudent.body.data.id]);

        const feeTypesA = await request(app).get('/api/fee-types').set('Cookie', cookieA);
        const feeTypeIdA = feeTypesA.body.data.find((t) => t.name === 'School Fees').id;
        const fsRes = await request(app).post('/api/fee-structures').set('Cookie', cookieA).send({
            academicYearId: yearIdA, termId: termIdA, classId: classIdA, feeTypeId: feeTypeIdA,
            items: [{ name: 'Tuition', amount: 400 }, { name: 'ICT', amount: 100 }],
        });
        await request(app).post('/api/invoices/generate').set('Cookie', cookieA).send({ feeStructureId: fsRes.body.data.id });

        // Owusu's invoice gets paid down to a small remainder, used for the min-balance threshold test.
        const invoices = await request(app).get('/api/invoices').set('Cookie', cookieA);
        const lowBalInvoice = invoices.body.data.find((i) => i.student_id === lowBalStudent.body.data.id);
        await request(app).post('/api/payments').set('Cookie', cookieA).send({ invoiceId: lowBalInvoice.id, amount: 480, method: 'cash' });
    });

    afterAll(async () => {
        await db.query('DELETE FROM scheduled_jobs WHERE school_id IN (?, ?)', [schoolIdA, schoolIdB]);
        await db.query('DELETE FROM sms_reminders WHERE school_id IN (?, ?)', [schoolIdA, schoolIdB]);
        await db.query('DELETE FROM audit_logs WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM sms_templates WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM payment_links WHERE school_id IN (?, ?)', [schoolIdA, schoolIdB]);
        await db.query('DELETE FROM payments WHERE school_id = ?', [schoolIdA]);
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

    let sendSpy;
    beforeEach(() => {
        // A real Friday-job send is a billable, irreversible side effect —
        // mocked here for the same reason Phase 7's manual-send test never
        // fires a real SMS routinely. The mock's behavior itself IS proven
        // correct by Phase 5/7's own live-verified real-network tests
        // elsewhere; this suite is about the job's own logic (locking,
        // filtering, counting), not re-proving the SMS client works.
        sendSpy = jest.spyOn(smsProvider, 'sendSms').mockResolvedValue({ success: true, providerMessageId: 'mock-msg-id', error: null });
    });
    afterEach(() => {
        sendSpy.mockRestore();
    });

    test('Friday reminders are enabled by default for a new school', async () => {
        const res = await request(app).get('/api/settings/friday-reminders').set('Cookie', cookieA);
        expect(res.status).toBe(200);
        expect(res.body.data.friday_reminders_enabled).toBe(1);
    });

    test('settings can be updated: disabling Friday reminders stops the job from running', async () => {
        await request(app).patch('/api/settings/friday-reminders').set('Cookie', cookieB).send({ fridayRemindersEnabled: false });

        const res = await request(app).post('/api/scheduled-jobs/friday/run').set('Cookie', cookieB);
        expect(res.status).toBe(200);
        expect(res.body.data).toBeNull();

        const jobs = await db.query('SELECT COUNT(*) AS c FROM scheduled_jobs WHERE school_id = ?', [schoolIdB]);
        expect(jobs[0][0].c).toBe(0);

        await request(app).patch('/api/settings/friday-reminders').set('Cookie', cookieB).send({ fridayRemindersEnabled: true });
    });

    test('a school with no outstanding arrears completes the cycle with nothing processed, not an error', async () => {
        const res = await request(app).post('/api/scheduled-jobs/friday/run').set('Cookie', cookieB);
        expect(res.status).toBe(200);
        expect(res.body.data.processed).toBe(0);
        expect(res.body.data.success).toBe(0);
    });

    test('running the manual Friday cycle processes eligible parents, sends via the SMS provider, and records a completed job', async () => {
        const res = await request(app).post('/api/scheduled-jobs/friday/run').set('Cookie', cookieA);
        expect(res.status).toBe(200);
        expect(res.body.data.processed).toBe(3); // Mensah, Owusu (low balance, no threshold yet), Boateng (bad phone)
        expect(res.body.data.success).toBe(2); // Mensah + Owusu succeed
        expect(res.body.data.failure).toBe(1); // Boateng's bad phone

        expect(sendSpy).toHaveBeenCalled();

        const [[job]] = await db.query('SELECT * FROM scheduled_jobs WHERE id = ?', [res.body.data.jobId]);
        expect(job.status).toBe('completed');
        expect(job.processed_count).toBe(3);

        const [reminders] = await db.query('SELECT * FROM sms_reminders WHERE school_id = ? AND cycle_key = ?', [schoolIdA, res.body.data.cycleKey]);
        expect(reminders).toHaveLength(3);

        const badPhoneReminder = reminders.find((r) => r.parent_id === badPhoneParentId);
        expect(badPhoneReminder.status).toBe('failed');
        expect(badPhoneReminder.failure_reason).toMatch(/phone/i);

        const mensahReminder = reminders.find((r) => r.parent_id === parentIdA);
        expect(mensahReminder.status).toBe('sent');
        expect(mensahReminder.payment_link_id).not.toBeNull();

        // Required scenario from the fee-management requirements doc
        // (§9): "Manual reminder → Uses the same breakdown logic as
        // Friday automation." Proven directly, not just by shared code
        // path: the real Friday-sent message and a real manual preview
        // for the same parent/scope must carry the identical itemized
        // breakdown — only the payment link differs (Friday's is a real
        // generated link; preview's is the placeholder text).
        const manualPreview = await request(app).post('/api/reminders/preview').set('Cookie', cookieA)
            .send({ parentId: parentIdA });
        const breakdownFromFriday = mensahReminder.message.split('. Total:')[0];
        const breakdownFromManual = manualPreview.body.data.message.split('. Total:')[0];
        expect(breakdownFromFriday).toBe(breakdownFromManual);
    });

    test('running the same cycle again is idempotent — already-completed cycle does nothing, no duplicate reminders', async () => {
        sendSpy.mockClear();
        const res = await request(app).post('/api/scheduled-jobs/friday/run').set('Cookie', cookieA);
        expect(res.status).toBe(200);
        expect(res.body.data).toBeNull();
        expect(sendSpy).not.toHaveBeenCalled();

        const [reminders] = await db.query('SELECT COUNT(*) AS c FROM sms_reminders WHERE school_id = ?', [schoolIdA]);
        expect(reminders[0].c).toBe(3); // unchanged from the previous run
    });

    test('a cooldown period correctly skips a parent reminded within it on a later (simulated) cycle', async () => {
        await request(app).patch('/api/settings/friday-reminders').set('Cookie', cookieA).send({ reminderCooldownDays: 7 });

        // Simulate "next Friday" 3 days later — a real new cycle, but
        // still within the 7-day cooldown from Mensah's reminder today.
        const nextFriday = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        const { runFridayJobForSchool } = require('../utils/fridayJob');
        const result = await runFridayJobForSchool(schoolIdA, { now: nextFriday });

        expect(result).not.toBeNull();
        const mensahReminders = await db.query(
            'SELECT COUNT(*) AS c FROM sms_reminders WHERE school_id = ? AND parent_id = ? AND cycle_key = ?',
            [schoolIdA, parentIdA, fridayCycleKey(nextFriday, 'Africa/Accra')]
        );
        expect(mensahReminders[0][0].c).toBe(0); // skipped — still in cooldown

        await request(app).patch('/api/settings/friday-reminders').set('Cookie', cookieA).send({ reminderCooldownDays: '' });
    });

    test('a minimum balance threshold excludes parents below it', async () => {
        await request(app).patch('/api/settings/friday-reminders').set('Cookie', cookieA).send({ reminderMinBalance: 100 });

        const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const { runFridayJobForSchool } = require('../utils/fridayJob');
        const result = await runFridayJobForSchool(schoolIdA, { now: farFuture });

        // Owusu's remaining balance is 500 - 480 = 20, below the 100 threshold — excluded entirely.
        const reminders = await db.query(
            'SELECT parent_id FROM sms_reminders WHERE school_id = ? AND cycle_key = ?',
            [schoolIdA, fridayCycleKey(farFuture, 'Africa/Accra')]
        );
        const remindedParents = reminders[0].map((r) => r.parent_id);
        expect(remindedParents).not.toContain(lowBalanceParentId);
        expect(result.processed).toBeLessThan(3);

        await request(app).patch('/api/settings/friday-reminders').set('Cookie', cookieA).send({ reminderMinBalance: '' });
    });

    test("school B's admin cannot see school A's job history", async () => {
        const res = await request(app).get('/api/scheduled-jobs').set('Cookie', cookieB);
        expect(res.status).toBe(200);
        expect(res.body.data.every((j) => j.school_id !== schoolIdA)).toBe(true);
    });

    describe('respectSendTime (the automated all-schools path only)', () => {
        const { runFridayJobForSchool, fridayCycleKey } = require('../utils/fridayJob');
        const farFuture = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // a fresh, never-used cycle

        test('a school whose configured send time has not arrived yet is skipped when respectSendTime is set', async () => {
            await request(app).patch('/api/settings/friday-reminders').set('Cookie', cookieA).send({ fridaySendTime: '23:59:59' });

            const result = await runFridayJobForSchool(schoolIdA, { now: farFuture, respectSendTime: true });
            expect(result).toBeNull();

            const jobs = await db.query(
                'SELECT COUNT(*) AS c FROM scheduled_jobs WHERE school_id = ? AND cycle_key = ?',
                [schoolIdA, fridayCycleKey(farFuture, 'Africa/Accra')]
            );
            expect(jobs[0][0].c).toBe(0); // no lock even attempted — nothing to show for a cycle that never ran

            await request(app).patch('/api/settings/friday-reminders').set('Cookie', cookieA).send({ fridaySendTime: '08:00:00' });
        });

        test('the same school proceeds once its configured send time has passed', async () => {
            await request(app).patch('/api/settings/friday-reminders').set('Cookie', cookieA).send({ fridaySendTime: '00:00:01' });

            const result = await runFridayJobForSchool(schoolIdA, { now: farFuture, respectSendTime: true });
            expect(result).not.toBeNull();

            await request(app).patch('/api/settings/friday-reminders').set('Cookie', cookieA).send({ fridaySendTime: '08:00:00' });
        });

        test('omitting respectSendTime (the manual-run path) ignores friday_send_time entirely — never gated by it', async () => {
            const freshCycle = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // never touched by any earlier test
            await request(app).patch('/api/settings/friday-reminders').set('Cookie', cookieA).send({ fridaySendTime: '23:59:59' });

            // No respectSendTime passed at all — same call shape the manual-run
            // controller uses. If the time gate were mistakenly applied by
            // default, this would return null purely because of the clock,
            // even though Mensah still has a real outstanding balance.
            const result = await runFridayJobForSchool(schoolIdA, { now: freshCycle });
            expect(result).not.toBeNull();
            expect(result.processed).toBeGreaterThan(0);

            await request(app).patch('/api/settings/friday-reminders').set('Cookie', cookieA).send({ fridaySendTime: '08:00:00' });
        });
    });

    describe('cron trigger (external scheduler endpoint)', () => {
        test('the cron endpoint rejects a request with no secret header', async () => {
            const res = await request(app).post('/api/cron/friday-reminders');
            expect(res.status).toBe(401);
        });

        test('the cron endpoint rejects a wrong secret', async () => {
            const res = await request(app).post('/api/cron/friday-reminders').set('x-cron-secret', 'totally-wrong');
            expect(res.status).toBe(401);
        });

        test('the cron endpoint runs every active school with the correct secret, with no admin session needed', async () => {
            const res = await request(app).post('/api/cron/friday-reminders').set('x-cron-secret', process.env.CRON_SECRET);
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data)).toBe(true);
            const schoolAResult = res.body.data.find((r) => r.schoolId === schoolIdA);
            expect(schoolAResult).toBeDefined();
        });
    });
});
