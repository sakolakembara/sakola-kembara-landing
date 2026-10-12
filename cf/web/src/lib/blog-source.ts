// The blog data source the pages read from. One interface, two implementations:
//
//   api       the content API (this file): `GET /api/public/blog` and `/blog/{slug}` through the
//             Cache API with stale-if-error. What production runs.
//   markdown  the build-time adapter (blog-markdown.ts): the root content/blog/*.md rendered by the
//             same pipeline the build always used, bundled into the Worker. A fixture for local
//             development and tests (`BLOG_SOURCE=markdown`, see getBlogSource in blog.ts), never
//             what production runs.
//
// The pages only see BlogSource, so they cannot tell which one answered.

import { BLOG_SLUG, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from '../../blog-contract.mjs';
import { loadJson, type CacheSource, type Loaded } from './api-cache';
import type { ApiTarget } from './api-client';
import {
  parseBlogArticle,
  parseBlogList,
  type BlogArticlePayload,
  type BlogListPayload,
  type BlogSummary,
} from './blog-api';

export type BlogSourceName = CacheSource | 'build';
export type BlogResult<T> = Loaded<T, BlogSourceName>;

export interface BlogSource {
  readonly kind: 'api' | 'markdown';
  /** One page of the index: the featured article (always) and the rest. `page` is clamped by the source. */
  list(page: number, pageSize?: number): Promise<BlogResult<BlogListPayload>>;
  /** An article with up to three related summaries, or `not_found`. */
  article(slug: string): Promise<BlogResult<BlogArticlePayload>>;
  /** Every published article, newest first, featured included (the sitemap). `unavailable` rather than a partial list. */
  all(): Promise<BlogResult<BlogSummary[]>>;
}

/** Newest first, ties by slug: the order of the build-time index (plugins/blog-content.mjs). */
export const newestFirst = (a: BlogSummary, b: BlogSummary): number =>
  new Date(b.dateISO).getTime() - new Date(a.dateISO).getTime() || a.slug.localeCompare(b.slug);

export interface ApiBlogSourceOptions {
  target: ApiTarget | null;
  cache?: Pick<Cache, 'match' | 'put' | 'delete'>;
  waitUntil?: (promise: Promise<unknown>) => void;
  /** How long a fetched page or article is served from the cache before the API is asked again. Default 60 s (the contract's s-maxage). */
  freshTtlSeconds?: number;
  timeoutMs?: number;
  onFailure?: (reason: string) => void;
}

export function createApiBlogSource(opts: ApiBlogSourceOptions): BlogSource {
  const { target, cache, waitUntil, freshTtlSeconds, timeoutMs, onFailure } = opts;
  const common = { cache, waitUntil, fetchImpl: target?.fetchImpl, freshTtlSeconds, timeoutMs, onFailure };

  const list = async (page: number, pageSize = DEFAULT_PAGE_SIZE): Promise<BlogResult<BlogListPayload>> => {
    if (!target) return { status: 'unavailable' };
    const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(pageSize)));
    const url = `${target.base}/api/public/blog?page=${Math.max(1, Math.trunc(page))}&pageSize=${size}`;
    return loadJson({ ...common, url, parse: parseBlogList });
  };

  const article = async (slug: string): Promise<BlogResult<BlogArticlePayload>> => {
    // A slug outside the grammar cannot exist: answer without a subrequest or a cache entry.
    if (!BLOG_SLUG.test(slug)) return { status: 'not_found', source: 'build' };
    if (!target) return { status: 'unavailable' };
    const url = `${target.base}/api/public/blog/${encodeURIComponent(slug)}`;
    const result = await loadJson({ ...common, url, parse: parseBlogArticle });
    // The related list never holds the article itself, whatever the API sends.
    return result.status === 'ok'
      ? { ...result, data: { ...result.data, related: result.data.related.filter((r) => r.slug !== slug) } }
      : result;
  };

  const all = async (): Promise<BlogResult<BlogSummary[]>> => {
    // Enumerate as the contract says: page through with pageSize=50 and add `featured`, which `articles` leaves out.
    const first = await list(1, MAX_PAGE_SIZE);
    if (first.status !== 'ok') return { status: 'unavailable' };
    const rest = await Promise.all(Array.from({ length: first.data.totalPages - 1 }, (_, i) => list(i + 2, MAX_PAGE_SIZE)));
    const pages = [first, ...rest];
    if (pages.some((p) => p.status !== 'ok')) return { status: 'unavailable' };
    const bySlug = new Map<string, BlogSummary>();
    for (const p of pages) {
      if (p.status !== 'ok') continue;
      for (const a of [...(p.data.featured ? [p.data.featured] : []), ...p.data.articles]) bySlug.set(a.slug, a);
    }
    const sources = pages.map((p) => (p.status === 'ok' ? p.source : 'network'));
    const source: BlogSourceName = sources.includes('stale') ? 'stale' : sources.includes('network') ? 'network' : 'cache';
    return { status: 'ok', source, data: [...bySlug.values()].sort(newestFirst) };
  };

  return { kind: 'api', list, article, all };
}
