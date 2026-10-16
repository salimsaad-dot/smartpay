// Checks SmartPay's settings when the server starts (added 2026-10-16,
// council fix list). Before this the app started half-configured and
// failed later, quietly: a missing JWT_SECRET made every login error while
// /api/health still said "running", and a typo in SMS_PROVIDER silently fell
// back to mNotify.
//
// errors: the server refuses to start (server.js), so on Render the deploy
// fails and the previous version keeps serving. warnings: logged, the
// server starts (a feature is off, e.g. online payments without a Paystack
// key). "Deployed" means Render (which sets RENDER=true) or
// NODE_ENV=production; some settings only matter there.

const SMS_PROVIDERS = ['mnotify', 'arkesel'];
const SMS_KEYS = { mnotify: 'MNOTIFY_API_KEY', arkesel: 'ARKESEL_API_KEY' };

function checkConfig(env = process.env) {
    const deployed = env.NODE_ENV === 'production' || env.RENDER === 'true';
    const has = (key) => Boolean((env[key] || '').trim());
    const errors = [];
    const warnings = [];
    const need = (key, why) => { if (!has(key)) errors.push(`${key} is not set: ${why}.`); };
    const want = (key, effect) => { if (!has(key)) warnings.push(`${key} is not set: ${effect}.`); };

    need('JWT_SECRET', 'it signs every login');
    need('DB_HOST', 'needed to reach the database');
    need('DB_USER', 'needed to reach the database');
    need('DB_NAME', 'needed to reach the database');
    if (has('JWT_SECRET') && env.JWT_SECRET.trim().length < 32) {
        warnings.push('JWT_SECRET is shorter than 32 characters; use a long random value.');
    }

    const provider = (env.SMS_PROVIDER || 'mnotify').trim().toLowerCase();
    if (!SMS_PROVIDERS.includes(provider)) {
        errors.push(`SMS_PROVIDER "${env.SMS_PROVIDER}" is not recognised (use ${SMS_PROVIDERS.join(' or ')}).`);
    } else {
        want(SMS_KEYS[provider], `no SMS can be sent through ${provider}`);
    }

    if (deployed) {
        need('FRONTEND_URL', 'payment and password-reset links are built from it');
        need('CRON_SECRET', 'the scheduled jobs (Friday reminders, payment reconciliation, backups) authenticate with it');
    }
    want('PAYSTACK_SECRET_KEY', 'online payments through payment links are off');
    want('RESEND_API_KEY', 'no email (password resets, alerts, demo requests) can be sent');
    want('GEMINI_API_KEY', 'the AI financial summary is off');
    if (!has('OPS_ALERT_EMAIL') && !has('DEMO_NOTIFY_EMAIL')) {
        warnings.push('Neither OPS_ALERT_EMAIL nor DEMO_NOTIFY_EMAIL is set: problem alerts go only to the logs.');
    }

    return { deployed, errors, warnings };
}

module.exports = { checkConfig };
