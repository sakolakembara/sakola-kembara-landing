// The blog rules of the content API contract (docs/cloudflare/content-api.md),
// in one pure module with no imports and no Node APIs, so there is ONE
// implementation of them. It is shared by:
//
//   - src/lib/blog.ts          the build-time markdown adapter, and the sync helpers
//                              (getRelated, getBlogPage) that the home page and the
//                              tests still use
//   - scripts/fixture-api.mjs  the local stand-in for the Worker API
//   - the tests                parity between that adapter and the API client
//
// The real API (cf/api) must implement the same rules; its tests can import this
// file as the reference. Nothing here knows about Astro, Workers or the
// filesystem. Inputs are summaries with the wire names of the contract: `slug`
// (not the legacy `id`), already sorted newest first.
//
// Same style as assets.config.mjs and redirects.config.mjs: plain JS with JSDoc,
// importable from both the Node scripts and the TypeScript sources.

/**
 * @typedef {{
 *   slug: string; title: string; category: string; date: string; dateISO: string;
 *   excerpt: string; image: string | null; imageWidth: number | null; imageHeight: number | null;
 *   author: string; featured: boolean;
 * }} BlogSummary
 */

/** Page size when `pageSize` is missing or not a number. */
export const DEFAULT_PAGE_SIZE = 15;
/** `pageSize` is bounded to 1..MAX_PAGE_SIZE (the sitemap pages with the maximum). */
export const MAX_PAGE_SIZE = 50;
/** A candidate is "related" when it is dated within this many days of the article. */
export const RELATED_WINDOW_DAYS = 180;
/** How many related summaries an article carries. */
export const RELATED_COUNT = 3;
/**
 * The site never asks the API for a page above this (a request for `?page=999999` is
 * clamped here, then by the API to the last page), so probing URLs cannot create an
 * unbounded number of cache entries and API queries.
 */
export const MAX_LIST_PAGE = 500;

/** Strip WordPress-style "[…]" / "…" trailers from a scraped excerpt. Same as the root lib/blog-types.ts. */
export function cleanExcerpt(excerpt) {
  return excerpt
    .replace(/\[\s*&?hellip;\s*\]/gi, '...')
    .replace(/…\s*$/, '...')
    .trim();
}

/**
 * Integer from a query value the way the legacy page reads `?page=`: parseInt
 * semantics ("2.9" is 2), anything that is not a number is `fallback`.
 * @param {string | number | null | undefined} raw
 * @param {number} fallback
 */
export function intOr(raw, fallback) {
  const n = Number.parseInt(String(raw ?? ''), 10);
  return Number.isNaN(n) ? fallback : n;
}

/** `pageSize` of the contract: default 15, bounded to 1..50, non-numeric means the default. */
export function clampPageSize(raw) {
  return Math.min(MAX_PAGE_SIZE, Math.max(1, intOr(raw, DEFAULT_PAGE_SIZE)));
}

/**
 * The `page` the site asks the API for: a positive integer, capped at MAX_LIST_PAGE.
 * (The API clamps to the last real page itself; this is only the upper guard.)
 */
export function normalizePage(raw) {
  return Math.min(MAX_LIST_PAGE, Math.max(1, intOr(raw, 1)));
}

/** The featured article of the index: the newest one flagged `featured`, otherwise the newest. */
export function pickFeatured(/** @type {BlogSummary[]} */ list) {
  return list.find((a) => a.featured) ?? list[0] ?? null;
}

/**
 * GET /api/public/blog: the featured article (always returned, never repeated in
 * `articles`) plus the rest in pages. `page` is clamped to 1..totalPages (never an
 * error), `total` counts the articles across all pages WITHOUT the featured one.
 * @param {BlogSummary[]} list every published article, newest first
 */
export function buildListPayload(list, rawPage, rawPageSize) {
  const pageSize = clampPageSize(rawPageSize);
  const featured = pickFeatured(list);
  const rest = list.filter((a) => a.slug !== featured?.slug);
  const totalPages = Math.max(1, Math.ceil(rest.length / pageSize));
  const page = Math.min(Math.max(1, intOr(rawPage, 1)), totalPages);
  return {
    featured,
    articles: rest.slice((page - 1) * pageSize, page * pageSize),
    page,
    pageSize,
    total: rest.length,
    totalPages,
  };
}

/**
 * The related summaries of an article: same category OR dated within 180 days,
 * first three in newest-first order; when none qualify, the three newest others.
 * Never the article itself.
 * @param {BlogSummary} article
 * @param {BlogSummary[]} list newest first
 */
export function pickRelated(article, list) {
  const others = list.filter((a) => a.slug !== article.slug);
  const windowMs = 1000 * 60 * 60 * 24 * RELATED_WINDOW_DAYS;
  const related = others
    .filter(
      (a) =>
        a.category === article.category ||
        Math.abs(new Date(a.dateISO).getTime() - new Date(article.dateISO).getTime()) < windowMs,
    )
    .slice(0, RELATED_COUNT);
  return related.length > 0 ? related : others.slice(0, RELATED_COUNT);
}

/**
 * Wire summary of the build-time metadata (plugins/blog-content.mjs): the field names
 * and nulls of the contract. The metadata carries the markup form of the cover URL
 * (`@` written as `%40`, see assetUrl in assets.config.mjs); the wire carries the path as stored.
 * @param {{ id: string; title: string; category: string; date: string; dateISO: string; excerpt: string;
 *           image: string; imageWidth: number | null; imageHeight: number | null; author: string; featured: boolean }} meta
 * @returns {BlogSummary}
 */
export function toWireSummary(meta) {
  return {
    slug: meta.id,
    title: meta.title,
    category: meta.category,
    date: meta.date,
    dateISO: meta.dateISO,
    excerpt: cleanExcerpt(meta.excerpt),
    image: meta.image ? meta.image.replace(/%40/g, '@') : null,
    imageWidth: meta.image ? meta.imageWidth : null,
    imageHeight: meta.image ? meta.imageHeight : null,
    author: meta.author,
    featured: meta.featured,
  };
}

/**
 * A slug the site will ask the API about. A request for anything else is a real
 * 404 without a subrequest, so garbage URLs cost no API query and no cache entry.
 * Real slugs are lower-case words joined by hyphens (the 80 migrated ones); a slug
 * the admin ever allows beyond this grammar needs this pattern widened.
 */
export const BLOG_SLUG = /^[a-z0-9][a-z0-9_-]{0,199}$/;
