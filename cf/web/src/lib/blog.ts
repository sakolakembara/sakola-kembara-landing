// Blog reader over the virtual module built by plugins/blog-content.mjs.
// Only metadata is imported here, so it is safe in SSR pages (/blog) and in
// the Worker bundle. Article bodies come from `virtual:blog-bodies`, which only
// the prerendered article pages import.

import { articles } from 'virtual:blog-index';
import type { BlogMeta } from './blog-types';

export { cleanExcerpt } from './blog-types';
export type { BlogMeta } from './blog-types';

export const PAGE_SIZE = 15;

/** Every article, newest first (the plugin sorts them). */
export function getAllArticles(): BlogMeta[] {
  return articles;
}

export function getArticleBySlug(slug: string): BlogMeta | null {
  return articles.find((a) => a.id === slug) ?? null;
}

/**
 * Same rule as the Next article page: same category OR within 180 days,
 * newest first, three of them; fall back to the three newest others.
 */
export function getRelated(article: BlogMeta, list: BlogMeta[] = articles): BlogMeta[] {
  const others = list.filter((a) => a.id !== article.id);
  const window = 1000 * 60 * 60 * 24 * 180;
  const related = others
    .filter(
      (a) =>
        a.category === article.category ||
        Math.abs(new Date(a.dateISO).getTime() - new Date(article.dateISO).getTime()) < window,
    )
    .slice(0, 3);
  return related.length > 0 ? related : others.slice(0, 3);
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
  const featuredArticle = list.find((a) => a.featured) ?? list[0] ?? null;
  const grid = list.filter((a) => a.id !== featuredArticle?.id);
  const totalPages = Math.max(1, Math.ceil(grid.length / PAGE_SIZE));
  const requested = Number.parseInt(rawPage ?? '1', 10);
  const currentPage = Math.min(Math.max(1, Number.isNaN(requested) ? 1 : requested), totalPages);
  return {
    featured: currentPage === 1 ? featuredArticle : null,
    items: grid.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    currentPage,
    totalPages,
  };
}

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
