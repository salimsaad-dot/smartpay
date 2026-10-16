const emailSender = require('../utils/emailSender');
const { alertOwner, resetAlertCooldowns } = require('../utils/opsAlert');

// Owner alerts (2026-10-16): problems that used to reach only Render's logs
// now email the owner, at most once an hour per problem.
describe('owner alerts', () => {
    let sendSpy;
    const saved = {};

    beforeEach(() => {
        for (const k of ['OPS_ALERT_EMAIL', 'DEMO_NOTIFY_EMAIL', 'OPS_ALERT_SEND_IN_TESTS']) saved[k] = process.env[k];
        process.env.OPS_ALERT_SEND_IN_TESTS = '1';
        delete process.env.OPS_ALERT_EMAIL;
        process.env.DEMO_NOTIFY_EMAIL = 'owner@example.com';
        resetAlertCooldowns();
        sendSpy = jest.spyOn(emailSender, 'sendOpsAlertEmail').mockResolvedValue({ delivered: true });
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
        jest.restoreAllMocks();
    });

    test('emails the owner (falling back to the demo-request address)', async () => {
        const result = await alertOwner('k1', 'Money received but not credited', ['Reference: sp_1']);
        expect(result.sent).toBe(true);
        expect(sendSpy).toHaveBeenCalledWith('owner@example.com', 'Money received but not credited', ['Reference: sp_1']);
    });

    test('OPS_ALERT_EMAIL takes priority when set', async () => {
        process.env.OPS_ALERT_EMAIL = 'alerts@example.com';
        await alertOwner('k2', 'x');
        expect(sendSpy).toHaveBeenCalledWith('alerts@example.com', 'x', []);
    });

    test('the same problem is emailed once an hour, not every time', async () => {
        await alertOwner('webhook-failure', 'Webhook failed');
        await alertOwner('webhook-failure', 'Webhook failed');
        await alertOwner('other-problem', 'Something else');
        expect(sendSpy).toHaveBeenCalledTimes(2);
    });

    test('never throws, even if the email fails', async () => {
        sendSpy.mockRejectedValue(new Error('Resend down'));
        await expect(alertOwner('k3', 'x')).resolves.toMatchObject({ sent: false });
    });

    test('does nothing without an address, and never emails from tests unless opted in', async () => {
        delete process.env.DEMO_NOTIFY_EMAIL;
        expect((await alertOwner('k4', 'x')).reason).toBe('no address');
        process.env.DEMO_NOTIFY_EMAIL = 'owner@example.com';
        delete process.env.OPS_ALERT_SEND_IN_TESTS;
        expect((await alertOwner('k5', 'x')).reason).toBe('test');
        expect(sendSpy).not.toHaveBeenCalled();
    });

    test('the alert email escapes what it is given', async () => {
        sendSpy.mockRestore();
        const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true });
        const prev = process.env.RESEND_API_KEY;
        process.env.RESEND_API_KEY = 'test-key';
        try {
            await emailSender.sendOpsAlertEmail('owner@example.com', 'Bad <b>thing</b>', ['<script>x</script>']);
            const html = JSON.parse(fetchSpy.mock.calls[0][1].body).html;
            expect(html).not.toContain('<script>');
            expect(html).toContain('&lt;script&gt;');
        } finally {
            process.env.RESEND_API_KEY = prev;
        }
    });
});
