// CORS allowlist: FRONTEND_URL plus any ADDITIONAL_ORIGINS. Origin
// reaches the backend even through the frontend's /api rewrite proxy, so
// a frontend missing from this list can't log in at all.
const request = require('supertest');

process.env.FRONTEND_URL = 'https://smartpay-tan.vercel.app';
process.env.ADDITIONAL_ORIGINS = ' https://smartpay-trial.netlify.app , ';
const app = require('../server');

describe('CORS allowlist', () => {
    it('allows FRONTEND_URL', async () => {
        const res = await request(app).get('/api/health').set('Origin', 'https://smartpay-tan.vercel.app');
        expect(res.status).toBe(200);
        expect(res.headers['access-control-allow-origin']).toBe('https://smartpay-tan.vercel.app');
    });

    it('allows an origin listed in ADDITIONAL_ORIGINS, trimming spaces and empty entries', async () => {
        const res = await request(app).get('/api/health').set('Origin', 'https://smartpay-trial.netlify.app');
        expect(res.status).toBe(200);
        expect(res.headers['access-control-allow-origin']).toBe('https://smartpay-trial.netlify.app');
    });

    it('rejects an origin on neither list', async () => {
        const res = await request(app).get('/api/health').set('Origin', 'https://evil.example.com');
        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Not allowed by CORS');
    });

    it('allows requests with no Origin header (server-to-server, curl)', async () => {
        const res = await request(app).get('/api/health');
        expect(res.status).toBe(200);
    });
});
