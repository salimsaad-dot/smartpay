// In production this would be a relative path ("/api"), proxied same-origin
// via next.config.mjs's rewrite so sameSite:'lax' cookies work across a
// split frontend/backend deploy. Locally it's the direct absolute backend
// URL — no proxy needed since both dev servers share the "localhost"
// registrable domain.
const API_URL = process.env.NEXT_PUBLIC_API_URL;

const NETWORK_ERROR_MESSAGE = "Couldn't reach the server — check your internet connection and try again.";

// Thin fetch wrapper: auth flows entirely through the httpOnly cookie the
// backend sets on login (credentials: "include") — there's no
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
    // The school was suspended or its subscription lapsed (the backend
    // checks this on every request). Send the person to the login page,
    // which explains why, instead of leaving every page showing errors.
    if (data.code === "SCHOOL_BLOCKED" && typeof window !== "undefined" && window.location.pathname !== "/login") {
      window.location.assign(`/login?blocked=${encodeURIComponent(data.reason || "suspended")}`);
      // Never settles: the page is navigating away, so callers shouldn't
      // flash an error or leave an unhandled rejection on the way out.
      return new Promise(() => {});
    }
    // Signed in with a one-time password from SmartPay: nothing works until
    // the admin sets their own (the backend allows only that).
    if (data.code === "PASSWORD_CHANGE_REQUIRED" && typeof window !== "undefined" && window.location.pathname !== "/dashboard/account") {
      window.location.assign("/dashboard/account");
      return new Promise(() => {});
    }
    throw new Error(data.message || "Something went wrong. Please try again.");
  }

  return data;
}
