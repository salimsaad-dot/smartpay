// Thin wrapper around Resend's API, same proven pattern already shipped
// in Academia Hub's own emailSender.js — raw fetch (Node 18+ has it
// built in) rather than pulling in Resend's SDK for one call.
//
// RESEND_FROM_EMAIL defaults to Resend's sandbox sender, which only
// delivers to the account owner's own Resend signup email — real
// delivery to real admins needs a verified domain in Resend, at which
// point this only needs an env var change, no code change.
const RESEND_API_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'SmartPay <onboarding@resend.dev>';

// Never throws — a flaky outbound email must never fail the request that
// triggered it. Every failure mode (missing API key, a bad HTTP response
// from Resend, a network-level exception) is returned as
// { delivered: false } rather than only logged, so forgotPassword can
// tell the frontend the truth via emailDeliveryConfigured instead of a
// blanket "sent" that quietly never arrives.
async function sendEmail({ to, subject, html }) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        console.error('RESEND_API_KEY is not set — email not sent.');
        return { delivered: false };
    }

    try {
        const response = await fetch(RESEND_API_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: process.env.RESEND_FROM_EMAIL || DEFAULT_FROM,
                to,
                subject,
                html,
            }),
        });

        if (!response.ok) {
            const body = await response.text().catch(() => '');
            console.error('Resend API error:', response.status, body);
            return { delivered: false };
        }
        return { delivered: true };
    } catch (error) {
        console.error('Resend request failed:', error);
        return { delivered: false };
    }
}

// Static, not a live probe: true only once a real verified sender is
// configured. Deliberately NOT based on whether any individual send
// succeeded — forgotPassword needs a signal that's identical for every
// request (including the "no account matches" branch, which never
// attempts a send at all) so this can never be used to tell real
// accounts apart from fake ones by comparing responses.
function isEmailDeliveryConfigured() {
    const from = process.env.RESEND_FROM_EMAIL;
    return Boolean(from) && from !== DEFAULT_FROM;
}

async function sendPasswordResetEmail(toEmail, resetLink) {
    return sendEmail({
        to: toEmail,
        subject: 'Reset your SmartPay password',
        html: `
            <p>A password reset was requested for your SmartPay account.</p>
            <p><a href="${resetLink}">Click here to set a new password</a> — this link expires in 30 minutes.</p>
            <p>If you didn't request this, you can safely ignore this email.</p>
        `,
    });
}

module.exports = { sendPasswordResetEmail, isEmailDeliveryConfigured };
