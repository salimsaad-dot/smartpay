const crypto = require('crypto');

// Time-based one-time codes (RFC 6238, the 6-digit codes Google
// Authenticator, Microsoft Authenticator and Authy show), for the owner
// console's second login step (added 2026-10-16). Built on Node's crypto
// so there is no extra dependency in the login path.

const STEP_SECONDS = 30;
const DIGITS = 6;
// Accept the previous and next code too, so a phone clock a few seconds
// off (or a code typed just as it changes) still works.
const WINDOW = 1;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
    let bits = 0;
    let value = 0;
    let out = '';
    for (const byte of buffer) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            out += BASE32[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
    return out;
}

function base32Decode(text) {
    const clean = String(text).toUpperCase().replace(/[\s=-]/g, '');
    let bits = 0;
    let value = 0;
    const out = [];
    for (const ch of clean) {
        const index = BASE32.indexOf(ch);
        if (index === -1) throw new Error('Invalid base32 secret');
        value = (value << 5) | index;
        bits += 5;
        if (bits >= 8) {
            out.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(out);
}

// 20 random bytes = 160 bits, the size RFC 4226 recommends.
function generateSecret() {
    return base32Encode(crypto.randomBytes(20));
}

function currentStep(now = Date.now()) {
    return Math.floor(now / 1000 / STEP_SECONDS);
}

function codeForStep(secret, step) {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const number = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
    return String(number).padStart(DIGITS, '0');
}

// Returns the time step the code belongs to, or null. The caller stores the
// step and refuses any code at or before it, so a code can't be reused.
function verify(secret, code, { now = Date.now(), afterStep = null } = {}) {
    const given = String(code || '').replace(/\s/g, '');
    if (!secret || !/^\d{6}$/.test(given)) return null;
    const step = currentStep(now);
    for (let s = step - WINDOW; s <= step + WINDOW; s += 1) {
        if (afterStep !== null && s <= afterStep) continue;
        if (crypto.timingSafeEqual(Buffer.from(codeForStep(secret, s)), Buffer.from(given))) return s;
    }
    return null;
}

function otpauthUri(email, secret) {
    const label = encodeURIComponent(`SmartPay console:${email}`);
    return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent('SmartPay console')}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

module.exports = { generateSecret, currentStep, codeForStep, verify, otpauthUri, base32Encode, base32Decode };
