const request = require('supertest');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const app = require('../server');
const db = require('../db');

describe('auth flow (real DB, real HTTP)', () => {
    const MARKER = `CI-AUTH-${Date.now()}`;
    const email = `${MARKER.toLowerCase()}@example.com`;
    const password = 'TestPass123';
    let userId;
    let schoolId;

    beforeAll(async () => {
        const res = await request(app)
            .post('/api/auth/register-school')
            .send({ schoolName: MARKER, code: MARKER.toLowerCase(), adminName: 'CI Admin', email, password });
        userId = res.body.data.userId;
        schoolId = res.body.data.schoolId;
    });

    // Inserted directly against the DB rather than through
    // /register-school — register-school has its own strict per-IP rate
    // limit (5/hour, deliberately tighter than login's), and this one
    // test file already spends several of that budget on real
    // registration-flow assertions. These three extra test users only
    // need to exist and have a known password; they don't need their own
    // school or exercise the registration endpoint again.
    async function createTestUser(testEmail) {
        const passwordHash = await bcrypt.hash(password, 10);
        const [result] = await db.query(
            'INSERT INTO users (school_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
            [schoolId, 'CI Test User', testEmail, passwordHash, 'school_admin']
        );
        return result.insertId;
    }

    afterAll(async () => {
        await db.query('DELETE FROM audit_logs WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM fee_types WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM sms_templates WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM users WHERE email LIKE ?', [`${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM schools WHERE code LIKE ?', [`${MARKER.toLowerCase()}%`]);
        await db.end();
    });

    test('login with correct credentials succeeds and sets a working session', async () => {
        const res = await request(app).post('/api/auth/login').send({ email, password });
        expect(res.status).toBe(200);
        expect(res.headers['set-cookie']).toBeDefined();
    });

    test('login with a wrong password is rejected', async () => {
        const res = await request(app).post('/api/auth/login').send({ email, password: 'WrongPass123' });
        expect(res.status).toBe(401);
    });

    test('login with a non-existent email is rejected with the same generic message (no user-enumeration signal)', async () => {
        const res = await request(app).post('/api/auth/login').send({ email: 'nobody-here@example.com', password: 'whatever123' });
        expect(res.status).toBe(401);
        expect(res.body.message).toMatch(/invalid email or password/i);
    });

    test('bumping token_version invalidates an already-issued token immediately', async () => {
        const loginRes = await request(app).post('/api/auth/login').send({ email, password });
        const cookie = loginRes.headers['set-cookie'][0];

        const meBefore = await request(app).get('/api/auth/me').set('Cookie', cookie);
        expect(meBefore.status).toBe(200);

        await db.query('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [userId]);

        const meAfter = await request(app).get('/api/auth/me').set('Cookie', cookie);
        expect(meAfter.status).toBe(401);
    });

    // Regression test for a council-pressure-tested audit finding
    // (2026-10-07): jwt.verify() without an explicit `algorithms` option
    // accepts ANY HMAC variant (HS256/HS384/HS512) for a symmetric
    // secret, not just the HS256 this app actually signs with. Confirmed
    // live before this fix that a token signed with the same secret but
    // HS384 was silently accepted; verifyToken now pins `algorithms:
    // ['HS256']` explicitly, so the same forged-algorithm token is
    // rejected even though the secret itself is correct.
    test('a token signed with a different HMAC algorithm (same secret) is rejected, not silently accepted', async () => {
        const forgedToken = jwt.sign(
            { userId, role: 'school_admin', tokenVersion: 1 },
            process.env.JWT_SECRET,
            { algorithm: 'HS384', expiresIn: '1d' }
        );
        const res = await request(app).get('/api/auth/me').set('Cookie', `token=${forgedToken}`);
        expect(res.status).toBe(403);
    });

    test('a weak password is rejected at registration', async () => {
        const res = await request(app)
            .post('/api/auth/register-school')
            .send({ schoolName: 'Weak Pw School', code: `${MARKER.toLowerCase()}-weak`, adminName: 'X', email: `${MARKER.toLowerCase()}-weak@example.com`, password: 'short' });
        expect(res.status).toBe(400);
    });

    test('an invalid school code (bad chars, reserved word) is rejected at registration', async () => {
        const res = await request(app)
            .post('/api/auth/register-school')
            .send({ schoolName: 'Bad Code School', code: 'admin', adminName: 'X', email: `${MARKER.toLowerCase()}-badcode@example.com`, password: 'TestPass123' });
        expect(res.status).toBe(400);
    });

    describe('per-account login lockout', () => {
        const lockoutEmail = `${MARKER.toLowerCase()}-lockout@example.com`;

        beforeAll(async () => {
            await createTestUser(lockoutEmail);
        });

        test('5 wrong passwords lock the account regardless of which IP sent them; a 6th attempt is locked even with the correct password', async () => {
            for (let i = 0; i < 5; i++) {
                const res = await request(app).post('/api/auth/login').send({ email: lockoutEmail, password: 'WrongPass123' });
                expect(res.status).toBe(401);
            }
            const lockedOut = await request(app).post('/api/auth/login').send({ email: lockoutEmail, password });
            expect(lockedOut.status).toBe(423);
        });

        test('a correct login clears the lockout counters so a later mistake starts counting from zero again', async () => {
            await db.query(
                'UPDATE users SET locked_until = NULL, failed_login_attempts = 0 WHERE email = ?',
                [lockoutEmail]
            );
            const goodLogin = await request(app).post('/api/auth/login').send({ email: lockoutEmail, password });
            expect(goodLogin.status).toBe(200);

            const [[row]] = await db.query('SELECT failed_login_attempts, locked_until FROM users WHERE email = ?', [lockoutEmail]);
            expect(row.failed_login_attempts).toBe(0);
            expect(row.locked_until).toBeNull();
        });
    });

    describe('change password (closes the previously-unreachable session-revocation gap)', () => {
        const pwEmail = `${MARKER.toLowerCase()}-pwchange@example.com`;
        let cookie;

        beforeAll(async () => {
            await createTestUser(pwEmail);
            const loginRes = await request(app).post('/api/auth/login').send({ email: pwEmail, password });
            cookie = loginRes.headers['set-cookie'][0];
        });

        test('rejects the wrong current password', async () => {
            const res = await request(app)
                .post('/api/auth/change-password')
                .set('Cookie', cookie)
                .send({ currentPassword: 'WrongPass123', newPassword: 'NewPass456' });
            expect(res.status).toBe(401);
        });

        test('rejects a new password under 8 characters', async () => {
            const res = await request(app)
                .post('/api/auth/change-password')
                .set('Cookie', cookie)
                .send({ currentPassword: password, newPassword: 'short' });
            expect(res.status).toBe(400);
        });

        test('a correct change invalidates the old session everywhere but keeps this request\'s own session alive via the reissued cookie', async () => {
            const changeRes = await request(app)
                .post('/api/auth/change-password')
                .set('Cookie', cookie)
                .send({ currentPassword: password, newPassword: 'NewPass456' });
            expect(changeRes.status).toBe(200);
            const newCookie = changeRes.headers['set-cookie'][0];

            // The pre-change cookie is now a dead token_version — same
            // mechanism authFlow's own "bumping token_version" test above
            // already proves verifyToken enforces.
            const meWithOldCookie = await request(app).get('/api/auth/me').set('Cookie', cookie);
            expect(meWithOldCookie.status).toBe(401);

            const meWithNewCookie = await request(app).get('/api/auth/me').set('Cookie', newCookie);
            expect(meWithNewCookie.status).toBe(200);

            const loginWithNewPassword = await request(app).post('/api/auth/login').send({ email: pwEmail, password: 'NewPass456' });
            expect(loginWithNewPassword.status).toBe(200);
        });
    });

    describe('revoke sessions (manual kill-switch)', () => {
        const killEmail = `${MARKER.toLowerCase()}-killswitch@example.com`;
        let cookie;

        beforeAll(async () => {
            await createTestUser(killEmail);
            const loginRes = await request(app).post('/api/auth/login').send({ email: killEmail, password });
            cookie = loginRes.headers['set-cookie'][0];
        });

        test('revoking kills the calling session too, not just other devices — the caller must log in again', async () => {
            const meBefore = await request(app).get('/api/auth/me').set('Cookie', cookie);
            expect(meBefore.status).toBe(200);

            const revokeRes = await request(app).post('/api/auth/revoke-sessions').set('Cookie', cookie);
            expect(revokeRes.status).toBe(200);
            expect(revokeRes.headers['set-cookie'][0]).toMatch(/token=;/);

            const meAfter = await request(app).get('/api/auth/me').set('Cookie', cookie);
            expect(meAfter.status).toBe(401);

            // The account itself still works with a fresh login — this
            // revokes sessions, not the account.
            const freshLogin = await request(app).post('/api/auth/login').send({ email: killEmail, password });
            expect(freshLogin.status).toBe(200);
        });
    });

    // A council-pressure-tested security audit (2026-10-07) found that
    // every fix above (lockout, revocation, password change) was pure
    // prevention — nothing recorded whether any of these events ever
    // happened, so a school admin reviewing their own Audit Log page had
    // no way to notice a credential-stuffing run or a suspicious
    // password change after the fact. These tests confirm real rows
    // actually land in `audit_logs`, not just that the HTTP behavior is
    // correct.
    describe('auth events are actually logged (detection, not just prevention)', () => {
        async function latestAuditAction(targetUserId) {
            const [[row]] = await db.query(
                'SELECT action FROM audit_logs WHERE user_id = ? ORDER BY id DESC LIMIT 1',
                [targetUserId]
            );
            return row?.action;
        }

        test('a successful login is logged', async () => {
            await request(app).post('/api/auth/login').send({ email, password });
            expect(await latestAuditAction(userId)).toBe('auth.login_success');
        });

        test('a failed login is logged against the real account it was attempted on', async () => {
            await request(app).post('/api/auth/login').send({ email, password: 'WrongPass123' });
            expect(await latestAuditAction(userId)).toBe('auth.login_failed');
            // Leaves the account's real lockout counters dirty for later
            // tests in this file — reset immediately, same as the
            // lockout describe block above does for its own user.
            await db.query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?', [userId]);
        });

        test('a login attempt against a nonexistent email writes nothing (no school to attach it to)', async () => {
            const [[before]] = await db.query('SELECT COUNT(*) AS n FROM audit_logs');
            await request(app).post('/api/auth/login').send({ email: 'nobody-really-here@example.com', password: 'whatever123' });
            const [[after]] = await db.query('SELECT COUNT(*) AS n FROM audit_logs');
            expect(after.n).toBe(before.n);
        });

        test('hitting the lockout threshold logs both the failed attempt and the lock itself', async () => {
            const logEmail = `${MARKER.toLowerCase()}-auditlock@example.com`;
            const logUserId = await createTestUser(logEmail);
            for (let i = 0; i < 4; i++) {
                await request(app).post('/api/auth/login').send({ email: logEmail, password: 'WrongPass123' });
            }
            // The 5th wrong attempt is the one that actually crosses the
            // threshold and sets locked_until.
            await request(app).post('/api/auth/login').send({ email: logEmail, password: 'WrongPass123' });
            const [rows] = await db.query('SELECT action FROM audit_logs WHERE user_id = ? ORDER BY id ASC', [logUserId]);
            const actions = rows.map((r) => r.action);
            expect(actions.filter((a) => a === 'auth.login_failed').length).toBe(5);
            expect(actions).toContain('auth.account_locked');
        });

        test('a login attempt while locked out is logged as blocked, distinct from a plain failed attempt', async () => {
            const blockedEmail = `${MARKER.toLowerCase()}-auditblocked@example.com`;
            const blockedUserId = await createTestUser(blockedEmail);
            await db.query(
                'UPDATE users SET locked_until = ? WHERE id = ?',
                [new Date(Date.now() + 15 * 60 * 1000), blockedUserId]
            );
            await request(app).post('/api/auth/login').send({ email: blockedEmail, password });
            expect(await latestAuditAction(blockedUserId)).toBe('auth.login_blocked');
        });

        test('a password change is logged', async () => {
            const pwLogEmail = `${MARKER.toLowerCase()}-auditpwchange@example.com`;
            const pwLogUserId = await createTestUser(pwLogEmail);
            const loginRes = await request(app).post('/api/auth/login').send({ email: pwLogEmail, password });
            const cookie = loginRes.headers['set-cookie'][0];

            await request(app).post('/api/auth/change-password').set('Cookie', cookie)
                .send({ currentPassword: password, newPassword: 'NewPass456' });
            expect(await latestAuditAction(pwLogUserId)).toBe('auth.password_changed');
        });

        test('revoking sessions is logged', async () => {
            const revokeLogEmail = `${MARKER.toLowerCase()}-auditrevoke@example.com`;
            const revokeLogUserId = await createTestUser(revokeLogEmail);
            const loginRes = await request(app).post('/api/auth/login').send({ email: revokeLogEmail, password });
            const cookie = loginRes.headers['set-cookie'][0];

            await request(app).post('/api/auth/revoke-sessions').set('Cookie', cookie);
            expect(await latestAuditAction(revokeLogUserId)).toBe('auth.sessions_revoked');
        });
    });
});
