const pool = require('../db');
const opsAlert = require('./opsAlert');

// Failed-login lockout per (account, visitor address) (2026-10-16).
// Before this, 5 wrong passwords from ANYWHERE locked the account for 15
// minutes, and the lock was checked before the password. So a stranger who
// knew a school's admin email (often public) could keep its only admin, or
// the SmartPay owner, locked out indefinitely with 5 guesses every 15
// minutes. Now the stranger only locks out their own address; the real
// admin, logging in from elsewhere, is unaffected.
//
// Guessing is still slow: each address gets 5 tries per 15 minutes per
// account, on top of the per-visitor and per-connection rate limits. If an
// account collects ATTACK_ALERT_THRESHOLD failures from all addresses
// together, the owner is emailed (no lock, so the attack can't become a
// lockout again).

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const ATTACK_ALERT_THRESHOLD = 30;

async function isLocked(scope, accountId, ip) {
    const [[row]] = await pool.query(
        'SELECT locked_until > NOW() AS locked FROM login_attempts WHERE scope = ? AND account_id = ? AND ip = ?',
        [scope, accountId, ip]
    );
    return Boolean(row && Number(row.locked) === 1);
}

// Returns true if this failure just locked the (account, address) pair.
async function recordFailure(scope, accountId, ip, { label } = {}) {
    await pool.query(
        `INSERT INTO login_attempts (scope, account_id, ip, failures) VALUES (?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE
             failures = IF(locked_until IS NOT NULL AND locked_until <= NOW(), 1, failures + 1),
             locked_until = IF(locked_until IS NOT NULL AND locked_until <= NOW(), NULL, locked_until)`,
        [scope, accountId, ip]
    );
    const [[row]] = await pool.query('SELECT id, failures FROM login_attempts WHERE scope = ? AND account_id = ? AND ip = ?', [scope, accountId, ip]);
    let lockedNow = false;
    if (row.failures >= MAX_FAILURES) {
        await pool.query('UPDATE login_attempts SET failures = 0, locked_until = NOW() + INTERVAL ? MINUTE WHERE id = ?', [LOCK_MINUTES, row.id]);
        lockedNow = true;
    }

    const [[{ total }]] = await pool.query(
        'SELECT COALESCE(SUM(failures), 0) + 5 * SUM(locked_until > NOW()) AS total FROM login_attempts WHERE scope = ? AND account_id = ? AND updated_at > NOW() - INTERVAL 1 HOUR',
        [scope, accountId]
    );
    if (Number(total) >= ATTACK_ALERT_THRESHOLD) {
        await opsAlert.alertOwner(`login-attack:${scope}:${accountId}`, 'Many failed logins on one account', [
            `${label || `${scope} account ${accountId}`}: about ${total} failed attempts in the last hour from several addresses.`,
            'The real user can still log in from their own device. If this keeps up, consider changing the password.',
        ]);
    }
    return lockedNow;
}

async function clearFailures(scope, accountId, ip) {
    await pool.query('DELETE FROM login_attempts WHERE scope = ? AND account_id = ? AND ip = ?', [scope, accountId, ip]);
}

module.exports = { isLocked, recordFailure, clearFailures, MAX_FAILURES, LOCK_MINUTES };
