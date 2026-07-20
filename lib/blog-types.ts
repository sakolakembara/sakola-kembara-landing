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

/** Strip WordPress-style "[…]" / "…" trailers from a scraped excerpt. */
export function cleanExcerpt(excerpt: string): string {
  return excerpt
    .replace(/\[\s*&?hellip;\s*\]/gi, "...")
    .replace(/…\s*$/, "...")
    .trim();
}
