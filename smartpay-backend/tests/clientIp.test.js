const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { clientIp, connectionIp } = require('../utils/clientIp');

// Rate limits and the audit log key on the real visitor (2026-10-16). On
// the live stack req.ip was Render's internal address for everyone, so
// every parent shared one bucket. Header behaviour below was measured live.
describe('real visitor address', () => {
    const fakeReq = (headers, ip = '10.28.206.5') => ({ headers, ip });

    afterAll(() => db.end());

    test('through Vercel: the visitor from x-vercel-proxied-for, not Vercel or Render', () => {
        const req = fakeReq({
            'x-vercel-proxied-for': '41.215.173.125',
            'cf-connecting-ip': '13.245.27.192',
            'x-forwarded-for': '41.215.173.125,13.245.27.192, 172.71.144.87, 10.28.206.5',
        });
        expect(clientIp(req)).toBe('41.215.173.125');
        expect(connectionIp(req)).toBe('13.245.27.192');
    });

    test('direct to Render: the visitor is the first forwarded address, the connection is Cloudflare\'s', () => {
        const req = fakeReq({ 'cf-connecting-ip': '41.215.173.125', 'x-forwarded-for': '41.215.173.125, 104.22.76.133, 10.28.76.130' });
        expect(clientIp(req)).toBe('41.215.173.125');
        expect(connectionIp(req)).toBe('41.215.173.125');
    });

    test('a direct caller can claim a visitor address, but its connection address stays real (so the cap still applies)', () => {
        const req = fakeReq({ 'x-vercel-proxied-for': '8.8.8.8', 'cf-connecting-ip': '41.215.173.125' });
        expect(clientIp(req)).toBe('8.8.8.8');
        expect(connectionIp(req)).toBe('41.215.173.125');
    });

    test('no proxy headers (local dev): falls back to req.ip', () => {
        expect(clientIp(fakeReq({}, '127.0.0.1'))).toBe('127.0.0.1');
    });

    test('two parents behind Vercel get separate rate-limit buckets', async () => {
        const hit = (ip) => request(app).get('/api/public/checkout/not-a-real-token').set('x-vercel-proxied-for', ip);
        const remaining = async (ip) => Number((await hit(ip)).headers['ratelimit-remaining']);
        const a1 = await remaining('41.215.1.1');
        const a2 = await remaining('41.215.1.1');
        const b1 = await remaining('41.215.2.2');
        expect(a2).toBe(a1 - 1);
        expect(b1).toBe(a1); // a fresh bucket, not shared with parent A
    });

    test('one parent who exhausts their checkout limit does not block another', async () => {
        const hit = (ip) => request(app).get('/api/public/checkout/not-a-real-token').set('x-vercel-proxied-for', ip);
        for (let i = 0; i < 30; i += 1) await hit('41.215.3.3');
        expect((await hit('41.215.3.3')).status).toBe(429);
        expect((await hit('41.215.4.4')).status).toBe(404);
    });
});
