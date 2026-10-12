// The shortlink redirect: `sakolakembara.org/<slug>` to wherever an admin pointed it.
//
// Where it runs: the catch-all route (src/pages/[...path].astro), AFTER every real page, legacy path, redirect rule
// and static file has had its chance (Astro, the assets layer and the middleware all answer those first). A single
// segment that fits the slug grammar and reaches the catch-all is looked up through the API Worker; anything else is
// the site's 404. The names a shortlink may never take are refused when it is created (the admin's reserved list:
// cf/admin/src/shortlinks/reserved.ts), because nothing here would ever see them.
//
// One call per visit, never cached. The API's `GET /api/public/shortlinks/{slug}` finds the target AND counts the
// click (in `waitUntil`, after it has decided its answer), so this side does one fetch and no write. A cache here
// would swallow clicks (a hit never reaches the API) and would keep a link that was switched off or repointed alive
// for its TTL; the D1 read it would save is a few rows, the budget that matters is writes (docs/cloudflare/admin-konten.md).
//
// The redirect is a 307, not a 308: a slug can be repointed at any time and a permanent redirect would be kept by
// browsers long past that edit (legacy decision, docs/architecture/shortlinks.md).
//
// Pure and injectable like lib/content-api.ts: the fetch is passed in, so it is unit tested in Node (tests/shortlink.test.ts).

export const SHORTLINK_API_PATH = '/api/public/shortlinks';

/** How long the API gets to answer before the visitor is told to come back (the content API's own limit). */
export const SHORTLINK_TIMEOUT_MS = 2000;

export type ShortlinkResult =
  /** Send the visitor on. `target` is a path of this site or an http(s) URL, checked. */
  | { kind: 'redirect'; target: string }
  /** Unknown or switched off: the site's 404. The API does not say which, and neither does the site. */
  | { kind: 'not_found' }
  /** The API could not answer (down, slow, a wrong answer): a 503, never a 404, so a working link is not made to look dead. */
  | { kind: 'unavailable'; reason: string };

/**
 * A target this site may redirect to: a path with a single leading slash, or an http(s) URL, with no control
 * character and no backslash. The same rule as `isSafeTarget` in cf/admin/src/shortlinks/rules.ts (the admin never
 * stores anything else); applied again here so a row written by anything but the admin cannot become an open redirect
 * (`/\evil.example` and `/<tab>/evil.example` are `//evil.example` to a browser).
 */
export function isSafeTarget(target: string): boolean {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(target)) return false;
  if (target.startsWith('/')) return !target.startsWith('//');
  try {
    const { protocol } = new URL(target);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** `{ shortlink: { targetUrl } }` to the target, or null when the payload is not that or the target is not safe. */
export function parseShortlinkPayload(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const shortlink = (payload as { shortlink?: unknown }).shortlink;
  if (typeof shortlink !== 'object' || shortlink === null) return null;
  const target = (shortlink as { targetUrl?: unknown }).targetUrl;
  return typeof target === 'string' && target !== '' && isSafeTarget(target) ? target : null;
}

export interface ShortlinkRuntime {
  /** Where the API is (lib/api-client.ts: CONTENT_API_URL locally, the placeholder host of the service binding in production). Unset: unavailable. */
  baseUrl: string | undefined;
  /** How a request is made; the binding's `fetch` in production. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Why a lookup failed, in fixed words, for the Worker log. Never the slug, a body or a URL. */
  onFailure?: (reason: string) => void;
}

/**
 * Looks one slug up. `slug` must already be a candidate (lower case, the grammar: `isShortlinkCandidate`), which
 * is what keeps `%2F`, `..` and a query out of the path built here.
 */
export async function resolveShortlink(slug: string, runtime: ShortlinkRuntime): Promise<ShortlinkResult> {
  const { baseUrl, fetchImpl = fetch, timeoutMs = SHORTLINK_TIMEOUT_MS, onFailure } = runtime;
  const fail = (reason: string): ShortlinkResult => {
    onFailure?.(reason);
    return { kind: 'unavailable', reason };
  };
  if (!baseUrl) return fail('no API configured');

  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}${SHORTLINK_API_PATH}/${slug}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return fail(error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout' : 'failed');
  }

  if (res.status === 404) {
    // Only the contract's own 404 is an answer. Any other 404 (an HTML page, other JSON) is a wrong base URL or a
    // proxy in the way: an outage, so it can never make every shortlink look deleted.
    const body: unknown = await res.json().catch(() => null);
    if (typeof body === 'object' && body !== null && (body as { error?: unknown }).error === 'not_found') return { kind: 'not_found' };
    return fail('status 404 without the not_found body');
  }
  if (!res.ok) return fail(`status ${res.status}`);

  const target = parseShortlinkPayload(await res.json().catch(() => null));
  return target === null ? fail('invalid payload') : { kind: 'redirect', target };
}

/** The 307 the visitor gets. Not cacheable: the next visit must reach the API (the click is counted there). */
export function redirectResponse(target: string): Response {
  return new Response(null, { status: 307, headers: { location: target, 'cache-control': 'no-store' } });
}

/** The 503 for a lookup that could not be made: plain text, never cached, with the same Retry-After the content pages give. */
export function unavailableResponse(): Response {
  return new Response('Tautan ini belum dapat dibuka saat ini. Silakan coba lagi beberapa saat lagi.', {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '30', 'x-robots-tag': 'noindex' },
  });
}
