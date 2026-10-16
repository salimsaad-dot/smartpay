const totp = require('../utils/totp');

// RFC 6238 appendix B test vectors (SHA-1, secret "12345678901234567890").
describe('totp', () => {
    const secret = totp.base32Encode(Buffer.from('12345678901234567890'));

    test.each([
        [59, '287082'],
        [1111111109, '081804'],
        [1234567890, '005924'],
        [2000000000, '279037'],
    ])('code at %i seconds is %s', (seconds, code) => {
        expect(totp.codeForStep(secret, Math.floor(seconds / 30))).toBe(code);
    });

    test('accepts the neighbouring codes, nothing further, and nothing at or before afterStep', () => {
        const now = 1234567890 * 1000;
        const step = totp.currentStep(now);
        expect(totp.verify(secret, totp.codeForStep(secret, step), { now })).toBe(step);
        expect(totp.verify(secret, totp.codeForStep(secret, step - 1), { now })).toBe(step - 1);
        expect(totp.verify(secret, totp.codeForStep(secret, step + 2), { now })).toBeNull();
        expect(totp.verify(secret, totp.codeForStep(secret, step), { now, afterStep: step })).toBeNull();
        expect(totp.verify(secret, 'abcdef', { now })).toBeNull();
        expect(totp.verify(null, '123456', { now })).toBeNull();
    });

    test('secrets round-trip through base32', () => {
        const s = totp.generateSecret();
        expect(s).toMatch(/^[A-Z2-7]{32}$/);
        expect(totp.base32Decode(s)).toHaveLength(20);
    });
});
