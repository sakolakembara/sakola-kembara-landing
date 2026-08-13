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
