// The pure rules of the public blog index, ported from the legacy
// lib/blog-types.ts (buildBlogIndex, pickRelatedArticles, cleanExcerpt) and
// the contract (docs/cloudflare/content-api.md). The SQL in queries.ts applies
// the same rules inside D1 so a request never loads every article; the pure
// versions stay here as the reference the tests compare the SQL against.

import { dayNumberJakarta, startOfDayJakarta } from "./dates";

/** Default page size of the index, and the legacy fixed size. */
export const BLOG_PAGE_SIZE = 15;
export const BLOG_MAX_PAGE_SIZE = 50;
export const RELATED_LIMIT = 3;
/** "Within 180 days" of the legacy rule: strictly less than 180 days apart. */
export const RELATED_WINDOW_DAYS = 180;

/** Strip WordPress-style "[...]" / "..." trailers from an imported excerpt (legacy cleanExcerpt). */
export function cleanExcerpt(excerpt: string): string {
  return excerpt
    .replace(/\[\s*&?hellip;\s*\]/gi, "...")
    .replace(/…\s*$/, "...")
    .trim();
}

/**
 * A query-string integer: optional sign and digits only. Anything else
 * ("abc", "", "3abc", "1.5") is `undefined`, which callers turn into the
 * default, so a bad value is never an error (contract).
 */
export function parseIntParam(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^[+-]?\d+$/.test(raw.trim())) return undefined;
  // A very long run of digits becomes Infinity, which the callers clamp like any other out-of-range value.
  return Number(raw.trim());
}

/** `pageSize`: default 15, bounded to 1..50. */
export function resolvePageSize(raw: string | undefined): number {
  const n = parseIntParam(raw);
  if (n === undefined) return BLOG_PAGE_SIZE;
  return Math.min(BLOG_MAX_PAGE_SIZE, Math.max(1, n));
}

/** The index page maths for `total` grid articles (the featured one excluded). */
export function pageWindow(total: number, pageSize: number, requestedPage: number | undefined) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, requestedPage ?? 1), totalPages);
  return { page, totalPages, offset: (page - 1) * pageSize };
}

/**
 * The range of publication instants that count as "dated within 180 days" of
 * an article: the legacy rule compared the two calendar days (`dateISO`, parsed
 * as UTC midnight) and required less than 180 days between them, so the other
 * article's Jakarta day must lie in [day - 179, day + 179]. Returned as a
 * half-open instant range `[from, to)` so it is a plain range on the indexed
 * `published_at` column.
 */
export function relatedWindow(publishedAtMs: number): { from: number; to: number } {
  const day = dayNumberJakarta(publishedAtMs);
  return { from: startOfDayJakarta(day - (RELATED_WINDOW_DAYS - 1)), to: startOfDayJakarta(day + RELATED_WINDOW_DAYS) };
}

export interface RelatableArticle {
  slug: string;
  category: string;
  publishedAtMs: number;
}

/**
 * Reference implementation of the related-articles rule: `sorted` is every
 * published article newest first. Same category OR within 180 days, first
 * three; when nothing matches, the three newest others.
 */
export function pickRelatedArticles<T extends RelatableArticle>(article: RelatableArticle, sorted: T[], limit = RELATED_LIMIT): T[] {
  const { from, to } = relatedWindow(article.publishedAtMs);
  const others = sorted.filter((a) => a.slug !== article.slug);
  const related = others.filter((a) => a.category === article.category || (a.publishedAtMs >= from && a.publishedAtMs < to)).slice(0, limit);
  return related.length > 0 ? related : others.slice(0, limit);
}
