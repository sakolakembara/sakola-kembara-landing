// The blog data source the pages read from. One interface, two implementations:
//
//   api       the content API (this file): `GET /api/public/blog` and `/blog/{slug}` through the shared
//             loader of lib/content-api.ts (the Cache API, 60 s fresh, stale-if-error, the contract's
//             404 as "not found"). What production runs.
//   markdown  the build-time adapter (blog-markdown.ts): the root content/blog/*.md rendered by the
//             same pipeline the build always used, bundled into the Worker. A fixture for local
//             development and tests (`BLOG_SOURCE=markdown`, see getBlogSource in blog.ts), never
//             what production runs.
//
// The pages only see BlogSource, so they cannot tell which one answered. A result is the loader's
// `{ data, source }`: `data` null with source `not_found` is a real 404, with `empty` an outage that
// has no copy to fall back on (a 503 page), see contentPageHeaders.

import { BLOG_SLUG, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../blog-contract.mjs';
import { loadContent, type ContentResult, type ContentRuntime, type ContentSource } from './content-api';
import type { ApiTarget } from './api-client';
import {
  parseBlogArticle,
  parseBlogList,
  type BlogArticlePayload,
  type BlogListPayload,
  type BlogSummary,
} from './blog-api';

/** The loader's sources, plus `build` for the markdown fixture (no cache, no network: always fresh). */
export type BlogSourceName = ContentSource | 'build';
export type BlogResult<T> = Omit<ContentResult<T>, 'source'> & { source: BlogSourceName };

export interface BlogSource {
  readonly kind: 'api' | 'markdown';
  /** One page of the index: the featured article (always) and the rest. `page` is clamped by the source. */
  list(page: number, pageSize?: number): Promise<BlogResult<BlogListPayload>>;
  /** An article with up to three related summaries; `not_found` for an unknown or unpublished slug. */
  article(slug: string): Promise<BlogResult<BlogArticlePayload>>;
  /** Every published article, newest first, featured included (the sitemap). Null rather than a partial list. */
  all(): Promise<BlogResult<BlogSummary[]>>;
}

/** The loader source a page's headers are chosen by: the fixture counts as a fresh answer. */
export const headerSource = (source: BlogSourceName): ContentSource => (source === 'build' ? 'cache' : source);

/** Newest first, ties by slug: the order of the build-time index (plugins/blog-content.mjs). */
export const newestFirst = (a: BlogSummary, b: BlogSummary): number =>
  new Date(b.dateISO).getTime() - new Date(a.dateISO).getTime() || a.slug.localeCompare(b.slug);

/** How long the contract's `404 not_found` is remembered (its own `s-maxage=30`). */
export const BLOG_NOT_FOUND_TTL_SECONDS = 30;

export interface ApiBlogSourceOptions extends Pick<ContentRuntime, 'cache' | 'waitUntil' | 'freshTtlSeconds'> {
  target: ApiTarget | null;
  timeoutMs?: number;
  onFailure?: (reason: string) => void;
}

export function createApiBlogSource(opts: ApiBlogSourceOptions): BlogSource {
  const { target, cache, waitUntil, freshTtlSeconds, timeoutMs, onFailure } = opts;
  const common = { baseUrl: target?.base, fetchImpl: target?.fetchImpl, cache, waitUntil, freshTtlSeconds, timeoutMs, onFailure };

  const list = (page: number, pageSize = DEFAULT_PAGE_SIZE): Promise<BlogResult<BlogListPayload>> => {
    const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(pageSize)));
    return loadContent({
      ...common,
      path: `/api/public/blog?page=${Math.max(1, Math.trunc(page))}&pageSize=${size}`,
      parse: parseBlogList,
      serialize: JSON.stringify,
    });
  };

  const article = async (slug: string): Promise<BlogResult<BlogArticlePayload>> => {
    // A slug outside the grammar cannot exist: answer without a subrequest or a cache entry.
    if (!BLOG_SLUG.test(slug)) return { data: null, source: 'not_found' };
    const result = await loadContent({
      ...common,
      path: `/api/public/blog/${encodeURIComponent(slug)}`,
      parse: parseBlogArticle,
      serialize: JSON.stringify, // drops contentMarkdown: unused here, and half of the payload
      notFoundTtlSeconds: BLOG_NOT_FOUND_TTL_SECONDS,
    });
    // The related list never holds the article itself, whatever the API sends.
    return result.data ? { ...result, data: { ...result.data, related: result.data.related.filter((r) => r.slug !== slug) } } : result;
  };

  const all = async (): Promise<BlogResult<BlogSummary[]>> => {
    // Enumerate as the contract says: page through with pageSize=50 and add `featured`, which `articles` leaves out.
    const first = await list(1, MAX_PAGE_SIZE);
    if (!first.data) return { data: null, source: 'empty' };
    const rest = await Promise.all(Array.from({ length: first.data.totalPages - 1 }, (_, i) => list(i + 2, MAX_PAGE_SIZE)));
    const pages = [first, ...rest];
    const bySlug = new Map<string, BlogSummary>();
    for (const p of pages) {
      if (!p.data) return { data: null, source: 'empty' }; // a sitemap without some articles is worse than none
      for (const a of [...(p.data.featured ? [p.data.featured] : []), ...p.data.articles]) bySlug.set(a.slug, a);
    }
    const sources = pages.map((p) => p.source);
    const source: BlogSourceName = sources.includes('stale') ? 'stale' : sources.includes('network') ? 'network' : 'cache';
    return { data: [...bySlug.values()].sort(newestFirst), source };
  };

  return { kind: 'api', list, article, all };
}
