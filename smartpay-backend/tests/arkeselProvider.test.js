// Unit tests (mocked fetch, no network) for the Arkesel adapter added
// 2026-10-07. The success-response shape is confirmed against Arkesel's
// own documented example; the failure-response shape is NOT independently
// confirmed (same caution as mnotifyProvider.js after its own real-send
// surprise) — these tests pin down current, defensive behavior, not a
// guarantee the real API matches exactly until a live send corrects it.
const originalFetch = global.fetch;

afterEach(() => {
    global.fetch = originalFetch;
    jest.resetModules();
    delete process.env.ARKESEL_API_KEY;
    delete process.env.ARKESEL_SENDER_ID;
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

describe('arkeselProvider', () => {
    describe('normalizePhoneNumber', () => {
        test('converts a local 0-prefixed number to +233 format', () => {
            const { normalizePhoneNumber } = require('../utils/arkeselProvider');
            expect(normalizePhoneNumber('0577428684')).toBe('+233577428684');
        });

        test('converts an already-233-prefixed number by adding +', () => {
            const { normalizePhoneNumber } = require('../utils/arkeselProvider');
            expect(normalizePhoneNumber('233577428684')).toBe('+233577428684');
        });

        test('returns null for an unusable number', () => {
            const { normalizePhoneNumber } = require('../utils/arkeselProvider');
            expect(normalizePhoneNumber('123')).toBeNull();
            expect(normalizePhoneNumber('')).toBeNull();
        });
    });

    // Shape confirmed 2026-10-07 against a real Arkesel send, not just
    // their documented example — data is an array (one entry per
    // recipient), which the docs alone didn't make clear, and
    // provierMessageId was silently null until this was corrected.
    test('extracts data[0].id from a real confirmed successful response', async () => {
        process.env.ARKESEL_API_KEY = 'test-key';
        mockFetchOnce(200, {
            status: 'success',
            data: [{ id: 'fbacec80-23e4-48c6-a0e7-b462afd798ec', recipient: '233577428684' }],
            main_balance: 0.2,
            sms_balance: 9,
        });

        const { sendSms } = require('../utils/arkeselProvider');
        const result = await sendSms('0577428684', 'Test message');

        expect(result.success).toBe(true);
        expect(result.providerMessageId).toBe('fbacec80-23e4-48c6-a0e7-b462afd798ec');
        expect(result.error).toBeNull();
    });

    test('a non-success status in a 200 response is still treated as a failure', async () => {
        process.env.ARKESEL_API_KEY = 'test-key';
        mockFetchOnce(200, { status: 'error', message: 'Insufficient balance' });

        const { sendSms } = require('../utils/arkeselProvider');
        const result = await sendSms('0577428684', 'Test message');

        expect(result.success).toBe(false);
        expect(result.error).toBe('Insufficient balance');
    });

    test('a non-JSON failure response is handled cleanly and logged', async () => {
        process.env.ARKESEL_API_KEY = 'test-key';
        mockFetchOnceRaw(401, 'Unauthorized');
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        const { sendSms } = require('../utils/arkeselProvider');
        const result = await sendSms('0577428684', 'Test message');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/401/);
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Unauthorized'));

        consoleSpy.mockRestore();
    });

    test('reports not-configured when no API key is set', async () => {
        const { sendSms } = require('../utils/arkeselProvider');
        const result = await sendSms('0577428684', 'Test message');
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/not configured/);
    });
});
