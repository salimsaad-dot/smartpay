const request = require('supertest');
const app = require('../server');
const db = require('../db');
const emailSender = require('../utils/emailSender');

// The marketing site's public "Book a demo" form. Exactly five requests
// reach the route before the last test, because the limiter allows five
// per IP per hour and the sixth must be refused. Each test file gets a
// fresh module registry, so the limiter starts empty here.
describe('POST /api/demo-requests (public, real DB)', () => {
    const MARKER = `CI-DEMO-${Date.now()}`;
    const valid = {
        schoolName: `${MARKER} Academy`,
        contactName: 'Ama Mensah',
        role: 'Headteacher',
        phone: '024 123 4567',
        email: 'ama@example.com',
        studentCount: '100–300',
        message: 'We collect fees by hand <script>alert(1)</script>',
    };
    let sendSpy;

    beforeAll(() => {
        process.env.DEMO_NOTIFY_EMAIL = 'owner@example.com';
    });

    beforeEach(() => {
        sendSpy = jest.spyOn(emailSender, 'sendDemoRequestEmail').mockResolvedValue({ delivered: true });
    });

    afterEach(() => sendSpy.mockRestore());

    afterAll(async () => {
        await db.query('DELETE FROM demo_requests WHERE school_name LIKE ?', [`${MARKER}%`]);
        await db.end();
    });

    const rowsFor = async (schoolName) => {
        const [rows] = await db.query('SELECT * FROM demo_requests WHERE school_name = ?', [schoolName]);
        return rows;
    };

    it('stores a valid request and notifies the owner', async () => {
        const res = await request(app).post('/api/demo-requests').send(valid);
        expect(res.status).toBe(201);
        const rows = await rowsFor(valid.schoolName);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ contact_name: 'Ama Mensah', phone: '024 123 4567', student_count: '100–300', status: 'new' });
        expect(sendSpy).toHaveBeenCalledWith('owner@example.com', expect.objectContaining({ schoolName: valid.schoolName }));
    });

    it('requires a phone number (email alone is not enough)', async () => {
        const res = await request(app).post('/api/demo-requests').send({ ...valid, schoolName: `${MARKER} NoPhone`, phone: '' });
        expect(res.status).toBe(400);
        expect(await rowsFor(`${MARKER} NoPhone`)).toHaveLength(0);
    });

    it('rejects a malformed email but allows leaving it blank', async () => {
        const res = await request(app).post('/api/demo-requests').send({ ...valid, schoolName: `${MARKER} BadEmail`, email: 'not-an-email' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/leave it blank/);
    });

    it('answers a honeypot submission with success but stores nothing', async () => {
        const res = await request(app).post('/api/demo-requests').send({ ...valid, schoolName: `${MARKER} Bot`, website: 'http://spam.example' });
        expect(res.status).toBe(201);
        expect(await rowsFor(`${MARKER} Bot`)).toHaveLength(0);
        expect(sendSpy).not.toHaveBeenCalled();
    });

    it('still succeeds when the notification email fails, with no email given', async () => {
        sendSpy.mockResolvedValue({ delivered: false });
        const res = await request(app).post('/api/demo-requests').send({ ...valid, schoolName: `${MARKER} NoEmail`, email: '' });
        expect(res.status).toBe(201);
        const rows = await rowsFor(`${MARKER} NoEmail`);
        expect(rows).toHaveLength(1);
        expect(rows[0].email).toBeNull();
    });

    it('refuses a sixth request from the same IP within the hour', async () => {
        const res = await request(app).post('/api/demo-requests').send({ ...valid, schoolName: `${MARKER} Sixth` });
        expect(res.status).toBe(429);
        expect(await rowsFor(`${MARKER} Sixth`)).toHaveLength(0);
    });
});

describe('sendDemoRequestEmail', () => {
    it('escapes visitor-typed HTML before emailing it', async () => {
        const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true });
        const previousKey = process.env.RESEND_API_KEY;
        process.env.RESEND_API_KEY = 'test-key';
        try {
            await emailSender.sendDemoRequestEmail('owner@example.com', {
                schoolName: 'A <b>School</b>', contactName: 'Kofi', phone: '0241234567', message: '<script>x</script>',
            });
            const html = JSON.parse(fetchSpy.mock.calls[0][1].body).html;
            expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
            expect(html).not.toContain('<script>');
            expect(html).toContain('A &lt;b&gt;School&lt;/b&gt;');
        } finally {
            fetchSpy.mockRestore();
            process.env.RESEND_API_KEY = previousKey;
        }
    });
});
