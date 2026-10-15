// Headers the legacy stack adds in Caddy (see the root Caddyfile) to every
// response. Responses that come from the Worker or its static assets never pass
// Caddy, so they are added here (SSR, via the middleware) and in public/_headers
// (assets). Pass-through responses are the origin's (WordPress) and are left untouched,
// whatever headers it sends.
// tests/headers-sitemap.test.ts keeps public/_headers and this list identical, and the Caddyfile's
// four other headers equal to these (the Caddyfile's HSTS is the one deliberate difference, below).
//
// HSTS is STAGED (SAKEM-103; F-01 and D-04 of docs/cloudflare/cutover-runbook.md; P-19): the Caddyfile's
// `max-age=31536000; includeSubDomains; preload` would commit every subdomain of the domain (the hosting's webmail and
// cPanel included) to HTTPS for a year in each browser that saw it, and would make a rollback to anything without a
// valid certificate for the apex impossible. So the Worker sends five minutes, with NO `includeSubDomains` and NO
// `preload`, and the value is raised in steps after the cutover (X-07 of the runbook, docs/cloudflare/web-skeleton.md,
// "HSTS in steps"): that is a change of THIS value and of the same line of public/_headers, in one PR.

export const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=300',
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
