// The blog, as the pages read it.
//
//   getBlogSource()   what /blog, /blog/<slug> and the sitemap call: the content API in
//                     production (through the shared loader of content-api.ts), the build-time
//                     markdown adapter when the build says so
//   cover helpers     <img> attributes for a cover given by path (the API sends the path,
//                     the width and the height; the srcset comes from the asset manifest)
//   pageNumbers ...   the pagination control
//   getAllArticles    the build-time metadata index (virtual:blog-index), SYNC. The home page's
//   getBlogPage       "Cerita & Inspirasi" strip reads it at build time, and tests use it as the
//   getRelated        reference. They are thin wrappers over blog-contract.mjs, the one
//                     implementation of the contract's rules.
//
// Which data source runs is decided when the bundle is built (env var `BLOG_SOURCE`, read by
// astro.config.mjs and vitest.config.ts):
//
//   BLOG_SOURCE=api       (default) the content API. Nothing of the markdown is in the Worker.
//   BLOG_SOURCE=markdown  the root content/blog rendered at build time and bundled into the Worker,
//                         for `pnpm dev` without the fixture API and for tests. Never for a deploy.

import { articles } from 'virtual:blog-index';
import {
  DEFAULT_PAGE_SIZE,
  buildListPayload,
  pickRelated,
  toWireSummary,
} from '../../blog-contract.mjs';
import { contentApiTarget, type ApiEnv } from './api-client';
import { findImage } from './images';
import { assetUrl, srcsetFor } from '../../assets.config.mjs';
import { createApiBlogSource, type BlogSource } from './blog-source';
import type { BlogMeta } from './blog-types';

export { cleanExcerpt } from './blog-types';
export type { BlogMeta } from './blog-types';
export type { BlogSource, BlogResult } from './blog-source';
export { headerSource } from './blog-source';
export type { BlogArticle, BlogArticlePayload, BlogListPayload, BlogSummary } from './blog-api';
export { BLOG_SLUG, normalizePage } from '../../blog-contract.mjs';

/** Set by the build (vite `define`, see astro.config.mjs and vitest.config.ts). */
declare const __BLOG_SOURCE__: 'api' | 'markdown';

export const PAGE_SIZE = DEFAULT_PAGE_SIZE;

export interface BlogRuntime {
  env: ApiEnv & {
    /** Seconds a fetched list, blog page or article is served from the cache before the API is asked again (default 60). */
    CONTENT_CACHE_FRESH_SECONDS?: string;
  };
  /** caches.default when the runtime has it. */
  cache?: Pick<Cache, 'match' | 'put'> & Partial<Pick<Cache, 'delete'>>;
  /** ctx.waitUntil, so cache writes do not delay the response. */
  waitUntil?: (promise: Promise<unknown>) => void;
}

/** The data source of this build. */
export async function getBlogSource({ env, cache, waitUntil }: BlogRuntime): Promise<BlogSource> {
  if (__BLOG_SOURCE__ === 'markdown') {
    // Behind a build-time constant: a production build drops this branch, and with it every article body.
    return (await import('./blog-markdown')).markdownBlogSource;
  }
  return createApiBlogSource({
    target: contentApiTarget(env),
    cache,
    waitUntil,
    freshTtlSeconds: Number(env.CONTENT_CACHE_FRESH_SECONDS) || undefined,
    // Reasons only, never a payload: this runs on every failed API call.
    onFailure: (reason) => console.warn(`blog api: ${reason}`),
  });
}

// ---- covers ----------------------------------------------------------------

export interface CoverAttrs {
  src: string;
  /** The WebP ladder, when the asset manifest knows the file (every migrated article). */
  srcset?: string;
  width?: number;
  height?: number;
}

/**
 * <img> attributes for a cover or a card image given by its path as the API stores it.
 * A file the asset pipeline made (the 235 migrated images) gets its WebP `srcset` and its
 * `@` written as `%40`; any other path (an upload in R2, an external URL) is used as given.
 * The size comes from the API (recorded at upload); the manifest's is the fallback.
 */
export function coverAttrs(image: string | null, width: number | null, height: number | null): CoverAttrs | null {
  if (!image) return null;
  const entry = findImage(image);
  const w = width ?? entry?.width;
  const h = height ?? entry?.height;
  return {
    src: entry ? assetUrl(image) : image,
    ...(entry ? { srcset: srcsetFor(entry) } : {}),
    ...(w && h ? { width: w, height: h } : {}),
  };
}

// ---- pagination ------------------------------------------------------------

/** Compact page list with ellipses, as in the Next pagination control. */
export function pageNumbers(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | '…')[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push('…');
  for (let p = start; p <= end; p++) out.push(p);
  if (end < total - 1) out.push('…');
  out.push(total);
  return out;
}

export const pageHref = (page: number) => (page === 1 ? '/blog' : `/blog?page=${page}`);

// ---- the build-time index (home page strip, tests) ---------------------------

/** Every article, newest first (the plugin sorts them). */
export function getAllArticles(): BlogMeta[] {
  return articles;
}

export function getArticleBySlug(slug: string): BlogMeta | null {
  return articles.find((a) => a.id === slug) ?? null;
}

/**
 * Same rule as the Next article page and the API: same category OR within 180 days,
 * newest first, three of them; fall back to the three newest others.
 */
export function getRelated(article: BlogMeta, list: BlogMeta[] = articles): BlogMeta[] {
  const byId = new Map(list.map((a) => [a.id, a]));
  return pickRelated(toWireSummary(article), list.map(toWireSummary)).flatMap((r) => byId.get(r.slug) ?? []);
}

export interface BlogPage {
  featured: BlogMeta | null;
  items: BlogMeta[];
  currentPage: number;
  totalPages: number;
}

/**
 * The /blog list for a `?page=` value, as the Next page computes it: the
 * featured (or newest) article is shown only on page 1, the rest is paged by
 * 15. A missing, non-numeric or out-of-range page is clamped, never an error.
 */
export function getBlogPage(rawPage: string | null | undefined, list: BlogMeta[] = articles): BlogPage {
  const byId = new Map(list.map((a) => [a.id, a]));
  const payload = buildListPayload(list.map(toWireSummary), rawPage, PAGE_SIZE);
  return {
    featured: payload.page === 1 && payload.featured ? (byId.get(payload.featured.slug) ?? null) : null,
    items: payload.articles.flatMap((a) => byId.get(a.slug) ?? []),
    currentPage: payload.page,
    totalPages: payload.totalPages,
  };
}
