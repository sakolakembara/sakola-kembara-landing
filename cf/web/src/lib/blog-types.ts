/** Article metadata as produced by plugins/blog-content.mjs (no body). */
export interface BlogMeta {
  /** URL slug, also the filename without `.md`. */
  id: string;
  /** WordPress post ID, 0 for posts authored in the dashboard. */
  wpId: number;
  category: string;
  /** Indonesian display date, e.g. "21 Mei 2026". */
  date: string;
  /** Sort key. */
  dateISO: string;
  title: string;
  excerpt: string;
  featured: boolean;
  /** Cover image path, e.g. /blog/images/2026/05/x.jpg ("" when none). */
  image: string;
  /** Size of the file served at `image` (null when the pipeline has no such file). */
  imageWidth: number | null;
  imageHeight: number | null;
  /** WebP ladder for the cover's `srcset` (null when there is none). */
  imageSrcset: string | null;
  author: string;
  /** Origin URL when scraped from WordPress; empty for dashboard-authored. */
  sourceUrl: string;
  modifiedISO: string;
}

/** Strip WordPress-style "[…]" / "…" trailers from a scraped excerpt. Same as the root lib/blog-types.ts. */
export function cleanExcerpt(excerpt: string): string {
  return excerpt
    .replace(/\[\s*&?hellip;\s*\]/gi, '...')
    .replace(/…\s*$/, '...')
    .trim();
}
