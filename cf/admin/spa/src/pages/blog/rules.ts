// What the blog screens know that is not React: the field limits (a copy of the Worker's `src/blog/rules.ts`; a
// Worker test fails when they differ), the legacy date and author helpers, and the two small text functions of the
// editor. Pure: no DOM, no React, so the Worker's contract test can import it.

/** The fixed list of the legacy admin (lib/blog-types.ts BLOG_CATEGORIES), also the Worker's `blogCategories`. */
export const BLOG_CATEGORIES = ["Career", "Cerita", "Education", "Kiat kiat", "News", "Testimonials", "Tips", "Uncategorized"] as const;
export type BlogCategory = (typeof BLOG_CATEGORIES)[number];

/** The limits of the form: the legacy ones, and the body's lowered to what rendering on the Worker can afford (docs/cloudflare/admin-blog.md). */
export const LIMITS = {
  titleMin: 3,
  titleMax: 200,
  excerptMin: 20,
  excerptMax: 500,
  bodyMin: 50,
  bodyMax: 12_000,
  authorMin: 2,
  authorMax: 120,
  slugMax: 160,
  /** The hard limit of the meta description (SAKEM-094), counted on the cleaned text. */
  metaDescriptionMax: 300,
  /** The hard limit of the SEO title (SAKEM-109), counted on the cleaned text. */
  seoTitleMax: 70,
} as const;

/** What the form tells the writer to aim for in an SEO title (SAKEM-109). Guidance only. */
export const SEO_TITLE_IDEAL = { min: 30, max: 60 } as const;

/** What the form tells the writer to aim for in a meta description: about what a search result shows before it cuts the text. Guidance only: nothing is refused for it. */
export const META_DESCRIPTION_IDEAL = { min: 50, max: 160 } as const;

/**
 * The meta description as the Worker stores it (a copy of `cleanMetaDescription` in the Worker's `src/blog/rules.ts`; a
 * Worker test compares the two on a matrix): invisible characters removed, every run of whitespace one space, trimmed.
 * The form counts this, so the number it shows is the number that will be stored.
 */
export function cleanMetaDescription(raw: string): string {
  return raw
    .replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, (char) => (/^[\t\n\v\f\r\u0085]$/.test(char) ? " " : ""))
    .replace(/\s+/g, " ")
    .trim();
}

/** A copy of the Worker's `cleanSeoTitle` (SAKEM-109): the meta description's cleaning, under the SEO title's own name. */
export function cleanSeoTitle(raw: string): string {
  return cleanMetaDescription(raw);
}

/** A copy of the Worker's `hasMarkup`: true when a cleaned text holds what the HTML tokenizer reads as a tag, a comment or a doctype. Used by the mock; the form only counts. */
export function hasMarkup(cleaned: string): boolean {
  return /<[A-Za-z/!?]/.test(cleaned);
}

/** "12.000", the way the Worker's message writes the limit. */
export const BODY_LIMIT_LABEL = String(LIMITS.bodyMax).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** How long the preview waits after the last keystroke before it asks the Worker to render. */
export const PREVIEW_DELAY_MS = 400;

const MONTHS_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

/** "2026-05-21" becomes "21 Mei 2026" (the legacy `formatDateIndonesian`); anything else is returned as it came. */
export function formatIsoDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const month = Number(match[2]) - 1;
  if (month < 0 || month > 11) return iso;
  return `${Number(match[3])} ${MONTHS_ID[month]} ${match[1]}`;
}

/** The author a new article starts with: the part of the signed-in email before the "@", dots, hyphens and underscores as spaces (as the legacy page did). */
export function defaultAuthor(email: string | null | undefined): string {
  const local = email?.split("@")[0]?.replace(/[.\-_]/g, " ").trim();
  return local ? local : "Sakola Kembara";
}

/** The alt text of a picture that has only a file name: the name without its extension, dashes and underscores as spaces (the legacy rule). */
export function altFromFileName(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]/g, " ")
    .replace(/[\[\]\r\n]/g, " ")
    .trim();
}
