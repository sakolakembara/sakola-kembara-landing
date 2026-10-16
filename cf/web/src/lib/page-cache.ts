// A short-lived copy of the rendered page, kept in the memory of the isolate (SAKEM-091). OFF unless `PAGE_CACHE_SECONDS`
// is set.
//
// Why it exists. Rendering an SSR page costs CPU however fresh its data is: a profile of the built Worker put more
// than half of a page in Astro's renderer and about a tenth in this repository's own code, and nothing the code does
// changes what the renderer costs per component (docs/cloudflare/free-plan-audit.md, "CPU on the hot routes"). The data is
// already kept 60 seconds (lib/content-api.ts), but only the DATA: every request still rendered the page. A copy of
// the page itself answers the next visitor of the same URL for a few seconds at the price of a lookup.
//
// Why memory and not the Cache API. The Cache API only works on a custom domain, so it could not be tried on
// `workers.dev` (docs/cloudflare/free-plan-audit.md, 3.4), and it is per data centre; an isolate's memory works
// everywhere, today, and is what a test can reach. The two are not exclusive: the data copy stays in the Cache API.
//
// What is cached, and when:
//   - only pages whose output depends on nothing but the API's data: an allow-list of paths (`pageCacheKey`), with
//     the query reduced to what the page reads (`/blog?page=N` only), so a probing `?x=1` shares the entry of `/blog`
//     and cannot create entries;
//   - only a 200 whose own Cache-Control allows at least a minute (`s-maxage=60`, the sitemap's 600): a stale answer
//     (an API outage: `s-maxage=30`), a 404 and a 503 are never copied;
//   - for at most the configured seconds and never longer than the page's own `s-maxage` (`cachedForSeconds`).
// A hit is the stored status, headers and body, plus `x-page-cache: hit`; a render that was stored says `miss`.
// Bounded: 32 entries (least recently used out) and 1 MiB a body.
//
// Staleness it adds: up to the configured seconds on top of the data's own (60 s fresh, up to 300 s of
// stale-while-revalidate and the team's 5 minutes). An admin save is not purged from here (nothing purges any cache
// of this site: docs/cloudflare/public-api.md, "Purge options"), so 30 s is the value to start with.

import { normalizePage } from '../../blog-contract.mjs';

/** The most seconds the setting can ask for: a copy older than this is never right for a page that says `s-maxage=60`. */
export const MAX_PAGE_CACHE_SECONDS = 120;
const MAX_ENTRIES = 32;
const MAX_BODY_BYTES = 1024 * 1024;
/** A page below this `s-maxage` is not a fresh answer (the loaders say 30 for a stale one): it is not copied. */
const MIN_PAGE_MAX_AGE = 60;

const ARTICLE_SLUG = /^[a-z0-9][a-z0-9_-]{0,199}$/;
const FIXED_PAGES = new Set(['/tim', '/donasi', '/gabung-siswa/docs', '/sitemap.xml']);

/** The setting as a whole number of seconds: 0 (off) for unset, empty, not a number or not above zero. Capped. */
export function pageCacheSeconds(value: string | undefined): number {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, MAX_PAGE_CACHE_SECONDS);
}

/** The entry a request for this URL would share, or null when the page is not one of those that may be copied. */
export function pageCacheKey(url: URL): string | null {
  const { pathname } = url;
  if (pathname === '/blog') return `/blog?page=${normalizePage(url.searchParams.get('page'))}`;
  if (FIXED_PAGES.has(pathname)) return pathname;
  if (pathname.startsWith('/blog/')) {
    const slug = pathname.slice('/blog/'.length);
    return ARTICLE_SLUG.test(slug) ? `/blog/${slug}` : null;
  }
  return null;
}

/** How long this answer may be copied: 0 when it must not be, else min(configured, the page's own `s-maxage`). */
export function cachedForSeconds(response: Pick<Response, 'status' | 'headers'>, configured: number): number {
  if (configured <= 0 || response.status !== 200) return 0;
  if (response.headers.has('set-cookie')) return 0;
  // /tim says no Cache-Control (its data has its own five-minute window) but names where the data came from: a fresh
  // answer (the API or the data cache) may be copied for the configured time; stale or empty data, which still answers
  // 200 there, is never copied.
  const teamSource = response.headers.get('x-team-source');
  if (teamSource !== null) return teamSource === 'network' || teamSource === 'cache' ? configured : 0;
  const control = response.headers.get('cache-control') ?? '';
  if (/\b(no-store|private)\b/i.test(control)) return 0;
  const sMaxAge = Number(/\bs-maxage=(\d+)/i.exec(control)?.[1] ?? 0);
  return sMaxAge >= MIN_PAGE_MAX_AGE ? Math.min(configured, sMaxAge) : 0;
}

export interface PageCacheEntry {
  status: number;
  headers: [string, string][];
  /** The bytes as rendered: a hit is byte for byte the page that was stored. */
  body: ArrayBuffer;
  /** ms since the epoch the copy stops being served. */
  expiresAt: number;
}

export class PageCache {
  #entries = new Map<string, PageCacheEntry>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  get size(): number {
    return this.#entries.size;
  }

  /** The copy, or undefined when there is none or it has expired (it is dropped). A hit becomes the most recently used. */
  get(key: string): PageCacheEntry | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.#now()) {
      this.#entries.delete(key);
      return undefined;
    }
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry;
  }

  /** Keeps the copy for `seconds`; false (nothing kept) when the body is too big. */
  set(key: string, response: { status: number; headers: [string, string][]; body: ArrayBuffer }, seconds: number): boolean {
    if (response.body.byteLength > MAX_BODY_BYTES) return false;
    this.#entries.delete(key);
    this.#entries.set(key, { ...response, expiresAt: this.#now() + seconds * 1000 });
    while (this.#entries.size > MAX_ENTRIES) this.#entries.delete(this.#entries.keys().next().value as string);
    return true;
  }

  clear(): void {
    this.#entries.clear();
  }
}

/** The answer a copy stands for. `x-page-cache: hit` tells it from a render. */
export function responseFromEntry(entry: PageCacheEntry): Response {
  const headers = new Headers(entry.headers);
  headers.set('x-page-cache', 'hit');
  // A copy of the bytes per answer: the stored buffer is shared by every hit and must stay as it was.
  return new Response(entry.body.slice(0), { status: entry.status, headers });
}

/** The isolate's copy of the pages. */
export const pageCache = new PageCache();
