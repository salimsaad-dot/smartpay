// The contract every payment gateway adapter must implement. Not enforced
// by the language (JS has no interfaces) — documented here so a second
// Ghana payment provider can be dropped in later (utils/<provider>Gateway.js
// implementing the same four functions) without touching controller code
// anywhere. Per the product spec: "Do not hard-code the application around
// one payment provider."
//
//   initializePayment({ email, amountGhs, reference, metadata })
//     => { authorizationUrl, providerReference }
//
//   validateWebhookSignature(rawBody, signatureHeader) => boolean
//
//   parseWebhookEvent(rawBody)
//     => { eventType, reference, status: 'success'|'failed'|'pending', amountGhs, channel, paidAt } | null
//
//   verifyTransaction(reference)
//     => { status: 'success'|'failed'|'pending', amountGhs, channel, paidAt, providerReference }
