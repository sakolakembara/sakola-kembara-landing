// Client-safe blog types + pure utilities. Anything that touches `fs`,
// `path`, `unstable_cache`, etc. stays in lib/blog.ts (server-only) so
// importing types from a client component doesn't drag Node modules into
// the browser bundle.

export interface BlogArticle {
  /** URL slug — also the filename without `.md`. Used for `/blog/[id]`. */
  id: string;
  /** WordPress post ID — 0 for posts authored in the dashboard. */
  wpId: number;
  category: string;
  /** Indonesian display date, e.g. "21 Mei 2026". */
  date: string;
  /** Sort key. */
  dateISO: string;
  title: string;
  excerpt: string;
  /** Markdown source. */
  contentMarkdown: string;
  featured: boolean;
  image: string;
  author: string;
  /** Origin URL when scraped from WordPress; empty for dashboard-authored. */
  sourceUrl: string;
  modifiedISO: string;
}

export const BLOG_CATEGORIES = [
  "Career",
  "Cerita",
  "Education",
  "Kiat kiat",
  "News",
  "Testimonials",
  "Tips",
  "Uncategorized",
] as const;

export type BlogCategory = (typeof BLOG_CATEGORIES)[number];

/** Grid size of the /blog index (and the default page size of the public API). */
export const BLOG_PAGE_SIZE = 15;

/**
 * Split a newest-first article list into the /blog index layout: one featured
 * article (the newest flagged `featured`, else the newest) plus the rest in
 * pages. `page` is clamped to the valid range, so the result always names the
 * page it actually returned.
 */
export function buildBlogIndex(
  sorted: BlogArticle[],
  page: number,
  pageSize: number = BLOG_PAGE_SIZE,
) {
  const featured = sorted.find((a) => a.featured) ?? sorted[0] ?? null;
  const grid = sorted.filter((a) => a.id !== featured?.id);
  const totalPages = Math.max(1, Math.ceil(grid.length / pageSize));
  const requested = Number.isFinite(page) ? Math.trunc(page) : 1;
  const currentPage = Math.min(Math.max(1, requested), totalPages);
  return {
    featured,
    items: grid.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    page: currentPage,
    totalPages,
    /** Articles in the grid, i.e. excluding the featured one. */
    total: grid.length,
  };
}

const RELATED_WINDOW_MS = 1000 * 60 * 60 * 24 * 180;

/**
 * "Artikel Lainnya" under a post: same category or published within 180 days
 * of it; falls back to the newest other posts when nothing matches.
 */
export function pickRelatedArticles(
  article: BlogArticle,
  sorted: BlogArticle[],
  limit = 3,
): BlogArticle[] {
  const others = sorted.filter((a) => a.id !== article.id);
  const related = others
    .filter(
      (a) =>
        a.category === article.category ||
        Math.abs(
          new Date(a.dateISO).getTime() - new Date(article.dateISO).getTime(),
        ) < RELATED_WINDOW_MS,
    )
    .slice(0, limit);
  return related.length > 0 ? related : others.slice(0, limit);
}

/** Strip WordPress-style "[…]" / "…" trailers from a scraped excerpt. */
export function cleanExcerpt(excerpt: string): string {
  return excerpt
    .replace(/\[\s*&?hellip;\s*\]/gi, "...")
    .replace(/…\s*$/, "...")
    .trim();
}
