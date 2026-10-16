// Who is really making a request, behind SmartPay's proxies (2026-10-16).
//
// Measured on the live stack (temporary /api/public/whoami): requests reach
// Express as  visitor -> [Vercel rewrite] -> Cloudflare -> Render's load
// balancer -> app. With trust proxy 1, req.ip was Render's INTERNAL address
// (10.x) for every request, so every parent, every school's staff and every
// bot shared a handful of rate-limit buckets (30 junk requests could block
// all checkouts) and the audit log recorded 10.x for everyone.
//
// What each header holds (and whether a caller can fake it):
//   cf-connecting-ip      Set by Cloudflare to whoever connected to it.
//                         Can't be faked: Cloudflare answers 403 if a request
//                         carries its own. Through Vercel it's Vercel's
//                         server, not the visitor.
//   x-vercel-proxied-for  Set by Vercel to the real visitor on requests
//                         through the frontend's /api rewrite; Vercel
//                         overwrites any value the visitor sends. A caller
//                         going straight to Render CAN fake it.
//   x-forwarded-for       Visitor-supplied entries come first, so its first
//                         entry can always be faked.
//
// So: clientIp() is the best guess at the visitor (used for per-visitor rate
// limits and the audit log), and connectionIp() is the one address nobody can
// fake (used for the per-connection cap in server.js, which stops a direct
// caller from dodging the per-visitor limits with made-up headers).

function header(req, name) {
    const value = req.headers[name];
    return (Array.isArray(value) ? value[0] : value || '').split(',')[0].trim() || null;
}

function connectionIp(req) {
    return header(req, 'cf-connecting-ip') || req.ip;
}

function clientIp(req) {
    return header(req, 'x-vercel-proxied-for') || header(req, 'x-forwarded-for') || connectionIp(req);
}

module.exports = { clientIp, connectionIp };
