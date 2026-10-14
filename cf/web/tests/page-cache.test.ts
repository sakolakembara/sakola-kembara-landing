import { describe, expect, test } from 'vitest';
import { MAX_PAGE_CACHE_SECONDS, PageCache, cachedForSeconds, pageCacheKey, pageCacheSeconds, responseFromEntry } from '../src/lib/page-cache';

// The isolate-memory copy of the rendered pages (src/lib/page-cache.ts, SAKEM-091). The risks are a copy of a page that
// should not be copied (stale, an error, one that varies), a key that lets a visitor create entries, and a copy that
// is not the page that was rendered. The middleware wiring is checked on the built Worker in scripts/e2e.mjs.

const key = (path: string) => pageCacheKey(new URL(`https://site.example.test${path}`));
const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

describe('pageCacheSeconds: off unless the setting is a whole number above zero', () => {
  test.each([
    [undefined, 0],
    ['', 0],
    ['0', 0],
    ['-5', 0],
    ['soon', 0],
    ['30', 30],
    ['30.9', 30],
    [' 45 ', 45],
    ['120', 120],
    ['100000', MAX_PAGE_CACHE_SECONDS],
  ])('%j -> %j', (value, expected) => {
    expect(pageCacheSeconds(value)).toBe(expected);
  });
});

describe('pageCacheKey: only the pages that depend on the API data, and only the part of the URL they read', () => {
  test('the list is keyed by the page it shows, clamped like the page does, and ignores every other parameter', () => {
    expect(key('/blog')).toBe('/blog?page=1');
    expect(key('/blog?page=1')).toBe('/blog?page=1');
    expect(key('/blog?page=3')).toBe('/blog?page=3');
    expect(key('/blog?page=abc')).toBe('/blog?page=1');
    expect(key('/blog?page=0')).toBe('/blog?page=1');
    expect(key('/blog?page=99999999')).toBe('/blog?page=500');
    // A probing query string shares the entry of the page: it cannot make new ones.
    expect(key('/blog?x=1')).toBe(key('/blog'));
    expect(key('/blog?page=2&utm_source=a')).toBe('/blog?page=2');
  });

  test('an article by its slug, query ignored; a path that cannot be a slug is not copied', () => {
    expect(key('/blog/some-article-2026')).toBe('/blog/some-article-2026');
    expect(key('/blog/some-article-2026?x=1')).toBe('/blog/some-article-2026');
    expect(key('/blog/')).toBeNull();
    expect(key('/blog/UPPER')).toBeNull();
    expect(key('/blog/a/b')).toBeNull();
    expect(key('/blog/..%2f..')).toBeNull();
    expect(key(`/blog/${'a'.repeat(201)}`)).toBeNull();
  });

  test('the other list pages and the sitemap', () => {
    for (const path of ['/tim', '/laporan', '/gabung-siswa/docs', '/sitemap.xml']) expect(key(`${path}?x=1`)).toBe(path);
  });

  test.each(['/', '/kontak', '/donasi', '/gabung-siswa', '/program/bimbel', '/some-shortlink', '/api/anything', '/admin', '/portal/login', '/tim/extra', '/blog2'])(
    '%s is never copied (a form, a redirect, a shortlink, a prerendered page or someone else’s)',
    (path) => {
      expect(key(path)).toBeNull();
    },
  );
});

describe('cachedForSeconds: a fresh 200 for at most the page’s own s-maxage; nothing else', () => {
  const page = (status: number, cacheControl: string | null, extra: Record<string, string> = {}) => ({
    status,
    headers: new Headers({ ...(cacheControl === null ? {} : { 'cache-control': cacheControl }), ...extra }),
  });
  const FRESH = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';

  test('capped by the setting and by the page', () => {
    expect(cachedForSeconds(page(200, FRESH), 30)).toBe(30);
    expect(cachedForSeconds(page(200, FRESH), 120)).toBe(60);
    expect(cachedForSeconds(page(200, 'public, max-age=0, s-maxage=600, stale-while-revalidate=3600'), 120)).toBe(120);
  });

  test('off, or anything but a fresh 200, is not copied', () => {
    expect(cachedForSeconds(page(200, FRESH), 0)).toBe(0);
    // An outage page: the loader says s-maxage=30 for a copy that is itself stale.
    expect(cachedForSeconds(page(200, 'public, max-age=0, s-maxage=30'), 30)).toBe(0);
    expect(cachedForSeconds(page(404, FRESH), 30)).toBe(0);
    expect(cachedForSeconds(page(503, 'no-store'), 30)).toBe(0);
    expect(cachedForSeconds(page(301, FRESH), 30)).toBe(0);
    expect(cachedForSeconds(page(200, null), 30)).toBe(0);
    expect(cachedForSeconds(page(200, 'no-store'), 30)).toBe(0);
    expect(cachedForSeconds(page(200, 'private, s-maxage=600'), 30)).toBe(0);
    expect(cachedForSeconds(page(200, FRESH, { 'set-cookie': 'a=b' }), 30)).toBe(0);
  });

  test('/tim has no Cache-Control: it is copied only when its data is fresh, never when it is stale or missing (it answers 200 either way)', () => {
    expect(cachedForSeconds(page(200, null, { 'x-team-source': 'network' }), 30)).toBe(30);
    expect(cachedForSeconds(page(200, null, { 'x-team-source': 'cache' }), 45)).toBe(45);
    expect(cachedForSeconds(page(200, null, { 'x-team-source': 'stale' }), 30)).toBe(0);
    expect(cachedForSeconds(page(200, null, { 'x-team-source': 'empty' }), 30)).toBe(0);
    expect(cachedForSeconds(page(200, null, { 'x-team-source': 'network' }), 0)).toBe(0);
    expect(cachedForSeconds(page(503, null, { 'x-team-source': 'network' }), 30)).toBe(0);
  });
});

describe('PageCache', () => {
  const entry = (text: string, headers: [string, string][] = [['content-type', 'text/html']]) => ({ status: 200, headers, body: bytes(text) });

  test('keeps a copy for the seconds it was given, then drops it', () => {
    let now = 1_000_000;
    const cache = new PageCache(() => now);
    expect(cache.set('/tim', entry('<p>a</p>'), 30)).toBe(true);
    expect(cache.get('/tim')).toBeDefined();
    now += 29_999;
    expect(cache.get('/tim')).toBeDefined();
    now += 1;
    expect(cache.get('/tim')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  test('a second copy of a key replaces the first, and its time starts again', () => {
    let now = 0;
    const cache = new PageCache(() => now);
    cache.set('/tim', entry('old'), 10);
    now += 9000;
    cache.set('/tim', entry('new'), 10);
    now += 9000;
    expect(new TextDecoder().decode(cache.get('/tim')!.body)).toBe('new');
  });

  test('holds 32 pages: the least recently used goes first, and reading one keeps it', () => {
    const cache = new PageCache(() => 0);
    for (let i = 0; i < 32; i++) cache.set(`/blog/a${i}`, entry(String(i)), 60);
    expect(cache.get('/blog/a0')).toBeDefined(); // a0 is now the newest
    cache.set('/blog/extra', entry('x'), 60);
    expect(cache.size).toBe(32);
    expect(cache.get('/blog/a1')).toBeUndefined();
    expect(cache.get('/blog/a0')).toBeDefined();
    expect(cache.get('/blog/extra')).toBeDefined();
  });

  test('a page over a mebibyte is not kept', () => {
    const cache = new PageCache(() => 0);
    expect(cache.set('/tim', { status: 200, headers: [], body: new ArrayBuffer(1024 * 1024 + 1) }, 30)).toBe(false);
    expect(cache.get('/tim')).toBeUndefined();
    expect(cache.set('/tim', { status: 200, headers: [], body: new ArrayBuffer(1024 * 1024) }, 30)).toBe(true);
  });
});

describe('responseFromEntry: the page that was rendered, byte for byte, and says it is a copy', () => {
  test('status, headers and bytes are the stored ones; every answer has its own body', async () => {
    const cache = new PageCache(() => 0);
    const text = '<!doctype html><p>Beranda — Bimbingan “Gratis” 🎓</p>';
    cache.set('/blog?page=1', { status: 200, headers: [['content-type', 'text/html; charset=utf-8'], ['cache-control', 'public, max-age=0, s-maxage=60'], ['x-page-cache', 'miss'], ['x-blog-source', 'network']], body: bytes(text) }, 30);
    const copy = cache.get('/blog?page=1')!;

    const first = responseFromEntry(copy);
    const second = responseFromEntry(copy);
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(first.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=60');
    expect(first.headers.get('x-blog-source')).toBe('network');
    // The stored `miss` of the render is replaced by `hit`.
    expect(first.headers.get('x-page-cache')).toBe('hit');
    expect(await first.text()).toBe(text);
    expect(await second.text()).toBe(text);
    expect(new TextDecoder().decode(copy.body)).toBe(text);
  });
});
