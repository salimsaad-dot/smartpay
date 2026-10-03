// A school's unique slug — will likely appear in public URLs once the
// no-account parent payment-link flow exists, so the rules are decided
// now rather than retrofitted once real schools (and their links) exist.
const RESERVED_CODES = new Set([
    'admin', 'api', 'www', 'app', 'dashboard', 'login', 'register',
    'auth', 'public', 'smartpay', 'static', 'assets',
]);

const CODE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isValidCode(code) {
    if (typeof code !== 'string') return false;
    const c = code.toLowerCase();
    if (c.length < 3 || c.length > 30) return false;
    if (!CODE_PATTERN.test(c)) return false;
    if (RESERVED_CODES.has(c)) return false;
    return true;
}

// Simple slugify for the signup form's live name→code suggestion — the
// user can still edit the result before submitting, so this doesn't need
// to be perfect, just a reasonable starting point.
function slugify(name) {
    return String(name || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 30)
        .replace(/-$/, '');
}

module.exports = { isValidCode, slugify, RESERVED_CODES };
