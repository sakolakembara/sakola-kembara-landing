import { describe, expect, it, vi } from 'vitest';
import { loadContent, type ContentLoaderOptions } from '~/lib/content-api';
import { parseBlogArticle } from '~/lib/blog-api';
import { fakeCache } from './fake-cache';

// The parts of the shared loader (lib/content-api.ts) that the blog added: a "not found" that is an
// answer and not a failure, what is stored in the cache, the failure reasons for the log, and cache
// keys of a path that has a query. The rest (fresh window, stale-if-error, timeout, the 30 s outage
// window) is tests/content-api.test.ts and tests/team.test.ts; a few cases are repeated here with the
// blog's options on, since that is the combination the blog pages run.

const base = 'http://api.test';
const PATH = '/api/public/thing?page=1';
const parse = (json: unknown) => (typeof json === 'object' && json !== null && 'n' in json ? (json as { n: number }) : null);

function setup(responses: (() => Response | Promise<Response>)[] | (() => Response | Promise<Response>)) {
  let t = 1_000_000;
  const cache = fakeCache(() => t);
  const fetchImpl = vi.fn(async () => {
    const next = Array.isArray(responses) ? (responses.length > 1 ? responses.shift()! : responses[0]) : responses;
    return next();
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  const run = (extra: Partial<ContentLoaderOptions<{ n: number }>> = {}) =>
    loadContent<{ n: number }>({ baseUrl: base, path: PATH, parse, cache, fetchImpl, notFoundTtlSeconds: 30, ...extra });
  return { cache, fetchImpl: fetchImpl as unknown as ReturnType<typeof vi.fn>, run, advance: (ms: number) => (t += ms) };
}
const ok = (n: number) => () => Response.json({ n });
const status = (code: number, body: BodyInit | null = 'x') => () => new Response(body, { status: code });
const notFound = () => Response.json({ error: 'not_found' }, { status: 404 });

describe('loadContent with notFoundTtlSeconds (the blog article)', () => {
  it('a 404 {"error":"not_found"} is a real "not found", remembered for 30 s so probing cannot hammer the API', async () => {
    const { run, fetchImpl, advance } = setup(notFound);
    expect(await run()).toEqual({ data: null, source: 'not_found' });
    expect(await run()).toEqual({ data: null, source: 'not_found' }); // from the cache
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    advance(31_000);
    expect(await run()).toEqual({ data: null, source: 'not_found' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('a "not found" drops the stale copy: an outage after an unpublish must not bring the article back', async () => {
    const { run, advance, cache } = setup([ok(1), notFound, status(500)]);
    await run();
    advance(61_000);
    expect((await run()).source).toBe('not_found');
    expect([...cache.store.keys()].some((k) => k.includes('copy=stale'))).toBe(false);
    advance(31_000);
    expect(await run()).toEqual({ data: null, source: 'empty' });
  });

  it('a 404 that is NOT the contract\'s JSON (a wrong base URL, a proxy page) is an API failure, never a deleted page', async () => {
    const reasons: string[] = [];
    const { run } = setup(status(404, '<h1>Not Found</h1>'));
    expect(await run({ onFailure: (r) => reasons.push(r) })).toEqual({ data: null, source: 'empty' });
    expect(reasons).toEqual(['status 404 without the not_found body']);
    // with a stale copy it is served stale
    const second = setup([ok(5), status(404, 'nope')]);
    await second.run();
    second.advance(61_000);
    expect(await second.run()).toMatchObject({ data: { n: 5 }, source: 'stale' });
  });

  it('without the option a 404 is a plain failure, as it always was for the lists', async () => {
    const { run } = setup(notFound);
    expect(await run({ notFoundTtlSeconds: undefined })).toEqual({ data: null, source: 'empty' });
  });

  it('"not found" is told apart from a payload even when the payload parser would accept the error body', async () => {
    const lenient = (json: unknown) => json as { n: number };
    const { run } = setup(notFound);
    expect(await run({ parse: lenient })).toEqual({ data: null, source: 'not_found' });
    expect(await run({ parse: lenient })).toEqual({ data: null, source: 'not_found' });
  });
});

describe('loadContent: what is stored, and what is logged', () => {
  it('stores what `serialize` says, so a field the site does not use is neither cached nor parsed again (contentMarkdown)', async () => {
    const payload = {
      article: { slug: 'a', title: 'A', dateISO: '2026-05-21', contentHtml: '<p>x</p>', contentMarkdown: 'x'.repeat(5000) },
      related: [],
    };
    const { cache } = setup(ok(1));
    const loaded = await loadContent({ baseUrl: base, path: '/api/public/blog/a', parse: parseBlogArticle, serialize: JSON.stringify, cache, fetchImpl: (async () => Response.json(payload)) as unknown as typeof fetch });
    expect(loaded.source).toBe('network');
    const stored = [...cache.store.values()].map((e) => e.text);
    expect(stored).toHaveLength(2); // fresh + stale
    for (const text of stored) {
      expect(text).not.toContain('contentMarkdown');
      expect(text.length).toBeLessThan(400);
    }
    // and what was stored is what the next view parses
    const again = await loadContent({ baseUrl: base, path: '/api/public/blog/a', parse: parseBlogArticle, serialize: JSON.stringify, cache, fetchImpl: (async () => Response.error()) as unknown as typeof fetch });
    expect(again.source).toBe('cache');
    expect(again.data?.article.contentHtml).toBe('<p>x</p>');
  });

  it('without `serialize` the response text is stored as it came (what the lists do)', async () => {
    const { run, cache } = setup(() => new Response('{"n": 7,   "extra": true}'));
    await run();
    expect([...cache.store.values()].map((e) => e.text)).toEqual(['{"n": 7,   "extra": true}', '{"n": 7,   "extra": true}']);
  });

  it('the failure reason is a fixed word: a status, a timeout, an invalid payload, never a URL or a body', async () => {
    const reasons: string[] = [];
    const onFailure = (r: string) => reasons.push(r);
    await setup(status(500, 'secret body')).run({ onFailure });
    await setup(() => Response.json({ wrong: 'shape' })).run({ onFailure });
    await setup(() => new Response('<html>')).run({ onFailure });
    await setup(() => Promise.reject(new TypeError('connection refused http://api.test/secret'))).run({ onFailure });
    const hang = ((_u: unknown, init?: RequestInit) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)))) as unknown as typeof fetch;
    await setup(ok(1)).run({ fetchImpl: hang, timeoutMs: 30, onFailure });
    expect(reasons).toEqual(['status 500', 'invalid payload', 'invalid payload', 'failed', 'timeout']);
  });

  it('a path that has a query keeps its stale copy under `&copy=stale`, so the two keys differ and read cleanly', async () => {
    const { run, cache } = setup(ok(1));
    await run();
    expect([...cache.store.keys()].sort()).toEqual([`${base}${PATH}`, `${base}${PATH}&copy=stale`]);
  });

  it('keys of two pages do not read each other', async () => {
    const { cache } = setup(ok(1));
    const load = (page: number, n: number) =>
      loadContent({ baseUrl: base, path: `/api/public/blog?page=${page}&pageSize=15`, parse, cache, fetchImpl: (async () => Response.json({ n })) as unknown as typeof fetch });
    expect((await load(1, 1)).data?.n).toBe(1);
    expect((await load(2, 2)).data?.n).toBe(2);
    expect((await load(1, 99)).data?.n).toBe(1); // its own cache entry
  });
});
