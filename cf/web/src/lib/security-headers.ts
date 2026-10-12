// Headers the legacy stack adds in Caddy (see the root Caddyfile) to every
// response. Responses that come from the Worker or its static assets never pass
// Caddy, so they are added here (SSR, via the middleware) and in public/_headers
// (assets). Pass-through responses already carry them from Caddy.
// tests/headers.test.ts keeps public/_headers and this list identical.

export const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

/** Copy of `response` with the security headers set (existing values win). */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
