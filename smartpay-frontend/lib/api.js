// In production this would be a relative path ("/api"), proxied same-origin
// via next.config.mjs's rewrite so sameSite:'lax' cookies work across a
// split frontend/backend deploy. Locally it's the direct absolute backend
// URL — no proxy needed since both dev servers share the "localhost"
// registrable domain.
const API_URL = process.env.NEXT_PUBLIC_API_URL;

const NETWORK_ERROR_MESSAGE = "Couldn't reach the server — check your internet connection and try again.";

// Thin fetch wrapper: auth flows entirely through the httpOnly cookie the
// backend sets on login/register (credentials: "include") — there's no
// token this code ever sees or could leak to an XSS payload.
export async function apiRequest(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(NETWORK_ERROR_MESSAGE);
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.message || "Something went wrong. Please try again.");
  }

  return data;
}
