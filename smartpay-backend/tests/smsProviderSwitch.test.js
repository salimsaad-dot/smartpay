// Unit tests for the SMS_PROVIDER switch added 2026-10-07 — the whole
// point of utils/smsProvider.js's contract is that reminderController.js
// and fridayJob.js never need to know which adapter is actually active,
// so this pins down the selection logic itself (mocked adapters, no
// network), not the adapters' own send behavior (covered separately in
// mnotifyProvider.test.js / arkeselProvider.test.js).
afterEach(() => {
    jest.resetModules();
    delete process.env.SMS_PROVIDER;
});

describe('smsProvider — SMS_PROVIDER switch', () => {
    test('defaults to mnotify when SMS_PROVIDER is unset', () => {
        jest.doMock('../utils/mnotifyProvider', () => ({ sendSms: jest.fn(), normalizePhoneNumber: jest.fn(), validateConfiguration: () => 'mnotify-marker' }));
        jest.doMock('../utils/arkeselProvider', () => ({ sendSms: jest.fn(), normalizePhoneNumber: jest.fn(), validateConfiguration: () => 'arkesel-marker' }));

        const smsProvider = require('../utils/smsProvider');
        expect(smsProvider.validateConfiguration()).toBe('mnotify-marker');
    });

    test('routes to arkesel when SMS_PROVIDER=arkesel', () => {
        process.env.SMS_PROVIDER = 'arkesel';
        jest.doMock('../utils/mnotifyProvider', () => ({ sendSms: jest.fn(), normalizePhoneNumber: jest.fn(), validateConfiguration: () => 'mnotify-marker' }));
        jest.doMock('../utils/arkeselProvider', () => ({ sendSms: jest.fn(), normalizePhoneNumber: jest.fn(), validateConfiguration: () => 'arkesel-marker' }));

        const smsProvider = require('../utils/smsProvider');
        expect(smsProvider.validateConfiguration()).toBe('arkesel-marker');
    });

    test('an unrecognized SMS_PROVIDER value falls back to mnotify rather than throwing', () => {
        process.env.SMS_PROVIDER = 'some-typo';
        jest.doMock('../utils/mnotifyProvider', () => ({ sendSms: jest.fn(), normalizePhoneNumber: jest.fn(), validateConfiguration: () => 'mnotify-marker' }));
        jest.doMock('../utils/arkeselProvider', () => ({ sendSms: jest.fn(), normalizePhoneNumber: jest.fn(), validateConfiguration: () => 'arkesel-marker' }));

        const smsProvider = require('../utils/smsProvider');
        expect(smsProvider.validateConfiguration()).toBe('mnotify-marker');
    });

    test('forwards sendSms arguments through to the active provider', async () => {
        process.env.SMS_PROVIDER = 'arkesel';
        const arkeselSendSms = jest.fn().mockResolvedValue({ success: true, providerMessageId: 'x', error: null });
        jest.doMock('../utils/mnotifyProvider', () => ({ sendSms: jest.fn(), normalizePhoneNumber: jest.fn(), validateConfiguration: jest.fn() }));
        jest.doMock('../utils/arkeselProvider', () => ({ sendSms: arkeselSendSms, normalizePhoneNumber: jest.fn(), validateConfiguration: jest.fn() }));

        const smsProvider = require('../utils/smsProvider');
        const result = await smsProvider.sendSms('0577428684', 'Hello');

        expect(arkeselSendSms).toHaveBeenCalledWith('0577428684', 'Hello');
        expect(result.success).toBe(true);
    });
});
