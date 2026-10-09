const request = require('supertest');
const app = require('../server');
const db = require('../db');
const geminiService = require('../utils/geminiService');

// jest.spyOn on the real module object intelligenceController.js imports
// — not a destructured reference — matching the exact convention this
// project already settled on twice this session (SMS provider, then
// forgot-password email) after the destructuring version silently
// defeated the mock both times.
//
// Same hasRealProviderKey gating sms.integration.test.js already uses —
// once a real GEMINI_API_KEY exists (it does, as of 2026-10-08), the
// "not configured" test's own premise is false, and it would otherwise
// either make a real billable Gemini call or just fail outright.
const hasRealGeminiKey = Boolean(process.env.GEMINI_API_KEY);

describe('Financial Intelligence — daily-cached AI summary (real DB, real HTTP)', () => {
    const MARKER = `CI-INTEL-${Date.now()}`;
    let cookieA, cookieB;
    let schoolIdA, schoolIdB;

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
    });

    afterEach(async () => {
        await db.query('DELETE FROM financial_insight_cache WHERE school_id IN (?, ?)', [schoolIdA, schoolIdB]);
        jest.restoreAllMocks();
    });

    afterAll(async () => {
        await db.query('DELETE FROM audit_logs WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM fee_types WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM sms_templates WHERE school_id IN (SELECT id FROM schools WHERE code LIKE ?)', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM users WHERE email LIKE ?', [`%${MARKER.toLowerCase()}%`]);
        await db.query('DELETE FROM schools WHERE code LIKE ?', [`%${MARKER.toLowerCase()}%`]);
        await db.end();
    });

    // Only meaningful when no real key is configured — with a real key
    // present, this test's whole premise (the env var isn't set) no
    // longer holds. The behavior itself (ok:false renders cleanly) is
    // still covered unconditionally by the next test below, via a mock
    // rather than relying on the env being unconfigured.
    (hasRealGeminiKey ? test.skip : test)(
        'when GEMINI_API_KEY is not configured, the endpoint fails cleanly with ok:false, not a crash',
        async () => {
            const res = await request(app).get('/api/intelligence/financial-summary').set('Cookie', cookieA);
            expect(res.status).toBe(200);
            expect(res.body.data.ok).toBe(false);
            expect(res.body.data.message).toMatch(/couldn't get an ai summary/i);
        }
    );

    test('a "not configured" result from geminiService still renders as a clean ok:false, regardless of env state', async () => {
        jest.spyOn(geminiService, 'interpretFinancialInsight').mockResolvedValue({
            ok: false,
            reason: 'AI insight is not configured.',
        });
        const res = await request(app).get('/api/intelligence/financial-summary').set('Cookie', cookieA);
        expect(res.status).toBe(200);
        expect(res.body.data.ok).toBe(false);
        expect(res.body.data.message).toMatch(/couldn't get an ai summary/i);
    });

    test('a successful generation is cached: a second call the same day does not call Gemini again', async () => {
        const spy = jest.spyOn(geminiService, 'interpretFinancialInsight').mockResolvedValue({
            ok: true,
            data: { summary: 'Test summary.', highlights: ['Test highlight.'] },
        });

        const first = await request(app).get('/api/intelligence/financial-summary').set('Cookie', cookieA);
        expect(first.status).toBe(200);
        expect(first.body.data.ok).toBe(true);
        expect(first.body.data.summary).toBe('Test summary.');
        expect(first.body.data.cached).toBe(false);
        expect(spy).toHaveBeenCalledTimes(1);

        const second = await request(app).get('/api/intelligence/financial-summary').set('Cookie', cookieA);
        expect(second.status).toBe(200);
        expect(second.body.data.summary).toBe('Test summary.');
        expect(second.body.data.cached).toBe(true);
        expect(spy).toHaveBeenCalledTimes(1); // still 1 — the second call hit the cache
    });

    test('backdating the cache row by one day forces real regeneration', async () => {
        const spy = jest.spyOn(geminiService, 'interpretFinancialInsight').mockResolvedValue({
            ok: true,
            data: { summary: 'Fresh summary.', highlights: ['Fresh highlight.'] },
        });

        await request(app).get('/api/intelligence/financial-summary').set('Cookie', cookieA);
        expect(spy).toHaveBeenCalledTimes(1);

        await db.query(
            'UPDATE financial_insight_cache SET generated_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE school_id = ?',
            [schoolIdA]
        );

        const res = await request(app).get('/api/intelligence/financial-summary').set('Cookie', cookieA);
        expect(res.body.data.cached).toBe(false);
        expect(spy).toHaveBeenCalledTimes(2);
    });

    test("school A's cached summary is never returned to school B — each school gets its own row", async () => {
        const spy = jest.spyOn(geminiService, 'interpretFinancialInsight')
            .mockResolvedValueOnce({ ok: true, data: { summary: 'School A summary.', highlights: ['A'] } })
            .mockResolvedValueOnce({ ok: true, data: { summary: 'School B summary.', highlights: ['B'] } });

        const resA = await request(app).get('/api/intelligence/financial-summary').set('Cookie', cookieA);
        const resB = await request(app).get('/api/intelligence/financial-summary').set('Cookie', cookieB);

        expect(resA.body.data.summary).toBe('School A summary.');
        expect(resB.body.data.summary).toBe('School B summary.');
        expect(spy).toHaveBeenCalledTimes(2); // each school generated its own, neither reused the other's

        const [rows] = await db.query('SELECT school_id, summary_json FROM financial_insight_cache WHERE school_id IN (?, ?)', [schoolIdA, schoolIdB]);
        expect(rows).toHaveLength(2);
    });

    test('an invalid/malformed Gemini response is treated as a clean failure, not trusted or crashed on', async () => {
        jest.spyOn(geminiService, 'interpretFinancialInsight').mockResolvedValue({
            ok: false,
            reason: 'AI response failed validation.',
        });

        const res = await request(app).get('/api/intelligence/financial-summary').set('Cookie', cookieA);
        expect(res.status).toBe(200);
        expect(res.body.data.ok).toBe(false);

        const [[row]] = await db.query('SELECT COUNT(*) AS n FROM financial_insight_cache WHERE school_id = ?', [schoolIdA]);
        expect(row.n).toBe(0); // nothing gets cached on failure
    });
});
