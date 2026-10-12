import { describe, expect, it, vi } from 'vitest';
import { loadJson, type JsonLoaderOptions } from '~/lib/api-cache';
import { parseBlogArticle } from '~/lib/blog-api';

// The loader behind /blog and /blog/<slug>: fresh copy, network, stale-if-error, and a remembered "not found".
// A fake Cache API with a controllable clock, and a fake fetch that counts.

function fakeCache(clock: { now: number }) {
  const store = new Map<string, { text: string; expires: number }>();
  return {
    store,
    async match(request: Request | string) {
      const entry = store.get(typeof request === 'string' ? request : request.url);
      if (!entry || entry.expires <= clock.now) return undefined;
      return new Response(entry.text);
    },
    async put(request: Request | string, response: Response) {
      const ttl = Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] ?? 0);
      store.set(typeof request === 'string' ? request : request.url, { text: await response.text(), expires: clock.now + ttl * 1000 });
    },
    async delete(request: Request | string) {
      return store.delete(typeof request === 'string' ? request : request.url);
    },
  };
}

const URL_ = 'http://api.test/api/public/thing';
const parse = (json: unknown) => (typeof json === 'object' && json !== null && 'n' in json ? (json as { n: number }) : null);

function setup(responses: (() => Response | Promise<Response>)[] | (() => Response | Promise<Response>)) {
  const clock = { now: 1_000_000 };
  const cache = fakeCache(clock);
  const fetchImpl = vi.fn(async () => {
    const next = Array.isArray(responses) ? (responses.length > 1 ? responses.shift()! : responses[0]) : responses;
    return next();
  });
  const run = (extra: Partial<JsonLoaderOptions<{ n: number }>> = {}) =>
    loadJson({ url: URL_, parse, cache, fetchImpl: fetchImpl as unknown as JsonLoaderOptions<{ n: number }>['fetchImpl'], ...extra });
  return { clock, cache, fetchImpl, run };
}
const ok = (n: number) => () => Response.json({ n });
const status = (code: number, body: BodyInit | null = 'x') => () => new Response(body, { status: code });
const notFound = () => Response.json({ error: 'not_found' }, { status: 404 });

describe('loadJson', () => {
  it('fetches on a cold cache, then serves from the cache for the fresh window without asking again', async () => {
    const { run, fetchImpl, clock } = setup(ok(1));
    expect(await run()).toEqual({ status: 'ok', data: { n: 1 }, source: 'network' });
    expect(await run()).toEqual({ status: 'ok', data: { n: 1 }, source: 'cache' });
    clock.now += 59_000;
    expect((await run()).status).toBe('ok');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    clock.now += 2_000; // 61 s: past the 60 s default
    expect(await run()).toMatchObject({ source: 'network' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('asks the API with a timeout signal and a JSON Accept header', async () => {
    const { run, fetchImpl } = setup(ok(1));
    await run({ timeoutMs: 1234 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL_);
    expect(new Headers(init.headers).get('accept')).toBe('application/json');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('stale-if-error: the API fails after the fresh window, the last good copy is served, and is re-served as fresh for 30 s so an outage costs one wait per 30 s', async () => {
    const { run, fetchImpl, clock } = setup([ok(1), status(500)]);
    await run();
    clock.now += 61_000;
    expect(await run()).toEqual({ status: 'ok', data: { n: 1 }, source: 'stale' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(await run()).toMatchObject({ source: 'cache' }); // inside the 30 s outage window
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    clock.now += 31_000;
    expect(await run()).toMatchObject({ source: 'stale' }); // asked again, still down
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('keeps the last good copy for 7 days, not longer', async () => {
    const { run, clock } = setup([ok(1), status(503)]);
    await run();
    clock.now += 6 * 86_400_000;
    expect(await run()).toMatchObject({ source: 'stale' });
    clock.now += 2 * 86_400_000;
    expect(await run()).toEqual({ status: 'unavailable' });
  });

  it.each([
    ['a 5xx', status(500)],
    ['a body that is not the expected shape', () => Response.json({ nope: true })],
    ['invalid JSON', () => new Response('<html>', { status: 200 })],
    ['a network error', () => Promise.reject(new TypeError('refused'))],
  ] as [string, () => Response | Promise<Response>][])('%s with nothing cached is "unavailable", never an exception', async (_name, respond) => {
    const { run } = setup(respond);
    expect(await run()).toEqual({ status: 'unavailable' });
  });

  it('a timeout is a failure like any other: the stale copy is served', async () => {
    const hang = (_u: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
    const { run, clock } = setup(ok(1));
    await run();
    clock.now += 61_000;
    const reasons: string[] = [];
    const started = Date.now();
    expect(await run({ fetchImpl: hang, timeoutMs: 40, onFailure: (r) => reasons.push(r) })).toMatchObject({ source: 'stale' });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(reasons).toEqual(['timeout']);
  });

  it('a 404 {"error":"not_found"} is a real "not found", remembered for 30 s so probing cannot hammer the API', async () => {
    const { run, fetchImpl, clock } = setup(notFound);
    expect(await run()).toEqual({ status: 'not_found', source: 'network' });
    expect(await run()).toEqual({ status: 'not_found', source: 'cache' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    clock.now += 31_000;
    expect(await run()).toEqual({ status: 'not_found', source: 'network' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('a "not found" drops the stale copy: an outage after an unpublish must not bring the article back', async () => {
    const { run, clock } = setup([ok(1), notFound, status(500)]);
    await run();
    clock.now += 61_000;
    expect((await run()).status).toBe('not_found');
    clock.now += 31_000;
    expect(await run()).toEqual({ status: 'unavailable' });
  });

  it('a 404 that is NOT the contract\'s JSON (a wrong base URL, a proxy page) is an API failure, never a deleted page', async () => {
    const reasons: string[] = [];
    const { run } = setup(status(404, '<h1>Not Found</h1>'));
    expect(await run({ onFailure: (r) => reasons.push(r) })).toEqual({ status: 'unavailable' });
    expect(reasons).toEqual(['status 404 without the not_found body']);
    // and with a stale copy it is served stale
    const second = setup([ok(5), status(404, 'nope')]);
    await second.run();
    second.clock.now += 61_000;
    expect(await second.run()).toMatchObject({ status: 'ok', source: 'stale' });
  });

  it('stores the PARSED value, so a field the site does not use is neither cached nor parsed again (contentMarkdown)', async () => {
    const payload = {
      article: { slug: 'a', title: 'A', dateISO: '2026-05-21', contentHtml: '<p>x</p>', contentMarkdown: 'x'.repeat(5000) },
      related: [],
    };
    const { cache, clock } = setup(ok(1));
    const loaded = await loadJson({ url: URL_, parse: parseBlogArticle, cache, fetchImpl: async () => Response.json(payload) });
    expect(loaded.status).toBe('ok');
    const stored = [...cache.store.values()].map((e) => e.text);
    expect(stored.length).toBe(2); // fresh + stale
    for (const text of stored) {
      expect(text).not.toContain('contentMarkdown');
      expect(text.length).toBeLessThan(400);
    }
    expect(clock.now).toBeGreaterThan(0);
  });

  it('writes go to waitUntil when it is given, and are not awaited', async () => {
    const jobs: Promise<unknown>[] = [];
    const { run, cache } = setup(ok(1));
    await run({ waitUntil: (p) => jobs.push(p) });
    expect(jobs).toHaveLength(1);
    await Promise.all(jobs);
    expect(cache.store.size).toBe(2);
  });

  it('works without any cache (a runtime without the Cache API): every call goes to the API', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ n: 1 }));
    const load = () => loadJson({ url: URL_, parse, fetchImpl });
    expect((await load()).status).toBe('ok');
    expect((await load()).status).toBe('ok');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('the failure reason says what happened and nothing else: a status, never a URL or a body', async () => {
    const reasons: string[] = [];
    await setup(status(500, 'secret body')).run({ onFailure: (r) => reasons.push(r) });
    await setup(() => Response.json({ wrong: 'shape' })).run({ onFailure: (r) => reasons.push(r) });
    await setup(() => Promise.reject(new Error('boom'))).run({ onFailure: (r) => reasons.push(r) });
    expect(reasons).toEqual(['status 500', 'invalid payload', 'boom']);
  });

  it('honours the TTLs it is given', async () => {
    const { run, fetchImpl, clock } = setup(ok(1));
    await run({ freshTtlSeconds: 5 });
    clock.now += 4_000;
    await run({ freshTtlSeconds: 5 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    clock.now += 2_000;
    await run({ freshTtlSeconds: 5 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
