// A JSON GET against the content API with a hard timeout, the Workers Cache API
// (`caches.default`) as a cache, and stale-if-error. The same scheme as the team
// loader (lib/team.ts), made generic for the blog, plus the one thing a blog needs
// that a list does not: an explicit "this does not exist" answer.
//
//   1. fresh copy in the cache                          -> "cache"
//   2. else fetch the API (timeout 2 s)                 -> "network", stored fresh + stale
//        a 404 {"error":"not_found"}                    -> not_found, remembered for 30 s, the
//                                                          stale copy is dropped (it is gone, an
//                                                          outage must not bring it back)
//   3. API down / slow / not the expected shape         -> last good copy (7 days): "stale", also
//        re-stored as fresh for 30 s, so an outage costs one 2 s wait per 30 s, not one per request
//   4. nothing at all                                   -> unavailable
//
// A 404 only counts as "not found" when the body is the contract's JSON error. A
// 404 from a wrong base URL or a misrouted request (an HTML page, any other body) is
// an API failure, never a page that looks deleted: Google would drop the URLs.
//
// What is cached is the PARSED value written back as JSON (so a field the site
// never uses, such as `contentMarkdown`, is not stored and not parsed again on every hit).
//
// Cache and fetch are injected, so the logic is unit tested in Node with fakes
// (tests/api-cache.test.ts). On a real zone the Cache API only works on custom
// domains and routes, not on *.workers.dev. Free allows 50 Cache API and fetch
// calls per request; a read costs 1 to 3 of them.

export type CacheSource = 'network' | 'cache' | 'stale';

/** `S` is the set of sources an `ok` can come from; a data source that is not a cache adds its own (see blog-source.ts). */
export type Loaded<T, S extends string = CacheSource> =
  | { status: 'ok'; data: T; source: S }
  | { status: 'not_found'; source: 'network' | 'cache' | 'build' }
  | { status: 'unavailable' };

export interface JsonLoaderOptions<T> {
  /** Absolute URL: what is requested and the base of the cache keys. */
  url: string;
  /** Turns the response body into the value, or null when it is not the expected shape. */
  parse: (json: unknown) => T | null;
  /** caches.default when the runtime has it. */
  cache?: Pick<Cache, 'match' | 'put' | 'delete'>;
  /** ctx.waitUntil, so cache writes do not delay the response. */
  waitUntil?: (promise: Promise<unknown>) => void;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  freshTtlSeconds?: number;
  /** How long the last good copy is kept for stale-if-error. */
  staleTtlSeconds?: number;
  /** How long a stale copy is re-served as "fresh" after a failed fetch. */
  outageTtlSeconds?: number;
  /** How long a "not found" is remembered (the contract's 404 is s-maxage=30). */
  notFoundTtlSeconds?: number;
  /** A reason without any content, for the Worker log (`status 500`, `timeout`, `invalid payload`). */
  onFailure?: (reason: string) => void;
}

const NOT_FOUND_TEXT = '{"error":"not_found"}';
const isNotFoundBody = (json: unknown): boolean =>
  typeof json === 'object' && json !== null && (json as { error?: unknown }).error === 'not_found';

export async function loadJson<T>(opts: JsonLoaderOptions<T>): Promise<Loaded<T>> {
  const {
    url,
    parse,
    cache,
    waitUntil,
    fetchImpl = (u, init) => fetch(u, init),
    timeoutMs = 2000,
    freshTtlSeconds = 60,
    staleTtlSeconds = 60 * 60 * 24 * 7,
    outageTtlSeconds = 30,
    notFoundTtlSeconds = 30,
    onFailure,
  } = opts;

  // Cache keys are synthetic GET requests; nothing is ever fetched from the "stale" one.
  const freshKey = new Request(url);
  const staleKey = new Request(`${url}${url.includes('?') ? '&' : '?'}copy=stale`);

  type Hit = { kind: 'ok'; value: T; text: string } | { kind: 'not_found' };
  const read = async (key: Request): Promise<Hit | null> => {
    try {
      const hit = await cache?.match(key);
      if (!hit) return null;
      const text = await hit.text();
      const json: unknown = JSON.parse(text);
      if (isNotFoundBody(json)) return { kind: 'not_found' };
      const value = parse(json);
      return value === null ? null : { kind: 'ok', value, text };
    } catch {
      return null;
    }
  };

  const write = (key: Request, text: string, ttl: number): Promise<unknown> | undefined =>
    cache
      ?.put(key, new Response(text, { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttl}` } }))
      .catch(() => undefined);

  const background = async (jobs: (Promise<unknown> | undefined)[]) => {
    const all = Promise.all(jobs.filter(Boolean)).catch(() => undefined);
    if (waitUntil) waitUntil(all);
    else await all;
  };

  const fresh = await read(freshKey);
  if (fresh?.kind === 'ok') return { status: 'ok', data: fresh.value, source: 'cache' };
  if (fresh?.kind === 'not_found') return { status: 'not_found', source: 'cache' };

  try {
    const res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 404) {
      const body: unknown = await res.json().catch(() => null);
      if (isNotFoundBody(body)) {
        await background([write(freshKey, NOT_FOUND_TEXT, notFoundTtlSeconds), cache?.delete(staleKey).catch(() => undefined)]);
        return { status: 'not_found', source: 'network' };
      }
      throw new Error('status 404 without the not_found body');
    }
    if (!res.ok) throw new Error(`status ${res.status}`);
    const value = parse(await res.json());
    if (value === null) throw new Error('invalid payload');
    const text = JSON.stringify(value);
    await background([write(freshKey, text, freshTtlSeconds), write(staleKey, text, staleTtlSeconds)]);
    return { status: 'ok', data: value, source: 'network' };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    onFailure?.(timedOut ? 'timeout' : error instanceof Error ? error.message : 'failed');
    const stale = await read(staleKey);
    if (stale?.kind !== 'ok') return { status: 'unavailable' };
    await background([write(freshKey, stale.text, outageTtlSeconds)]);
    return { status: 'ok', data: stale.value, source: 'stale' };
  }
}
