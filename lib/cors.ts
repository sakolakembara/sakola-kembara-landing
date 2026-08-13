import "server-only";
import { env } from "@/lib/env";

// Small CORS helper shared by the /api/auth/* SSO endpoints. Not a
// framework — just enough to answer preflight and stamp the right
// Access-Control-* headers on responses to the LMS Nuxt front end.
//
// Allowed origins are declared in SSO_ALLOWED_ORIGINS (comma-separated).
// A request from an origin NOT in that list gets no CORS headers at all,
// which the browser translates into "blocked by CORS" on the caller side.
// We never wildcard because these endpoints ship credentials.

const CORS_METHODS = "GET, POST, OPTIONS";
const CORS_HEADERS = "Content-Type";
const CORS_MAX_AGE = "86400"; // 24h preflight cache

function allowedOrigins(): string[] {
  return (env.SSO_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Origin allow-list check for state-changing requests (POST /register,
 * /signout). CORS alone only blocks the *browser from reading* the
 * response — the Set-Cookie header still lands in the victim's cookie
 * jar, which is a classic login-CSRF surface for endpoints that mint a
 * session on behalf of the caller.
 *
 * Rules:
 * - No Origin header: reject. Legitimate browser calls always send one
 *   on POST; anything else is a server-to-server call that has no
 *   business at these endpoints (and isn't the LMS integration path).
 * - Origin present but not allow-listed: reject.
 * - Origin missing AND SSO_ALLOWED_ORIGINS unset: allow. This is the
 *   "dev without vendor configured" escape hatch — otherwise curl-based
 *   local testing needs an Origin header for no good reason.
 */
export function isOriginAllowedForStateChange(request: Request): boolean {
  const origins = allowedOrigins();
  const origin = request.headers.get("origin");
  if (origins.length === 0) {
    // No allow-list configured — dev / unconfigured deploy. Skip the check
    // so local tooling still works. Production MUST set SSO_ALLOWED_ORIGINS.
    return true;
  }
  if (!origin) return false;
  return origins.includes(origin);
}

/**
 * Returns the CORS headers to add to a response, or an empty object when
 * the incoming Origin isn't allowed. Callers spread the returned object
 * into their Response constructor.
 */
export function corsHeadersFor(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin) return {};
  if (!allowedOrigins().includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": CORS_METHODS,
    "Access-Control-Allow-Headers": CORS_HEADERS,
    "Access-Control-Max-Age": CORS_MAX_AGE,
    Vary: "Origin",
  };
}

/**
 * Standard preflight response. Route handlers export
 * `export const OPTIONS = optionsPreflight;` — no extra boilerplate.
 */
export function optionsPreflight(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeadersFor(request),
  });
}
