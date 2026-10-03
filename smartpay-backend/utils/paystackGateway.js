const crypto = require('crypto');

const PAYSTACK_API_URL = 'https://api.paystack.co';

function mapChannel(channel) {
    if (channel === 'mobile_money') return 'mobile_money';
    if (channel === 'bank' || channel === 'bank_transfer') return 'bank_transfer';
    if (channel === 'card') return 'card';
    return 'other';
}

// Starts a Paystack transaction server-side (so the reference and metadata
// are ours, not client-suppliable) and returns what the frontend needs to
// redirect the parent to Paystack's hosted checkout. Amount is in
// kobo/pesewas (Paystack's smallest-unit convention) — callers pass GHS,
// this does the ×100. Same proven pattern as Academia Hub's
// utils/paystackClient.js, extended with verifyTransaction/parseWebhookEvent
// for SmartPay's provider-agnostic PaymentGateway contract.
async function initializePayment({ email, amountGhs, reference, metadata, callbackUrl }) {
    const apiKey = process.env.PAYSTACK_SECRET_KEY;
    if (!apiKey) {
        throw { status: 500, message: 'Payment gateway is not configured.' };
    }

    const response = await fetch(`${PAYSTACK_API_URL}/transaction/initialize`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            email,
            amount: Math.round(amountGhs * 100),
            reference,
            currency: 'GHS',
            metadata,
            callback_url: callbackUrl,
        }),
    });

    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.status) {
        console.error('Paystack initialize error:', response.status, body);
        throw { status: 502, message: 'Could not start payment with Paystack — try again in a moment.' };
    }

    return { authorizationUrl: body.data.authorization_url, providerReference: body.data.reference };
}

// Paystack signs every webhook body with HMAC-SHA512 of the RAW request
// bytes, using the secret key — this is the only thing that distinguishes
// a real Paystack webhook from anyone POSTing a fake "payment succeeded"
// body at this public, unauthenticated endpoint. Never trust a webhook
// payload without this check passing first.
function validateWebhookSignature(rawBody, signatureHeader) {
    const apiKey = process.env.PAYSTACK_SECRET_KEY;
    if (!apiKey || !signatureHeader || !rawBody) return false;

    const expected = crypto.createHmac('sha512', apiKey).update(rawBody).digest('hex');
    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(signatureHeader);
    return expectedBuf.length === providedBuf.length && crypto.timingSafeEqual(expectedBuf, providedBuf);
}

// Only ever called after validateWebhookSignature has already passed —
// the signature is what makes this payload trustworthy, not a second
// server-to-server verify call (matches Academia Hub's already-shipped,
// pentested pattern: see smartpay/DESIGN.md's Decisions Log for why a
// redundant verify() round-trip isn't required here).
//
// Only charge events are recognized — Paystack sends many other event
// types (disputes, transfers, refunds, subscriptions) that can also carry
// a `data.reference`, and none of them describe "did this charge succeed
// or fail." Without this allowlist, an unrelated event could be
// misinterpreted as a charge update for a payment that happens to share
// its reference value.
const RECOGNIZED_CHARGE_EVENTS = new Set(['charge.success', 'charge.failed']);

function parseWebhookEvent(rawBody) {
    let event;
    try {
        event = JSON.parse(rawBody);
    } catch {
        return null;
    }
    if (!RECOGNIZED_CHARGE_EVENTS.has(event?.event) || !event?.data?.reference) return null;

    const statusMap = { success: 'success', failed: 'failed', abandoned: 'cancelled' };
    return {
        eventType: event.event,
        reference: event.data.reference,
        status: statusMap[event.data.status] || 'pending',
        amountGhs: Number(event.data.amount) / 100,
        channel: mapChannel(event.data.channel),
        paidAt: event.data.paid_at ? new Date(event.data.paid_at) : new Date(),
    };
}

// Server-to-server status check, independent of any webhook delivery —
// used by the public payment-status endpoint so a parent waiting on the
// success page isn't stuck if the webhook is delayed (a real, spec-listed
// edge case: "Payment redirect succeeds but webhook arrives later").
async function verifyTransaction(reference) {
    const apiKey = process.env.PAYSTACK_SECRET_KEY;
    if (!apiKey) {
        throw { status: 500, message: 'Payment gateway is not configured.' };
    }

    const response = await fetch(`${PAYSTACK_API_URL}/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.status) {
        throw { status: 502, message: 'Could not check payment status with Paystack.' };
    }

    const statusMap = { success: 'success', failed: 'failed', abandoned: 'cancelled' };
    const data = body.data;
    return {
        status: statusMap[data.status] || 'pending',
        amountGhs: Number(data.amount) / 100,
        channel: mapChannel(data.channel),
        paidAt: data.paid_at ? new Date(data.paid_at) : null,
        providerReference: data.reference,
    };
}

module.exports = { initializePayment, validateWebhookSignature, parseWebhookEvent, verifyTransaction };
