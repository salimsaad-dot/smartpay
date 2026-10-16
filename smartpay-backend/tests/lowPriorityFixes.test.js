const request = require('supertest');
const app = require('../server');
const db = require('../db');
const geminiService = require('../utils/geminiService');
const intelligence = require('../controllers/intelligenceController');
const { createSchoolWithAdmin } = require('../utils/schoolProvisioning');

// Small hardening fixes from the council list (2026-10-16).
describe('low-priority fixes', () => {
    const MARKER = `ci-low-${Date.now()}`;
    let cookie;
    let schoolId;

    beforeAll(async () => {
        const reg = await request(app).post('/api/auth/register-school').send({
            schoolName: MARKER, code: MARKER, adminName: 'CI', email: `${MARKER}@example.com`, password: 'TestPass123',
        });
        cookie = reg.headers['set-cookie'][0];
        schoolId = reg.body.data.schoolId;
    });

    afterAll(async () => {
        for (const t of ['financial_insight_cache', 'audit_logs', 'fee_types', 'sms_templates', 'users']) {
            await db.query(`DELETE FROM ${t} WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)`, [`${MARKER}%`]);
        }
        await db.query('DELETE FROM schools WHERE code LIKE ?', [`${MARKER}%`]);
        await db.end();
    });

    test('impossible calendar dates are rejected, not passed to MySQL', async () => {
        for (const bad of ['2026-02-30', '2026-13-01', '2026-04-31']) {
            await expect(createSchoolWithAdmin({
                schoolName: 'X', code: `${MARKER}-x`, adminName: 'X', email: `${MARKER}-x@example.com`, password: 'TestPass123', paidUntil: bad,
            })).rejects.toMatchObject({ status: 400 });
        }
    });

    test('every database connection runs in UTC', async () => {
        const [[{ tz }]] = await db.query('SELECT @@session.time_zone AS tz');
        expect(tz).toBe('+00:00');
    });

    test('after a failed AI call, the AI is not called again for a while (shared quota)', async () => {
        intelligence.resetSummaryCooldown();
        await db.query('DELETE FROM financial_insight_cache WHERE school_id = ?', [schoolId]);
        const spy = jest.spyOn(geminiService, 'interpretFinancialInsight').mockResolvedValue({ ok: false, reason: 'quota' });
        try {
            const first = await request(app).get('/api/intelligence/financial-summary').set('Cookie', cookie);
            expect(first.body.data.ok).toBe(false);
            await request(app).get('/api/intelligence/financial-summary').set('Cookie', cookie);
            await request(app).get('/api/intelligence/financial-summary').set('Cookie', cookie);
            expect(spy).toHaveBeenCalledTimes(1);
        } finally {
            spy.mockRestore();
            intelligence.resetSummaryCooldown();
        }
    });
});
