// Parent phone numbers are checked when they're saved (2026-10-19). Before,
// any non-empty text was accepted: a surname typed into the phone box saved
// fine, and the mistake only surfaced weeks later as "invalid number" when a
// reminder was sent. Accepts the ways Ghana numbers are usually written:
// 0241234567, 024 123 4567, 024-123-4567, +233 24 123 4567, 233241234567.
// Stored as typed; the SMS adapters normalise at send time.

const PHONE_MESSAGE = 'Enter a valid Ghana phone number, e.g. 024 123 4567.';

function isValidPhone(raw) {
    const text = String(raw || '').trim();
    if (!/^\+?[\d\s\-().]+$/.test(text)) return false; // letters or other symbols
    const digits = text.replace(/\D/g, '');
    return /^0\d{9}$/.test(digits) || /^233\d{9}$/.test(digits);
}

module.exports = { isValidPhone, PHONE_MESSAGE };
