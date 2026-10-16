const mnotify = require('../utils/mnotifyProvider');
const arkesel = require('../utils/arkeselProvider');

// SMS calls give up after 15 seconds (2026-10-16). A timeout means we never
// heard back, so the SMS may or may not have gone out: it's reported as
// outcomeUnknown, which the Friday job never resends automatically.
describe('SMS provider timeouts', () => {
    const saved = {};
    beforeEach(() => {
        for (const k of ['MNOTIFY_API_KEY', 'ARKESEL_API_KEY']) saved[k] = process.env[k];
        process.env.MNOTIFY_API_KEY = 'test-key';
        process.env.ARKESEL_API_KEY = 'test-key';
    });
    afterEach(() => {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
        jest.restoreAllMocks();
    });

    const timeoutError = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

    test.each([['mNotify', mnotify], ['Arkesel', arkesel]])('%s: a timeout is reported as outcome unknown, with a time limit on the call', async (name, provider) => {
        const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(timeoutError());
        const result = await provider.sendSms('0241234567', 'hello');
        expect(result).toMatchObject({ success: false, outcomeUnknown: true });
        expect(result.error).toMatch(/may or may not have been sent/);
        expect(fetchSpy.mock.calls[0][1].signal).toBeDefined();
    });

    test.each([['mNotify', mnotify], ['Arkesel', arkesel]])('%s: an ordinary network error is a plain (retryable) failure', async (name, provider) => {
        jest.spyOn(global, 'fetch').mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
        const result = await provider.sendSms('0241234567', 'hello');
        expect(result.success).toBe(false);
        expect(result.outcomeUnknown).toBeUndefined();
    });
});
