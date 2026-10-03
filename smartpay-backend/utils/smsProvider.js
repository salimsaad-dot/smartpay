// The contract every SMS provider adapter must implement — same reasoning
// as utils/paymentGateway.js in Phase 5: documented here so a second SMS
// provider can be dropped in later without touching controller code.
//
//   sendSms(to, message)
//     => { success: boolean, providerMessageId: string|null, error: string|null }
//
//   normalizePhoneNumber(raw) => string|null (null if it can't be resolved
//     to a usable number — the caller must treat this as "don't attempt
//     to send", not as something to send anyway and let the provider fail)
//
//   validateConfiguration() => boolean
