// Unit tests (mocked fetch, no network/DB) for the providerMessageId
// extraction bug found and fixed 2026-10-07: a real successful mNotify
// quick-send response was being mis-parsed (checked `summary.id` and
// `data[0]._id`, neither of which the real API ever returns), so
// providerMessageId was silently null on every real send. This pins the
// real captured response shape down so it can't regress.
const originalFetch = global.fetch;

afterEach(() => {
    global.fetch = originalFetch;
    jest.resetModules();
    delete process.env.MNOTIFY_API_KEY;
    delete process.env.MNOTIFY_SENDER_ID;
});

function mockFetchOnce(status, body) {
    global.fetch = jest.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body),
    });
}

function mockFetchOnceRaw(status, rawText) {
    global.fetch = jest.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        text: async () => rawText,
    });
}

describe('mnotifyProvider.sendSms — providerMessageId extraction', () => {
    test('extracts summary.message_id from a real successful quick-send response', async () => {
        process.env.MNOTIFY_API_KEY = 'test-key';
        mockFetchOnce(200, {
            status: 'success',
            code: '2000',
            message: 'messages sent successfully',
            summary: {
                _id: 'DE53396E-B5F4-447D-98A8-170D80FAFA97',
                message_id: '20261007233577428684V2',
                type: 'API QUICK SMS',
                total_sent: 1,
                contacts: 1,
                total_rejected: 0,
                numbers_sent: ['233577428684'],
                credit_used: 1,
                credit_left: 284,
                wallet_used: 0,
            },
        });

        const { sendSms } = require('../utils/mnotifyProvider');
        const result = await sendSms('0577428684', 'Test message');

        expect(result.success).toBe(true);
        expect(result.providerMessageId).toBe('20261007233577428684V2');
        expect(result.error).toBeNull();
    });

    test('falls back to summary._id when message_id is absent', async () => {
        process.env.MNOTIFY_API_KEY = 'test-key';
        mockFetchOnce(200, { status: 'success', summary: { _id: 'fallback-id' } });

        const { sendSms } = require('../utils/mnotifyProvider');
        const result = await sendSms('0577428684', 'Test message');

        expect(result.success).toBe(true);
        expect(result.providerMessageId).toBe('fallback-id');
    });

    test('a 402 (no balance) is reported as a clean failure, not a crash', async () => {
        process.env.MNOTIFY_API_KEY = 'test-key';
        mockFetchOnce(402, {});

        const { sendSms } = require('../utils/mnotifyProvider');
        const result = await sendSms('0577428684', 'Test message');

        expect(result.success).toBe(false);
        expect(result.providerMessageId).toBeNull();
        expect(result.error).toMatch(/402/);
    });

    // Hit live in production, 2026-10-07: a 419 with no further detail
    // from mNotify. The old .json().catch(() => null) silently discarded
    // whatever the real response body actually said — this confirms a
    // non-JSON (or otherwise unparseable) failure response is still
    // handled cleanly, and that its raw content is at least logged
    // server-side instead of vanishing entirely.
    test('a non-JSON failure response (e.g. a WAF/rate-limit HTML page) is handled cleanly and logged', async () => {
        process.env.MNOTIFY_API_KEY = 'test-key';
        mockFetchOnceRaw(419, '<html><body>Rate limited</body></html>');
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        const { sendSms } = require('../utils/mnotifyProvider');
        const result = await sendSms('0577428684', 'Test message');

        expect(result.success).toBe(false);
        expect(result.providerMessageId).toBeNull();
        expect(result.error).toMatch(/419/);
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Rate limited'));

        consoleSpy.mockRestore();
    });
});
