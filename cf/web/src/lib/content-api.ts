// Loader for the public content API (docs/cloudflare/content-api.md), shared by the SSR pages
// that read it: /tim, /laporan and /gabung-siswa/docs. One implementation of the timeout,
// the Workers Cache API (`caches.default`) and stale-if-error, so the pages cannot drift:
//
//   1. fresh copy in the cache (default TTL 60 s)             -> source "cache"
//   2. else fetch the API, 2 s timeout                        -> source "network", stored fresh + stale
//   3. API down / slow / invalid: last good copy (7 days)     -> source "stale"; it is also re-stored
//      as "fresh" for 30 s, so an outage costs one 2 s wait per 30 s, not one per request
//   4. nothing at all                                         -> source "empty", data null (the page
//      shows its degraded state, see contentPageHeaders)
//
// Cache keys are synthetic URLs: `${base}${path}` (fresh) and `${base}${path}?copy=stale`.
// The admin save that purges a list deletes the fresh key (`cache.delete(new Request(url))`);
// the stale copy is only ever read after a failed fetch, and is overwritten by the next good one.
//
// Cache and fetch are injected so the logic is unit tested in Node with fakes
// (tests/team.test.ts, tests/content-api.test.ts). On a real zone the Cache API only works on
// custom domains/routes, not on *.workers.dev.

export type ContentSource = 'network' | 'cache' | 'stale' | 'empty';
export interface ContentResult<T> {
  /** The parsed payload, or null when there is none to show (API down and nothing cached). */
  data: T | null;
  source: ContentSource;
}

export interface ContentRuntime {
  /** CONTENT_API_URL, no trailing slash needed. Unset -> source "empty". */
  baseUrl: string | undefined;
  /** caches.default when the runtime has it. */
  cache?: Pick<Cache, 'match' | 'put'>;
  /** ctx.waitUntil, so cache writes do not delay the response. */
  waitUntil?: (promise: Promise<unknown>) => void;
  /** Seconds a fetched list is served from the cache before the API is asked again (default 60). */
  freshTtlSeconds?: number;
}

export interface ContentLoaderOptions<T> extends ContentRuntime {
  /** Path below the base URL, e.g. "/api/public/reports". */
  path: string;
  /** Payload -> data. Null means "not a valid payload": treated as an API failure. */
  parse: (payload: unknown) => T | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** How long the last good copy is kept for stale-if-error. */
  staleTtlSeconds?: number;
  /** How long a stale copy is re-served as "fresh" after a failed fetch. */
  outageTtlSeconds?: number;
}

/** What a list loader (loadTeam, loadReports, loadResources) takes: the options minus its own path and parser. */
export type ContentCallOptions<T> = Omit<ContentLoaderOptions<T>, 'path' | 'parse'>;

/** Edge freshness of the list pages: the contract's `s-maxage` for team, reports and resources. */
export const CONTENT_FRESH_SECONDS = 60;

export async function loadContent<T>(opts: ContentLoaderOptions<T>): Promise<ContentResult<T>> {
  const {
    baseUrl,
    path,
    parse,
    cache,
    waitUntil,
    fetchImpl = fetch,
    timeoutMs = 2000,
    freshTtlSeconds = CONTENT_FRESH_SECONDS,
    staleTtlSeconds = 60 * 60 * 24 * 7,
    outageTtlSeconds = 30,
  } = opts;

  if (!baseUrl) return { data: null, source: 'empty' };
  const url = `${baseUrl.replace(/\/+$/, '')}${path}`;
  // Nothing is ever fetched from the "stale" key.
  const freshKey = new Request(url);
  const staleKey = new Request(`${url}?copy=stale`);

  const read = async (key: Request): Promise<{ data: T; text: string } | null> => {
    try {
      const hit = await cache?.match(key);
      if (!hit) return null;
      const text = await hit.text();
      const data = parse(JSON.parse(text));
      return data === null ? null : { data, text };
    } catch {
      return null;
    }
  };

  const write = (key: Request, text: string, ttl: number) => {
    if (!cache) return;
    return cache
      .put(
        key,
        new Response(text, {
          headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttl}` },
        }),
      )
      .catch(() => undefined);
  };

  const background = async (jobs: (Promise<unknown> | undefined)[]) => {
    const all = Promise.all(jobs.filter(Boolean)).catch(() => undefined);
    if (waitUntil) waitUntil(all);
    else await all;
  };

  const fresh = await read(freshKey);
  if (fresh) return { data: fresh.data, source: 'cache' };

  try {
    const res = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`content API answered ${res.status}`);
    const text = await res.text();
    const data = parse(JSON.parse(text));
    if (data === null) throw new Error('content API payload has the wrong shape');
    await background([write(freshKey, text, freshTtlSeconds), write(staleKey, text, staleTtlSeconds)]);
    return { data, source: 'network' };
  } catch {
    const stale = await read(staleKey);
    if (!stale) return { data: null, source: 'empty' };
    await background([write(freshKey, stale.text, outageTtlSeconds)]);
    return { data: stale.data, source: 'stale' };
  }
}

/**
 * The loader's runtime inputs for a page: base URL and fresh window from the Worker env, the
 * default cache, and `waitUntil` of the request context. `CONTENT_CACHE_FRESH_SECONDS` tunes the
 * fresh window (default 60, tests set 2).
 */
export function contentRuntime(
  env: { CONTENT_API_URL?: string; CONTENT_CACHE_FRESH_SECONDS?: string },
  ctx: { waitUntil(promise: Promise<unknown>): void },
): ContentRuntime {
  return {
    baseUrl: env.CONTENT_API_URL,
    cache: typeof caches !== 'undefined' ? caches.default : undefined,
    waitUntil: (p) => ctx.waitUntil(p),
    freshTtlSeconds: Number(env.CONTENT_CACHE_FRESH_SECONDS) || undefined,
  };
}

/**
 * Headers of a page built from a content list. `s-maxage` is the contract's (60 s, then one stale
 * answer while it refetches); `max-age=0` keeps browsers from holding a copy past an admin save.
 * Stale data is told to be cached only briefly. With nothing to show (API down, cold cache) the
 * page is a 503 that must not be cached anywhere, with `Retry-After`, so a crawler keeps the
 * version it already has instead of indexing an empty page.
 */
export function contentPageHeaders(source: ContentSource): { status: number; headers: Record<string, string> } {
  switch (source) {
    case 'network':
    case 'cache':
      return { status: 200, headers: { 'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' } };
    case 'stale':
      return { status: 200, headers: { 'cache-control': 'public, max-age=0, s-maxage=30' } };
    default:
      return { status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '30' } };
  }
}

/** Helpers for list payloads that cross a network: tolerant by design, a bad entry is dropped. */
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
export const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** `{ [key]: [...] }` or a bare array -> the array; anything else null. */
export const listOf = (payload: unknown, key: string): unknown[] | null => {
  const list = Array.isArray(payload) ? payload : isRecord(payload) ? payload[key] : undefined;
  return Array.isArray(list) ? list : null;
};

/**
 * A file path from the API, used as an `href` as it is (the Astro site never proxies uploads):
 * a root-relative path (`/reports/...`) or an absolute http(s) URL. Anything else (a scheme such
 * as `javascript:`, a protocol-relative `//host`, a backslash, a control character) is null.
 */
export function fileHref(value: unknown): string | null {
  const v = str(value);
  if (!v) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(v)) return null;
  if (v.startsWith('/')) return v.startsWith('//') ? null : v;
  return /^https?:\/\/[^/]/i.test(v) ? v : null;
}

/** An external link of a resource: http(s) only. */
export function externalHref(value: unknown): string | null {
  const v = str(value)?.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:' ? v : null;
  } catch {
    return null;
  }
}
