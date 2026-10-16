// Loader for the public content API (docs/cloudflare/content-api.md), shared by the SSR pages
// that read it: /tim, /donasi (its Laporan section), /gabung-siswa/docs and the blog. One implementation of the timeout,
// the Workers Cache API (`caches.default`) and stale-if-error, so the pages cannot drift:
//
//   1. fresh copy in the cache (default TTL 60 s)             -> source "cache"
//   2. else fetch the API, 2 s timeout                        -> source "network", stored fresh + stale
//   3. API down / slow / invalid: last good copy (7 days)     -> source "stale"; it is also re-stored
//      as "fresh" for 30 s, so an outage costs one 2 s wait per 30 s, not one per request
//   4. nothing at all                                         -> source "empty", data null (the page
//      shows its degraded state, see contentPageHeaders)
//
// A resource that can be missing (a blog article) opts in with `notFoundTtlSeconds`: the contract's
// `404 {"error":"not_found"}` is then an answer, not a failure: source "not_found", data null,
// remembered for that many seconds (so probing cannot hammer the API) and the stale copy is dropped
// (an outage after an unpublish must not bring the article back). A 404 with any other body (a wrong
// base URL, a proxy page) stays a failure, so it can never make a page look deleted.
//
// Cache keys are synthetic URLs: `${base}${path}` (fresh) and `${base}${path}?copy=stale`
// (`&copy=stale` when the path has a query).
// The admin save that purges a list deletes the fresh key (`cache.delete(new Request(url))`);
// the stale copy is only ever read after a failed fetch, and is overwritten by the next good one.
//
// Cache and fetch are injected so the logic is unit tested in Node with fakes
// (tests/team.test.ts, tests/content-api.test.ts). On a real zone the Cache API only works on
// custom domains/routes, not on *.workers.dev.
//
// Where the API is, and how it is called (the `API` service binding in production, CONTENT_API_URL
// locally and in CI) is decided once, in lib/api-client.ts, and handed in through `contentRuntime`.

import { contentApiTarget, type ApiEnv } from './api-client';

export type ContentSource = 'network' | 'cache' | 'stale' | 'empty' | 'not_found';
export interface ContentResult<T> {
  /** The parsed payload, or null when there is none to show (API down and nothing cached, or not found). */
  data: T | null;
  source: ContentSource;
}

export interface ContentRuntime {
  /**
   * Where the API is, no trailing slash needed: CONTENT_API_URL (local/CI), or the placeholder host of the
   * `API` service binding (the binding ignores it, only the path counts). Unset -> source "empty".
   */
  baseUrl: string | undefined;
  /**
   * How a request is made. Unset: the global `fetch` (right for a URL). With the service binding it is the
   * binding's `fetch` (`contentApiTarget`), the only way production reaches the API.
   */
  fetchImpl?: typeof fetch;
  /** caches.default when the runtime has it. `delete` is only needed with `notFoundTtlSeconds`. */
  cache?: Pick<Cache, 'match' | 'put'> & Partial<Pick<Cache, 'delete'>>;
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
  timeoutMs?: number;
  /** How long the last good copy is kept for stale-if-error. */
  staleTtlSeconds?: number;
  /** How long a stale copy is re-served as "fresh" after a failed fetch. */
  outageTtlSeconds?: number;
  /** Set to treat the contract's 404 `{"error":"not_found"}` as "not found" and remember it this long (the blog uses 30). */
  notFoundTtlSeconds?: number;
  /** What is stored in the cache for a payload (default: the response text as it came). The blog stores the parsed value, which drops `contentMarkdown`. */
  serialize?: (data: T) => string;
  /** Why a fetch failed, in fixed words (`status 500`, `timeout`, `invalid payload`), for the Worker log. Never a body or a URL. */
  onFailure?: (reason: string) => void;
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
    notFoundTtlSeconds,
    serialize,
    onFailure,
  } = opts;

  if (!baseUrl) return { data: null, source: 'empty' };
  const url = `${baseUrl.replace(/\/+$/, '')}${path}`;
  // Nothing is ever fetched from the "stale" key.
  const freshKey = new Request(url);
  const staleKey = new Request(`${url}${url.includes('?') ? '&' : '?'}copy=stale`);

  type Hit = { kind: 'ok'; data: T; text: string } | { kind: 'not_found' };
  const read = async (key: Request): Promise<Hit | null> => {
    try {
      const hit = await cache?.match(key);
      if (!hit) return null;
      const text = await hit.text();
      const json: unknown = JSON.parse(text);
      if (notFoundTtlSeconds && isNotFoundBody(json)) return { kind: 'not_found' };
      const data = parse(json);
      return data === null ? null : { kind: 'ok', data, text };
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
  if (fresh?.kind === 'ok') return { data: fresh.data, source: 'cache' };
  if (fresh?.kind === 'not_found') return { data: null, source: 'not_found' };

  try {
    const res = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (notFoundTtlSeconds && res.status === 404) {
      if (isNotFoundBody(await res.json().catch(() => null))) {
        await background([
          write(freshKey, NOT_FOUND_TEXT, notFoundTtlSeconds),
          cache?.delete?.(staleKey).catch(() => undefined),
        ]);
        return { data: null, source: 'not_found' };
      }
      throw new Error('status 404 without the not_found body');
    }
    if (!res.ok) throw new Error(`content API answered ${res.status}`);
    const text = await res.text();
    const data = parse(JSON.parse(text));
    if (data === null) throw new Error('content API payload has the wrong shape');
    const stored = serialize ? serialize(data) : text;
    await background([write(freshKey, stored, freshTtlSeconds), write(staleKey, stored, staleTtlSeconds)]);
    return { data, source: 'network' };
  } catch (error) {
    onFailure?.(failureReason(error));
    const stale = await read(staleKey);
    if (stale?.kind !== 'ok') return { data: null, source: 'empty' };
    await background([write(freshKey, stale.text, outageTtlSeconds)]);
    return { data: stale.data, source: 'stale' };
  }
}

const NOT_FOUND_TEXT = '{"error":"not_found"}';
const isNotFoundBody = (json: unknown): boolean => isRecord(json) && json.error === 'not_found';

/** A fixed word for the log, never the response or the URL: `timeout`, `status 500`, `invalid payload`. */
function failureReason(error: unknown): string {
  if (!(error instanceof Error)) return 'failed';
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'timeout';
  const status = /answered (\d{3})$/.exec(error.message)?.[1];
  if (status) return `status ${status}`;
  if (error.message.startsWith('status 404')) return 'status 404 without the not_found body';
  if (error.message.includes('wrong shape') || error instanceof SyntaxError) return 'invalid payload';
  return 'failed';
}

/**
 * The loader's runtime inputs for a page: where the API is and how to call it, the fresh window
 * from the Worker env, the default cache, and `waitUntil` of the request context.
 *
 * Where the API is (lib/api-client.ts, `contentApiTarget`): `CONTENT_API_URL` when it is set (local
 * runs and CI: a fixture or a local API), otherwise the `API` service binding, which is how
 * production reads. So in production the read endpoints are called through the binding and are never
 * addressed over public HTTP: a URL with a random query string cannot be sent to them from the
 * internet. Neither set: no base, the loader answers "empty" (the page's degraded state).
 * `CONTENT_CACHE_FRESH_SECONDS` tunes the fresh window (default 60, tests set 2).
 */
export function contentRuntime(
  env: ApiEnv & { CONTENT_CACHE_FRESH_SECONDS?: string },
  ctx: { waitUntil(promise: Promise<unknown>): void },
): ContentRuntime {
  const target = contentApiTarget(env);
  return {
    baseUrl: target?.base,
    fetchImpl: target?.fetchImpl,
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
    case 'not_found':
      // An unknown blog slug: a real 404, remembered like the contract's (s-maxage=30).
      return { status: 404, headers: { 'cache-control': 'public, max-age=0, s-maxage=30' } };
    default:
      return { status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '30' } };
  }
}

/**
 * Headers of a page that CARRIES a content list as one section among others (SAKEM-105: /donasi carries the reports).
 * Such a page never fails because of the list: with nothing to show (API down, cold cache) it still answers 200 and
 * only the section says so, unlike contentPageHeaders, whose 503 is for a page that IS the list. Freshness is the
 * list pages' (`s-maxage=60`, the stale copy's 30); a degraded answer is `no-store`, with no Retry-After (the page
 * itself is fine): no edge, browser or page copy (src/lib/page-cache.ts copies only an `s-maxage` of a minute or
 * more) keeps it, so the list shows again as soon as the API does.
 */
export function contentSectionHeaders(source: ContentSource): { status: 200; headers: Record<string, string> } {
  switch (source) {
    case 'network':
    case 'cache':
      return { status: 200, headers: { 'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' } };
    case 'stale':
      return { status: 200, headers: { 'cache-control': 'public, max-age=0, s-maxage=30' } };
    default:
      return { status: 200, headers: { 'cache-control': 'no-store' } };
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
