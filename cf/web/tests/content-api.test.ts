import { describe, expect, it } from 'vitest';
import {
  CONTENT_FRESH_SECONDS,
  contentPageHeaders,
  contentRuntime,
  externalHref,
  fileHref,
  listOf,
  loadContent,
} from '~/lib/content-api';
import { fakeCache, hangingFetch, okFetch, statusFetch } from './fake-cache';

// The shared loader behind /tim, /laporan and /gabung-siswa/docs. tests/team.test.ts exercises it
// through loadTeam (timeout, stale-if-error, the 30 s outage window, a throwing cache); these are
// the parts that are new with the second and third caller.

const parseList = (key: string) => (payload: unknown) => listOf(payload, key);
const base = { baseUrl: 'http://api.test', path: '/api/public/things', parse: parseList('things') };

describe('loadContent', () => {
  it('the default fresh window is 60 s (the contract s-maxage): cached until then, asked again after', async () => {
    expect(CONTENT_FRESH_SECONDS).toBe(60);
    let t = 0;
    const cache = fakeCache(() => t);
    const { fetchImpl, calls } = okFetch({ things: [1, 2] });
    const opts = { ...base, cache, fetchImpl };
    expect((await loadContent(opts)).source).toBe('network');
    t += 59_000;
    expect((await loadContent(opts)).source).toBe('cache');
    t += 2_000;
    expect((await loadContent(opts)).source).toBe('network');
    expect(calls).toHaveLength(2);
  });

  it('returns the parsed data with the source, and null data without a base URL (nothing is fetched)', async () => {
    const { fetchImpl, calls } = okFetch({ things: ['a'] });
    expect(await loadContent({ ...base, fetchImpl })).toEqual({ data: ['a'], source: 'network' });
    expect(await loadContent({ ...base, baseUrl: undefined, fetchImpl })).toEqual({ data: null, source: 'empty' });
    expect(calls).toHaveLength(1);
  });

  it('asks ${base}${path} (trailing slash on the base tolerated) with an Accept header and a timeout signal', async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init?: RequestInit) => ((seen = { url, init }), new Response('{"things":[]}'))) as unknown as typeof fetch;
    await loadContent({ ...base, baseUrl: 'http://api.test/', fetchImpl });
    expect(seen?.url).toBe('http://api.test/api/public/things');
    expect(new Headers(seen?.init?.headers).get('accept')).toBe('application/json');
    expect(seen?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('two endpoints on one cache do not read each other (the key is the URL)', async () => {
    const cache = fakeCache(() => 0);
    const a = { ...base, path: '/api/public/a', parse: parseList('a'), cache };
    const b = { ...base, path: '/api/public/b', parse: parseList('b'), cache };
    expect((await loadContent({ ...a, fetchImpl: okFetch({ a: [1] }).fetchImpl })).data).toEqual([1]);
    expect((await loadContent({ ...b, fetchImpl: okFetch({ b: [2] }).fetchImpl })).data).toEqual([2]);
    expect((await loadContent({ ...a, fetchImpl: statusFetch(500) })).data).toEqual([1]); // from its own cache entry
    expect([...cache.store.keys()].sort()).toEqual([
      'http://api.test/api/public/a',
      'http://api.test/api/public/a?copy=stale',
      'http://api.test/api/public/b',
      'http://api.test/api/public/b?copy=stale',
    ]);
  });

  it('a payload the parser rejects (null) is an API failure: stale copy if there is one, else null data', async () => {
    let t = 0;
    const cache = fakeCache(() => t);
    await loadContent({ ...base, cache, fetchImpl: okFetch({ things: [1] }).fetchImpl });
    t += 61_000;
    const wrongShape = okFetch({ things: 'nope' }).fetchImpl;
    expect(await loadContent({ ...base, cache, fetchImpl: wrongShape })).toEqual({ data: [1], source: 'stale' });
    expect(await loadContent({ ...base, cache: fakeCache(() => 0), fetchImpl: wrongShape })).toEqual({ data: null, source: 'empty' });
  });

  it('an empty list is valid data, not a failure: source "network", data []', async () => {
    expect(await loadContent({ ...base, fetchImpl: okFetch({ things: [] }).fetchImpl })).toEqual({ data: [], source: 'network' });
  });

  it('a cached copy that no longer parses is ignored and the API is asked', async () => {
    const cache = fakeCache(() => 0);
    await cache.put(new Request('http://api.test/api/public/things'), new Response('{"things":"corrupt"}', { headers: { 'cache-control': 'max-age=60' } }));
    const { fetchImpl, calls } = okFetch({ things: [7] });
    expect(await loadContent({ ...base, cache, fetchImpl })).toEqual({ data: [7], source: 'network' });
    expect(calls).toHaveLength(1);
  });

  it('a hanging API is cut off by the timeout; with nothing cached the result is null data', async () => {
    const started = Date.now();
    const r = await loadContent({ ...base, cache: fakeCache(() => 0), fetchImpl: hangingFetch, timeoutMs: 40 });
    expect(r).toEqual({ data: null, source: 'empty' });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('contentRuntime', () => {
  const ctx = { waitUntil: () => undefined };

  it('takes the base URL and the fresh window from the env; garbage or blank means the default', () => {
    expect(contentRuntime({ CONTENT_API_URL: 'http://api.test', CONTENT_CACHE_FRESH_SECONDS: '2' }, ctx)).toMatchObject({
      baseUrl: 'http://api.test',
      freshTtlSeconds: 2,
    });
    for (const v of [undefined, '', 'abc', '0']) {
      expect(contentRuntime({ CONTENT_CACHE_FRESH_SECONDS: v }, ctx).freshTtlSeconds, String(v)).toBeUndefined();
    }
    expect(contentRuntime({}, ctx).baseUrl).toBeUndefined();
  });

  it('hands cache writes to ctx.waitUntil', () => {
    const seen: Promise<unknown>[] = [];
    const runtime = contentRuntime({}, { waitUntil: (p) => void seen.push(p) });
    const job = Promise.resolve();
    runtime.waitUntil?.(job);
    expect(seen).toEqual([job]);
  });

  it('has no cache where the runtime has no `caches` (plain Node)', () => {
    expect(typeof caches).toBe('undefined');
    expect(contentRuntime({}, ctx).cache).toBeUndefined();
  });
});

describe('contentPageHeaders', () => {
  it('fresh data (network or cache): 200, s-maxage 60 like the API, never held by a browser', () => {
    for (const source of ['network', 'cache'] as const) {
      expect(contentPageHeaders(source)).toEqual({
        status: 200,
        headers: { 'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' },
      });
    }
  });

  it('stale data: 200, but only 30 s at a shared cache', () => {
    expect(contentPageHeaders('stale')).toEqual({ status: 200, headers: { 'cache-control': 'public, max-age=0, s-maxage=30' } });
  });

  it('nothing to show (API down, cold cache): 503, no-store, Retry-After', () => {
    expect(contentPageHeaders('empty')).toEqual({ status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '30' } });
  });
});

describe('listOf', () => {
  it('takes { key: [...] } or a bare array, anything else is null', () => {
    expect(listOf({ items: [1] }, 'items')).toEqual([1]);
    expect(listOf([1], 'items')).toEqual([1]);
    for (const bad of [{ items: 'x' }, { other: [] }, 'x', null, undefined, 3]) expect(listOf(bad, 'items')).toBeNull();
  });
});

describe('fileHref: an upload path from the API, used as a link target as it is', () => {
  it.each([
    '/reports/2025-2026/impact/laporan-dampak.pdf',
    '/resources/panduan pendaftaran.pdf',
    '/resources/a.pdf?v=2',
    'https://files.example.org/reports/a.pdf',
    'http://files.example.org/a.pdf',
  ])('%s is kept', (v) => {
    expect(fileHref(v)).toBe(v);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:x',
    '//evil.example/a.pdf',
    'reports/a.pdf',
    'mailto:a@b.example',
    'https://',
    'https:///a.pdf',
    '/a\\b.pdf',
    '/a\nb.pdf',
    '/a\u0000b.pdf',
    '',
    '   ',
    null,
    undefined,
    42,
    {},
  ])('%j is refused', (v) => {
    expect(fileHref(v)).toBeNull();
  });
});

describe('externalHref: the external link of a resource, http(s) only', () => {
  it.each(['https://example.org/x', 'http://example.org/x?a=1#b', '  https://example.org/x  '])('%j is kept (trimmed)', (v) => {
    expect(externalHref(v)).toBe(v.trim());
  });
  it.each(['javascript:alert(1)', 'data:text/html,x', 'ftp://example.org/x', 'mailto:a@b.example', 'not a url', '/relative', '', null, 5])(
    '%j is refused',
    (v) => {
      expect(externalHref(v)).toBeNull();
    },
  );
});
