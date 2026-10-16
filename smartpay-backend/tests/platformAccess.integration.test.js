const request = require('supertest');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const totp = require('../utils/totp');
const app = require('../server');
const db = require('../db');
const { SCHOOL_IS_OPEN_SQL } = require('../utils/schoolAccess');

// Owner control over which schools can use SmartPay (2026-10-15): no
// public sign-up, schools created in the owner console, and a school is
// blocked when suspended or when its paid-until date has passed, at login,
// on every request, on payment links and in the Friday job.
describe('platform owner console and school access (real DB, real HTTP)', () => {
    const MARKER = `ci-plat-${Date.now()}`;
    const ownerEmail = `${MARKER}-owner@example.com`;
    const ownerPassword = 'OwnerPass12345';
    const ownerSecret = totp.generateSecret();
    let ownerId;
    const adminEmail = `${MARKER}-admin@example.com`;
    let ownerCookie;
    let schoolId;
    let tempPassword;
    let schoolCookie;

    const cookieFrom = (res) => res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
    const schoolLogin = (password = tempPassword) => request(app).post('/api/auth/login').send({ email: adminEmail, password });
    const setSchool = (body) => request(app).patch(`/api/platform/schools/${schoolId}`).set('Cookie', ownerCookie).send(body);
    const isoDate = (offsetDays) => {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() + offsetDays);
        return d.toISOString().slice(0, 10);
    };

    beforeAll(async () => {
        const hash = await bcrypt.hash(ownerPassword, 10);
        const [inserted] = await db.query('INSERT INTO platform_admins (name, email, password_hash, totp_secret) VALUES (?, ?, ?, ?)', ['CI Owner', ownerEmail, hash, ownerSecret]);
        ownerId = inserted.insertId;
    });

    afterAll(async () => {
        const schoolIds = `SELECT id FROM schools WHERE code LIKE '${MARKER}%'`;
        await db.query(`DELETE FROM payment_links WHERE school_id IN (${schoolIds})`);
        await db.query(`DELETE FROM parents WHERE school_id IN (${schoolIds})`);
        await db.query(`DELETE FROM audit_logs WHERE school_id IN (${schoolIds})`);
        await db.query(`DELETE FROM fee_types WHERE school_id IN (${schoolIds})`);
        await db.query(`DELETE FROM sms_templates WHERE school_id IN (${schoolIds})`);
        await db.query(`DELETE FROM users WHERE school_id IN (${schoolIds})`);
        await db.query(`DELETE FROM schools WHERE code LIKE '${MARKER}%'`);
        await db.query("DELETE FROM login_attempts WHERE scope IN ('platform', 'platform_mfa') AND account_id = ?", [ownerId]);
        await db.query('DELETE FROM platform_admins WHERE email = ?', [ownerEmail]);
        await db.end();
    });

    test('public sign-up does not exist outside tests', () => {
        jest.isolateModules(() => {
            const previous = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            try {
                const authRoutes = require('../routes/authRoutes');
                const paths = authRoutes.stack.map((layer) => layer.route?.path);
                expect(paths).toContain('/login');
                expect(paths).not.toContain('/register-school');
            } finally {
                process.env.NODE_ENV = previous;
            }
        });
    });

    test('the console requires an owner login; a wrong password is refused', async () => {
        expect((await request(app).get('/api/platform/schools')).status).toBe(401);
        const bad = await request(app).post('/api/platform/auth/login').send({ email: ownerEmail, password: 'wrong-password' });
        expect(bad.status).toBe(401);
        const res = await request(app).post('/api/platform/auth/login').send({ email: ownerEmail, password: ownerPassword });
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ mfaRequired: true });
        // The right password alone opens nothing.
        const pendingCookie = cookieFrom(res);
        expect(pendingCookie).not.toContain('platform_token=');
        expect((await request(app).get('/api/platform/schools').set('Cookie', pendingCookie)).status).toBe(401);

        const step = totp.currentStep();
        const verified = await request(app).post('/api/platform/auth/verify-code').set('Cookie', pendingCookie)
            .send({ code: totp.codeForStep(ownerSecret, step) });
        expect(verified.status).toBe(200);
        ownerCookie = cookieFrom(verified);
        expect(ownerCookie).toContain('platform_token=');
        expect((await request(app).get('/api/platform/schools').set('Cookie', ownerCookie)).status).toBe(200);
    });

    describe('second login step', () => {
        const passwordStep = async () => cookieFrom(await request(app).post('/api/platform/auth/login').send({ email: ownerEmail, password: ownerPassword }));
        const sendCode = (cookie, code) => request(app).post('/api/platform/auth/verify-code').set('Cookie', cookie).send({ code });

        afterEach(async () => {
            await db.query("DELETE FROM login_attempts WHERE scope = 'platform_mfa' AND account_id = ?", [ownerId]);
        });

        test('a code can only be used once, and a wrong code is refused', async () => {
            const [[{ totp_last_step: last }]] = await db.query('SELECT totp_last_step FROM platform_admins WHERE id = ?', [ownerId]);
            const usedCode = totp.codeForStep(ownerSecret, Number(last));
            const cookie = await passwordStep();
            expect((await sendCode(cookie, usedCode)).status).toBe(401);
            const wrong = usedCode === '000000' ? '111111' : '000000';
            expect((await sendCode(cookie, wrong)).status).toBe(401);
            // The next code still works on the same pending step.
            const next = await sendCode(cookie, totp.codeForStep(ownerSecret, Number(last) + 1));
            expect(next.status).toBe(200);
        });

        test('no password step, no code check', async () => {
            const res = await request(app).post('/api/platform/auth/verify-code').send({ code: totp.codeForStep(ownerSecret, totp.currentStep()) });
            expect(res.status).toBe(401);
            expect(res.body.code).toBe('MFA_STEP_EXPIRED');
            // A forged pending token without the secret is refused too.
            const forged = `platform_mfa=${jwt.sign({ kind: 'platform_mfa', platformAdminId: ownerId, tokenVersion: 0 }, 'wrong-secret')}`;
            expect((await sendCode(forged, '123456')).status).toBe(401);
        });

        test('a pending token cannot be used as a console session, nor an old token without the second step', async () => {
            const [[{ token_version: tokenVersion }]] = await db.query('SELECT token_version FROM platform_admins WHERE id = ?', [ownerId]);
            const pending = jwt.sign({ kind: 'platform_mfa', platformAdminId: ownerId, tokenVersion }, process.env.JWT_SECRET);
            expect((await request(app).get('/api/platform/schools').set('Cookie', `platform_token=${pending}`)).status).toBe(401);
            const old = jwt.sign({ kind: 'platform', platformAdminId: ownerId, tokenVersion }, process.env.JWT_SECRET);
            expect((await request(app).get('/api/platform/schools').set('Cookie', `platform_token=${old}`)).status).toBe(401);
        });

        test('five wrong codes lock this device out of the code step', async () => {
            const cookie = await passwordStep();
            for (let i = 0; i < 5; i += 1) expect((await sendCode(cookie, '000000')).status).toBe(401);
            const right = totp.codeForStep(ownerSecret, totp.currentStep() + 1);
            expect((await sendCode(cookie, right)).status).toBe(423);
        });

        test('changing the password needs the current password and a fresh code, and signs out other sessions', async () => {
            const change = (body, cookie = ownerCookie) => request(app).post('/api/platform/auth/change-password').set('Cookie', cookie).send(body);
            const lastStep = async () => Number((await db.query('SELECT totp_last_step FROM platform_admins WHERE id = ?', [ownerId]))[0][0].totp_last_step);
            const freshCode = async () => totp.codeForStep(ownerSecret, Math.max(await lastStep() + 1, totp.currentStep() - 1));
            const newPassword = 'BrandNewOwnerPass99';
            // Earlier tests may have used the code one step ahead of the clock.
            await db.query('UPDATE platform_admins SET totp_last_step = ? WHERE id = ?', [totp.currentStep() - 2, ownerId]);

            expect((await change({ currentPassword: ownerPassword, newPassword }, '')).status).toBe(401);
            expect((await change({ currentPassword: ownerPassword, newPassword: 'short', code: await freshCode() })).status).toBe(400);
            expect((await change({ currentPassword: 'wrong-password', newPassword, code: await freshCode() })).status).toBe(401);
            const usedCode = totp.codeForStep(ownerSecret, await lastStep());
            expect((await change({ currentPassword: ownerPassword, newPassword, code: usedCode })).status).toBe(401);
            const [[before]] = await db.query('SELECT password_hash FROM platform_admins WHERE id = ?', [ownerId]);
            expect(await bcrypt.compare(ownerPassword, before.password_hash)).toBe(true); // nothing changed yet

            const oldCookie = ownerCookie;
            const ok = await change({ currentPassword: ownerPassword, newPassword, code: await freshCode() });
            expect(ok.status).toBe(200);
            const newCookie = cookieFrom(ok);
            expect((await request(app).get('/api/platform/schools').set('Cookie', newCookie)).status).toBe(200);
            expect((await request(app).get('/api/platform/schools').set('Cookie', oldCookie)).status).toBe(401);
            expect((await request(app).post('/api/platform/auth/login').send({ email: ownerEmail, password: ownerPassword })).status).toBe(401);
            expect((await request(app).post('/api/platform/auth/login').send({ email: ownerEmail, password: newPassword })).status).toBe(200);

            // Put things back for the tests after this one.
            await db.query('UPDATE platform_admins SET password_hash = ? WHERE id = ?', [await bcrypt.hash(ownerPassword, 10), ownerId]);
            await db.query("DELETE FROM login_attempts WHERE scope = 'platform' AND account_id = ?", [ownerId]);
            ownerCookie = newCookie;
        });

        test('an owner without the authenticator set up cannot log in', async () => {
            await db.query('UPDATE platform_admins SET totp_secret = NULL WHERE id = ?', [ownerId]);
            try {
                const res = await request(app).post('/api/platform/auth/login').send({ email: ownerEmail, password: ownerPassword });
                expect(res.status).toBe(403);
                expect(res.body.code).toBe('MFA_SETUP_REQUIRED');
                expect(res.headers['set-cookie'] || []).toHaveLength(0);
            } finally {
                await db.query('UPDATE platform_admins SET totp_secret = ? WHERE id = ?', [ownerSecret, ownerId]);
            }
        });
    });

    test('the owner creates a school, and its admin can log in with the one-time password', async () => {
        const res = await request(app).post('/api/platform/schools').set('Cookie', ownerCookie)
            .send({ schoolName: `${MARKER} Academy`, code: `${MARKER}-academy`, adminName: 'CI Head', email: adminEmail });
        expect(res.status).toBe(201);
        schoolId = res.body.data.schoolId;
        tempPassword = res.body.data.tempPassword;
        expect(tempPassword).toMatch(/^[A-Za-z2-9]{12}$/);

        const login = await schoolLogin();
        expect(login.status).toBe(200);
        expect(login.body.data.school.billing).toMatchObject({ paidUntil: null, daysLeft: null, renewalDue: false });
        expect(login.body.data.mustChangePassword).toBe(true);
        schoolCookie = cookieFrom(login);
    });

    test('a one-time password allows nothing but setting a password of your own', async () => {
        const blocked = await request(app).get('/api/students').set('Cookie', schoolCookie);
        expect(blocked.status).toBe(403);
        expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
        expect((await request(app).get('/api/auth/me').set('Cookie', schoolCookie)).status).toBe(200);

        const changed = await request(app).post('/api/auth/change-password').set('Cookie', schoolCookie)
            .send({ currentPassword: tempPassword, newPassword: 'MyOwnPass123' });
        expect(changed.status).toBe(200);
        schoolCookie = cookieFrom(changed);
        tempPassword = 'MyOwnPass123';
        const me = await request(app).get('/api/auth/me').set('Cookie', schoolCookie);
        expect(me.body.data.mustChangePassword).toBe(false);
        expect((await request(app).get('/api/students').set('Cookie', schoolCookie)).status).toBe(200);
    });

    test('a school login cannot use the console, and a console login cannot act as a school', async () => {
        expect((await request(app).get('/api/platform/schools').set('Cookie', schoolCookie)).status).toBe(401);
        const ownerTokenOnly = ownerCookie.replace('platform_token=', 'token=');
        expect((await request(app).get('/api/auth/me').set('Cookie', ownerTokenOnly)).status).toBe(403);
    });

    test('the school list shows the new school with its admin and usage', async () => {
        const res = await request(app).get('/api/platform/schools').set('Cookie', ownerCookie);
        expect(res.status).toBe(200);
        const row = res.body.data.find((s) => s.id === schoolId);
        expect(row).toMatchObject({ adminEmail, state: 'active', studentCount: 0, smsThisMonth: 0, paidUntil: null });
    });

    test('suspending blocks login and live sessions immediately; reactivating restores both', async () => {
        expect((await setSchool({ status: 'suspended' })).status).toBe(200);

        const login = await schoolLogin();
        expect(login.status).toBe(403);
        expect(login.body).toMatchObject({ code: 'SCHOOL_BLOCKED', reason: 'suspended' });
        const live = await request(app).get('/api/auth/me').set('Cookie', schoolCookie);
        expect(live.status).toBe(403);
        expect(live.body.code).toBe('SCHOOL_BLOCKED');

        expect((await setSchool({ status: 'active' })).status).toBe(200);
        expect((await request(app).get('/api/auth/me').set('Cookie', schoolCookie)).status).toBe(200);
    });

    test('a lapsed paid-until date blocks the school; today still works; a near date warns', async () => {
        await setSchool({ paidUntil: isoDate(-1) });
        const expired = await schoolLogin();
        expect(expired.status).toBe(403);
        expect(expired.body.reason).toBe('expired');

        await setSchool({ paidUntil: isoDate(0) });
        expect((await request(app).get('/api/auth/me').set('Cookie', schoolCookie)).status).toBe(200);

        await setSchool({ paidUntil: isoDate(3) });
        const me = await request(app).get('/api/auth/me').set('Cookie', schoolCookie);
        expect(me.body.data.school.billing).toMatchObject({ paidUntil: isoDate(3), daysLeft: 3, renewalDue: true });

        await setSchool({ paidUntil: null });
        const open = await request(app).get('/api/auth/me').set('Cookie', schoolCookie);
        expect(open.body.data.school.billing.paidUntil).toBeNull();
    });

    test("a blocked school's payment links stop working, and it drops out of the Friday job", async () => {
        const parent = await request(app).post('/api/parents').set('Cookie', schoolCookie).send({ fullName: 'CI Parent', phone: '0241234567' });
        const link = await request(app).post(`/api/parents/${parent.body.data.id}/payment-link`).set('Cookie', schoolCookie);
        const token = link.body.data.url.split('/pay/')[1];
        const fridaySchool = () => db.query(`SELECT s.id FROM schools s WHERE s.id = ? AND ${SCHOOL_IS_OPEN_SQL}`, [schoolId]).then(([rows]) => rows.length);

        expect((await request(app).get(`/api/public/checkout/${token}`)).status).toBe(200);
        expect(await fridaySchool()).toBe(1);

        await setSchool({ status: 'suspended' });
        const blocked = await request(app).get(`/api/public/checkout/${token}`);
        expect(blocked.status).toBe(410);
        expect(blocked.body.message).toMatch(/unavailable/);
        expect(await fridaySchool()).toBe(0);

        await setSchool({ status: 'active' });
    });

    test('resetting the admin password signs out old sessions and issues a working new one', async () => {
        const res = await request(app).post(`/api/platform/schools/${schoolId}/reset-admin-password`).set('Cookie', ownerCookie);
        expect(res.status).toBe(200);
        expect((await request(app).get('/api/auth/me').set('Cookie', schoolCookie)).status).toBe(401);
        expect((await schoolLogin(tempPassword)).status).toBe(401);
        expect((await schoolLogin(res.body.data.tempPassword)).status).toBe(200);
        tempPassword = res.body.data.tempPassword;
    });

    test('a one-time password stops working after 72 hours', async () => {
        await db.query("UPDATE users SET temp_password_expires_at = NOW() - INTERVAL 1 HOUR WHERE email = ?", [adminEmail]);
        const [[row]] = await db.query('SELECT must_change_password FROM users WHERE email = ?', [adminEmail]);
        expect(row.must_change_password).toBe(1); // set again by the reset above
        const res = await schoolLogin();
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('TEMP_PASSWORD_EXPIRED');
    });

    test("owner actions are recorded in the school's audit log", async () => {
        const [rows] = await db.query("SELECT action FROM audit_logs WHERE school_id = ? AND action LIKE 'platform.%'", [schoolId]);
        const actions = rows.map((r) => r.action);
        expect(actions).toEqual(expect.arrayContaining([
            'platform.school_created', 'platform.school_suspended', 'platform.school_reactivated',
            'platform.subscription_updated', 'platform.admin_password_reset',
        ]));
    });

    test("the owner sets a school's SMS allowance, and the list shows it", async () => {
        expect((await setSchool({ smsMonthlyLimit: 500 })).status).toBe(200);
        const list = await request(app).get('/api/platform/schools').set('Cookie', ownerCookie);
        expect(list.body.data.find((s) => s.id === schoolId).smsMonthlyLimit).toBe(500);
        expect((await setSchool({ smsMonthlyLimit: null })).status).toBe(200);
    });

    test('bad updates are rejected', async () => {
        expect((await setSchool({ status: 'deleted' })).status).toBe(400);
        expect((await setSchool({ paidUntil: 'next month' })).status).toBe(400);
        expect((await setSchool({ paidUntil: '2027-02-30' })).status).toBe(400);
        expect((await setSchool({ smsMonthlyLimit: -5 })).status).toBe(400);
        expect((await setSchool({ smsMonthlyLimit: 2.5 })).status).toBe(400);
        expect((await request(app).patch('/api/platform/schools/999999999').set('Cookie', ownerCookie).send({ status: 'active' })).status).toBe(404);
    });
});
