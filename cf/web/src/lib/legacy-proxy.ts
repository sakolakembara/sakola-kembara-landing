// Forwarding a request to the legacy Next app (the "old origin").
//
// Production (Workers ROUTES mode, route covers the whole site): the Worker
// runs in front of the origin on the same hostname. `fetch()` of the same URL
// from inside the Worker is sent to the origin, not back into the Worker, so
// no origin hostname is configured anywhere. LEGACY_ORIGIN_URL stays unset.
//
// Local runs: LEGACY_ORIGIN_URL points at a stand-in origin (see
// scripts/stub-origin.mjs) and the request is re-aimed at it.
//
// Only the standard Fetch API is used, so the pure helpers are unit tested in
// Node (tests/legacy.test.ts); the real hop through workerd is covered by
// scripts/e2e.mjs.

/** RFC 9110 / 7230 hop-by-hop headers: meaningful for one connection only. */
export const HOP_BY_HOP_HEADERS = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
] as const;

/** URL the forwarded request goes to: same path and query on the origin (or on the same host in route mode). */
export function legacyTarget(requestUrl: string, originBase?: string): string {
  const url = new URL(requestUrl);
  if (!originBase) return url.toString();
  const base = new URL(originBase);
  return new URL(`${url.pathname}${url.search}`, base).toString();
}

/**
 * Headers for the forwarded request: everything the client sent (cookies and
 * authorization included) minus hop-by-hop headers and anything the
 * `Connection` header names. Locally the original host is passed on as
 * X-Forwarded-*, because the URL host is the stand-in origin.
 */
export function forwardRequestHeaders(
  incoming: Headers,
  opts: { requestUrl: string; local: boolean },
): Headers {
  const headers = new Headers(incoming);
  stripHopByHop(headers);
  if (opts.local) {
    const url = new URL(opts.requestUrl);
    headers.set('x-forwarded-host', incoming.get('host') ?? url.host);
    headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
  }
  return headers;
}

/** Remove hop-by-hop headers, and any header the Connection header lists. */
export function stripHopByHop(headers: Headers): void {
  const named = (headers.get('connection') ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  for (const name of [...HOP_BY_HOP_HEADERS, ...named]) headers.delete(name);
}

/**
 * Local only: the stand-in origin may answer with absolute Location URLs on
 * its own host. Point them back at the host the browser used.
 */
export function rewriteLocation(location: string, originBase: string, requestUrl: string): string {
  const origin = new URL(originBase).origin;
  if (!location.startsWith(origin)) return location;
  return `${new URL(requestUrl).origin}${location.slice(origin.length)}`;
}

/**
 * Send the request to the legacy origin and return its answer untouched:
 * status, headers (several Set-Cookie included) and body stream. Redirects are
 * NOT followed, so a 307 to /login reaches the browser, not the Worker.
 */
export async function forwardToLegacy(request: Request, originBase?: string): Promise<Response> {
  const local = Boolean(originBase);
  const target = legacyTarget(request.url, originBase);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

  const upstream = await fetch(target, {
    method: request.method,
    headers: forwardRequestHeaders(request.headers, { requestUrl: request.url, local }),
    body: hasBody ? request.body : undefined,
    redirect: 'manual',
  });

  const response = new Response(upstream.body, upstream);
  stripHopByHop(response.headers);
  const location = response.headers.get('location');
  if (local && location && originBase) {
    response.headers.set('location', rewriteLocation(location, originBase, request.url));
  }
  return response;
}
