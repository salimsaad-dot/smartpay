const request = require('supertest');
const app = require('../server');
const db = require('../db');
const smsProvider = require('../utils/smsProvider');
const opsAlert = require('../utils/opsAlert');
const { runFridayJobForSchool, runFridayJobForAllSchools, hasMoreWork, claimParent, fridayCycleKey, MAX_SEND_ATTEMPTS } = require('../utils/fridayJob');

// Friday reminders never double-text and retry what can be retried
// (2026-10-16, council fix list). Each test uses its own Friday (`now`), so
// each has its own cycle, lock and claims.
describe('Friday job: claim before send, same-day retries (real DB)', () => {
    const MARKER = `CI-CLAIMS-${Date.now()}`;
    let schoolId;
    let cookie;
    const parents = {};
    let sendSpy;
    let fridayN = 0;
    const nextFriday = () => new Date(Date.UTC(2027, 0, 1 + 7 * (fridayN++), 9, 0, 0)); // Fridays in 2027

    beforeAll(async () => {
        const reg = await request(app).post('/api/auth/register-school').send({
            schoolName: MARKER, code: MARKER.toLowerCase(), adminName: 'CI Admin',
            email: `${MARKER.toLowerCase()}@example.com`, password: 'TestPass123',
        });
        cookie = reg.headers['set-cookie'][0];
        schoolId = reg.body.data.schoolId;
        const year = await request(app).post('/api/academic-years').set('Cookie', cookie)
            .send({ name: '2026/2027', startDate: '2026-09-01', endDate: '2027-07-31' });
        const term = await request(app).post('/api/terms').set('Cookie', cookie)
            .send({ academicYearId: year.body.data.id, name: 'Term 2', startDate: '2027-01-01', endDate: '2027-04-01' });
        const cls = await request(app).post('/api/classes').set('Cookie', cookie).send({ name: 'Basic 3' });
        for (const [key, phone] of [['flaky', '0241000001'], ['steady', '0241000002']]) {
            const st = await request(app).post('/api/students').set('Cookie', cookie)
                .send({ admissionNo: `${MARKER}-${key}`, firstName: key, lastName: 'Test', classId: cls.body.data.id, academicYearId: year.body.data.id });
            const pa = await request(app).post('/api/parents').set('Cookie', cookie).send({ fullName: `Parent ${key}`, phone });
            await db.query('INSERT INTO parent_student (parent_id, student_id, is_primary) VALUES (?, ?, 1)', [pa.body.data.id, st.body.data.id]);
            parents[key] = { id: pa.body.data.id, phone };
        }
        const feeTypes = (await request(app).get('/api/fee-types').set('Cookie', cookie)).body.data;
        const fs = await request(app).post('/api/fee-structures').set('Cookie', cookie).send({
            academicYearId: year.body.data.id, termId: term.body.data.id, classId: cls.body.data.id,
            feeTypeId: feeTypes.find((t) => t.name === 'School Fees').id, items: [{ name: 'Tuition', amount: 300 }],
        });
        await request(app).post('/api/invoices/generate').set('Cookie', cookie).send({ feeStructureId: fs.body.data.id });
    });

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

    // Per-phone scripted answers; anything unscripted succeeds.
    function scriptSends(script = {}) {
        sendSpy = jest.spyOn(smsProvider, 'sendSms').mockImplementation(async (phone) => {
            const queue = script[phone];
            const answer = queue && queue.length ? queue.shift() : 'ok';
            if (answer === 'ok') return { success: true, providerMessageId: 'mock', error: null };
            if (answer === 'timeout') return { success: false, providerMessageId: null, error: 'timed out', outcomeUnknown: true };
            return { success: false, providerMessageId: null, error: 'provider error' };
        });
    }
    const sendsTo = (phone) => sendSpy.mock.calls.filter((c) => c[0] === phone).length;
    const claimFor = async (parentId, now) => (await db.query(
        'SELECT status, attempts, retryable FROM reminder_send_claims WHERE school_id = ? AND parent_id = ? AND cycle_key = ?',
        [schoolId, parentId, fridayCycleKey(now, 'Africa/Accra')]))[0][0];

    afterEach(() => jest.restoreAllMocks());

    test('the SMS history stores the message without the live payment-link token', async () => {
        const now = nextFriday();
        scriptSends();
        await runFridayJobForSchool(schoolId, { now });
        const sentText = sendSpy.mock.calls[0][1];
        expect(sentText).toMatch(/\/pay\/[A-Za-z0-9_-]{20,}/); // the parent gets a working link
        const [rows] = await db.query('SELECT message FROM sms_reminders WHERE school_id = ? AND cycle_key = ?', [schoolId, fridayCycleKey(now, 'Africa/Accra')]);
        expect(rows.length).toBeGreaterThan(0);
        for (const { message } of rows) {
            expect(message).not.toMatch(/\/pay\/[A-Za-z0-9_-]{20,}/);
            expect(message).toContain('/pay/[link]');
        }
    });

    // Per-school SMS allowance (2026-10-16).
    describe('SMS allowance', () => {
        afterEach(async () => {
            await db.query('UPDATE schools SET sms_monthly_limit = NULL WHERE id = ?', [schoolId]);
        });
        const usedThisMonth = async () => Number((await db.query(
            "SELECT COUNT(*) AS n FROM sms_reminders WHERE school_id = ? AND status IN ('sent','delivered') AND created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')",
            [schoolId]))[0][0].n);

        test('a Friday run stops sending when the school reaches its monthly allowance', async () => {
            const now = nextFriday();
            scriptSends();
            await db.query('UPDATE schools SET sms_monthly_limit = ? WHERE id = ?', [(await usedThisMonth()) + 1, schoolId]);
            const run = await runFridayJobForSchool(schoolId, { now });
            expect(run.success).toBe(1);
            expect(run.failure).toBe(1);
            expect(sendSpy).toHaveBeenCalledTimes(1);
            const [claims] = await db.query('SELECT last_error FROM reminder_send_claims WHERE school_id = ? AND cycle_key = ? AND status = ?',
                [schoolId, fridayCycleKey(now, 'Africa/Accra'), 'failed']);
            expect(claims[0].last_error).toMatch(/allowance/);
        });

        test('a manual reminder is refused once the allowance is used up', async () => {
            scriptSends();
            await db.query('UPDATE schools SET sms_monthly_limit = ? WHERE id = ?', [await usedThisMonth(), schoolId]);
            const res = await request(app).post('/api/reminders/send').set('Cookie', cookie).send({ parentId: parents.steady.id });
            expect(res.status).toBe(403);
            expect(res.body.code).toBe('SMS_ALLOWANCE_REACHED');
            expect(sendSpy).not.toHaveBeenCalled();
        });

        test('templates longer than about 3 SMS are refused', async () => {
            const res = await request(app).post('/api/sms-templates').set('Cookie', cookie).send({ name: 'Too long', body: 'x'.repeat(481) });
            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/480 characters/);
        });
    });

    test('five simultaneous claims for one parent: exactly one run gets to send', async () => {
        const claims = await Promise.all(Array.from({ length: 5 }, () => claimParent(schoolId, parents.steady.id, 'friday-claim-race')));
        expect(claims.filter(Boolean)).toHaveLength(1);
    });

    test('a temporary failure is retried on the next run that day; the parent already texted is not texted again', async () => {
        const now = nextFriday();
        scriptSends({ [parents.flaky.phone]: ['fail'] });
        const first = await runFridayJobForSchool(schoolId, { now });
        expect(first).toMatchObject({ success: 1, failure: 1, retryPending: 1, retryRun: false });
        expect((await db.query('SELECT status FROM scheduled_jobs WHERE id = ?', [first.jobId]))[0][0].status).toBe('failed');

        const second = await runFridayJobForSchool(schoolId, { now });
        expect(second).toMatchObject({ success: 1, failure: 0, retryPending: 0, retryRun: true });
        expect(sendsTo(parents.flaky.phone)).toBe(2);
        expect(sendsTo(parents.steady.phone)).toBe(1);
        expect((await claimFor(parents.flaky.id, now))).toMatchObject({ status: 'sent', attempts: 2 });
        expect((await db.query('SELECT status FROM scheduled_jobs WHERE id = ?', [second.jobId]))[0][0].status).toBe('completed');
    });

    test(`a send that keeps failing stops after ${MAX_SEND_ATTEMPTS} attempts`, async () => {
        const now = nextFriday();
        scriptSends({ [parents.flaky.phone]: ['fail', 'fail', 'fail', 'fail', 'fail'] });
        for (let i = 0; i < 5; i += 1) await runFridayJobForSchool(schoolId, { now });
        expect(sendsTo(parents.flaky.phone)).toBe(MAX_SEND_ATTEMPTS);
        expect(await claimFor(parents.flaky.id, now)).toMatchObject({ status: 'failed', attempts: MAX_SEND_ATTEMPTS });
    });

    test('a timeout (outcome unknown) is never resent, to avoid a double text', async () => {
        const now = nextFriday();
        scriptSends({ [parents.flaky.phone]: ['timeout'] });
        const run = await runFridayJobForSchool(schoolId, { now });
        expect(run).toMatchObject({ unknown: 1, retryPending: 0 });
        expect(await claimFor(parents.flaky.id, now)).toMatchObject({ status: 'unknown', retryable: 0 });
        expect(await runFridayJobForSchool(schoolId, { now })).toBeNull(); // job completed: nothing to retry
        expect(sendsTo(parents.flaky.phone)).toBe(1);
    });

    test('if recording fails after a successful send, the parent is still not texted again', async () => {
        const now = nextFriday();
        scriptSends();
        const realQuery = db.query.bind(db);
        let broke = false;
        jest.spyOn(db, 'query').mockImplementation((sql, ...args) => {
            if (!broke && typeof sql === 'string' && sql.includes('INSERT INTO sms_reminders') && sql.includes('provider_message_id')) {
                broke = true;
                return Promise.reject(new Error('database hiccup'));
            }
            return realQuery(sql, ...args);
        });
        jest.spyOn(console, 'error').mockImplementation(() => {});
        await runFridayJobForSchool(schoolId, { now });
        const firstParentSent = sendSpy.mock.calls[0][0];
        const firstParentId = Object.values(parents).find((p) => p.phone === firstParentSent).id;
        expect((await claimFor(firstParentId, now)).status).toBe('sent');

        // Even if the job is forced to run again, that parent is skipped.
        await realQuery("UPDATE scheduled_jobs SET status = 'failed' WHERE school_id = ? AND cycle_key = ?", [schoolId, fridayCycleKey(now, 'Africa/Accra')]);
        await runFridayJobForSchool(schoolId, { now });
        expect(sendsTo(firstParentSent)).toBe(1);
    });

    test('a send left mid-flight by a crashed run is flagged to the owner, not resent', async () => {
        const now = nextFriday();
        const cycleKey = fridayCycleKey(now, 'Africa/Accra');
        await db.query(
            `INSERT INTO reminder_send_claims (school_id, parent_id, cycle_key, status, attempts, updated_at)
             VALUES (?, ?, ?, 'sending', 1, NOW() - INTERVAL 45 MINUTE)`,
            [schoolId, parents.flaky.id, cycleKey]
        );
        scriptSends();
        const alertSpy = jest.spyOn(opsAlert, 'alertOwner').mockResolvedValue({ sent: true });
        await runFridayJobForSchool(schoolId, { now });
        expect(sendsTo(parents.flaky.phone)).toBe(0);
        expect(sendsTo(parents.steady.phone)).toBe(1);
        expect((await claimFor(parents.flaky.id, now)).status).toBe('unknown');
        expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('friday-unknown'), expect.any(String), expect.any(Array));
    });

    // Time-sliced runs (2026-10-16): a call stops at its deadline, the job
    // is 'paused', and the next call carries on without re-texting anyone.
    describe('time slices', () => {
        const jobFor = async (now) => (await db.query(
            "SELECT status, processed_count, success_count FROM scheduled_jobs WHERE school_id = ? AND job_type = 'friday_reminder' AND cycle_key = ?",
            [schoolId, fridayCycleKey(now, 'Africa/Accra')]))[0][0];

        test('a run that runs out of time pauses, and the next call finishes it without a duplicate', async () => {
            const now = nextFriday();
            scriptSends();
            sendSpy.mockImplementation(async () => {
                await new Promise((r) => setTimeout(r, 150));
                return { success: true, providerMessageId: 'mock', error: null };
            });
            const first = await runFridayJobForSchool(schoolId, { now, deadline: Date.now() + 50, parentConcurrency: 1 });
            expect(first).toMatchObject({ paused: true, left: 1, success: 1 });
            expect(await jobFor(now)).toMatchObject({ status: 'paused', processed_count: 1, success_count: 1 });
            const firstPhone = sendSpy.mock.calls[0][0];

            const second = await runFridayJobForSchool(schoolId, { now, deadline: Date.now() + 10000 });
            expect(second).toMatchObject({ paused: false, left: 0, success: 1 });
            expect(sendSpy).toHaveBeenCalledTimes(2);
            expect(sendsTo(firstPhone)).toBe(1);
            expect(await jobFor(now)).toMatchObject({ status: 'completed', processed_count: 2, success_count: 2 });
            expect(await runFridayJobForSchool(schoolId, { now })).toBeNull();
        });

        test('out of time before a school starts: it is reported as not started, so the caller comes back', async () => {
            const results = await runFridayJobForAllSchools({ deadline: Date.now() - 1 });
            expect(results.every((r) => r.notStarted)).toBe(true);
            expect(hasMoreWork(results)).toBe(results.length > 0);
            expect(hasMoreWork([{ schoolId: 1, result: { paused: true } }])).toBe(true);
            expect(hasMoreWork([{ schoolId: 1, result: { paused: false } }, { schoolId: 2, result: null }])).toBe(false);
        });
    });
});
