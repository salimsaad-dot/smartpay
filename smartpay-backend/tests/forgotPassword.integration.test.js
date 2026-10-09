const request = require('supertest');
const app = require('../server');
const db = require('../db');
const emailSender = require('../utils/emailSender');

// A real, not hypothetical, gap: before this, an admin who forgot their
// password (not just a wrong guess — actually forgot it) had NO way back
// into their own school's account short of someone with direct database
// access manually resetting the password hash. Single admin per school
// makes this worse than it would be on a multi-user system.
describe('forgot password / reset via emailed token (real DB, real HTTP)', () => {
    const MARKER = `CI-FORGOT-${Date.now()}`;
    const email = `${MARKER.toLowerCase()}@example.com`;
    const password = 'OldPass123';
    let userId;

    // jest.spyOn on the real module authController.js imports — same
    // pattern already established for SMS provider tests in this
    // project (mocking a specific adapter directly, rather than the
    // module the controller actually calls through, is exactly the bug
    // class that let a real unmocked SMS send through during a test run
    // earlier in this project's history). This captures the real reset
    // link forgotPassword generates without needing a real Resend key.
    let sendSpy;
    let capturedLink;

    beforeAll(async () => {
        const res = await request(app)
            .post('/api/auth/register-school')
            .send({ schoolName: MARKER, code: MARKER.toLowerCase(), adminName: 'CI Admin', email, password });
        userId = res.body.data.userId;
    });

    beforeEach(() => {
        capturedLink = null;
        sendSpy = jest.spyOn(emailSender, 'sendPasswordResetEmail').mockImplementation((to, resetLink) => {
            capturedLink = resetLink;
            return Promise.resolve({ delivered: true });
        });
    });

    afterEach(() => {
        sendSpy.mockRestore();
    });

    afterAll(async () => {
        await db.query('DELETE FROM password_reset_tokens WHERE user_id = ?', [userId]);
        await db.query('DELETE FROM audit_logs WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM fee_types WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM sms_templates WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM users WHERE email LIKE ?', [`${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM schools WHERE code LIKE ?', [`${MARKER.toLowerCase()}%`]);
        await db.end();
    });

    function extractToken(resetLink) {
        return new URL(resetLink).searchParams.get('token');
    }

    test('a matching email creates a real reset token row and emails a link containing it', async () => {
        const res = await request(app).post('/api/auth/forgot-password').send({ email });
        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/if an account matches/i);
        expect(sendSpy).toHaveBeenCalledTimes(1);
        expect(capturedLink).toContain('/reset-password?token=');

        const [[row]] = await db.query('SELECT * FROM password_reset_tokens WHERE user_id = ?', [userId]);
        expect(row).toBeDefined();
        expect(row.used_at).toBeNull();
    });

    test('a non-matching email gets the exact same response and sends nothing (no account-enumeration signal)', async () => {
        const matching = await request(app).post('/api/auth/forgot-password').send({ email });
        const nonMatching = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody-really-here@example.com' });

        expect(nonMatching.status).toBe(matching.status);
        expect(nonMatching.body.message).toBe(matching.body.message);
        expect(nonMatching.body.emailDeliveryConfigured).toBe(matching.body.emailDeliveryConfigured);
        expect(sendSpy).toHaveBeenCalledTimes(1); // only for the matching email
    });

    test('resetting with a garbage token is rejected', async () => {
        const res = await request(app).post('/api/auth/reset-password').send({ token: 'not-a-real-token', newPassword: 'NewPass456' });
        expect(res.status).toBe(400);
    });

    test('resetting with a new password under 8 characters is rejected even with a valid token', async () => {
        await request(app).post('/api/auth/forgot-password').send({ email });
        const token = extractToken(capturedLink);
        const res = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'short' });
        expect(res.status).toBe(400);
    });

    test('a real reset token actually changes the password, kills existing sessions, and is single-use', async () => {
        const loginBefore = await request(app).post('/api/auth/login').send({ email, password });
        const oldCookie = loginBefore.headers['set-cookie'][0];

        await request(app).post('/api/auth/forgot-password').send({ email });
        const token = extractToken(capturedLink);

        const resetRes = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'BrandNewPass789' });
        expect(resetRes.status).toBe(200);

        // Old session is dead — same token_version-bump mechanism already
        // proven by authFlow's own tests.
        const meWithOldCookie = await request(app).get('/api/auth/me').set('Cookie', oldCookie);
        expect(meWithOldCookie.status).toBe(401);

        const loginOldPassword = await request(app).post('/api/auth/login').send({ email, password });
        expect(loginOldPassword.status).toBe(401);

        const loginNewPassword = await request(app).post('/api/auth/login').send({ email, password: 'BrandNewPass789' });
        expect(loginNewPassword.status).toBe(200);

        // Single-use: the same token can't be replayed.
        const reuseRes = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'YetAnotherPass000' });
        expect(reuseRes.status).toBe(400);
    });

    test('resetting with an expired token is rejected', async () => {
        await request(app).post('/api/auth/forgot-password').send({ email });
        const token = extractToken(capturedLink);
        await db.query(
            'UPDATE password_reset_tokens SET expires_at = ? WHERE user_id = ? ORDER BY reset_token_id DESC LIMIT 1',
            [new Date(Date.now() - 60 * 1000), userId]
        );

        const res = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'ExpiredFlowPass123' });
        expect(res.status).toBe(400);
    });
});
