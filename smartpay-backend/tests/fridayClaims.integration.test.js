const request = require('supertest');
const app = require('../server');
const db = require('../db');
const smsProvider = require('../utils/smsProvider');
const opsAlert = require('../utils/opsAlert');
const { runFridayJobForSchool, claimParent, fridayCycleKey, MAX_SEND_ATTEMPTS } = require('../utils/fridayJob');

// Friday reminders never double-text and retry what can be retried
// (2026-10-16, council fix list). Each test uses its own Friday (`now`), so
// each has its own cycle, lock and claims.
describe('Friday job: claim before send, same-day retries (real DB)', () => {
    const MARKER = `CI-CLAIMS-${Date.now()}`;
    let schoolId;
    const parents = {};
    let sendSpy;
    let fridayN = 0;
    const nextFriday = () => new Date(Date.UTC(2027, 0, 1 + 7 * (fridayN++), 9, 0, 0)); // Fridays in 2027

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
});
