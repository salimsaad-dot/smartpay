/** @type {import('next').NextConfig} */
const nextConfig = {
  // Proxies /api/* to the backend server-side, so the browser only ever
  // sees one origin. Without this, sameSite:'lax' cookies silently stop
  // being sent once frontend/backend are deployed on different domains —
  // see smartpay-backend/controllers/authController.js's authCookieOptions
  // for the matching server-side half. No-ops locally (NEXT_PUBLIC_API_ORIGIN
  // unset in .env.local), where frontend and backend already share the
  // "localhost" registrable domain.
  async rewrites() {
    const backendOrigin = process.env.NEXT_PUBLIC_API_ORIGIN;
    if (!backendOrigin) return [];

    return [
      {
        source: "/api/:path*",
        destination: `${backendOrigin}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
