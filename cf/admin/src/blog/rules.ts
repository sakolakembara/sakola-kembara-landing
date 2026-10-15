import { startOfDayJakarta } from "../public/dates";

// The pure rules of a blog article, ported from the legacy admin (app/(admin)/admin/blog/actions.ts,
// lib/blog-writer.ts, lib/blog-types.ts) and the few the new storage needs (docs/cloudflare/admin-blog.md).
// No imports from the rest of the app but the Jakarta date helpers, so the tests and the import script
// use them as they are.

/** The legacy field limits and their messages (the legacy `baseSchema`). */
export const TITLE_MIN = 3;
export const TITLE_MAX = 200;
export const EXCERPT_MIN = 20;
export const EXCERPT_MAX = 500;
export const BODY_MIN = 50;
export const AUTHOR_MIN = 2;
export const AUTHOR_MAX = 120;
export const IMAGE_PATH_MAX = 500;

/**
 * The longest article body, in characters. The legacy limit was 80,000; the longest of the 80 migrated
 * articles is 8,340 and the median 4,444. The markdown is rendered to HTML on the Worker when it is saved,
 * and rendering costs about 0.45 ms of CPU per 1,000 characters once warm (about 3.9 ms for 8,340; 24 ms
 * for 80,000, measured in Node, `pnpm measure:blog`), against 10 ms per request on Workers Free, and two to
 * three times that in a cold isolate. 12,000 characters (about 2,000 words, 1.4 times the longest article
 * there is) keeps a warm save near 5 ms. 40,000 characters take about 12 ms warm, over the limit on their own, so
 * it was not raised (PM, 2026-10-12). Raise it only with a measurement from a real Free account (SAKEM-084).
 */
export const BODY_MAX = 12_000;

/**
 * The meta description (SAKEM-094, `blog_posts.meta_description`): the text a search engine shows under the title, and
 * what the site puts in `<meta name="description">`, `og:description` and the JSON-LD. Optional: empty is NULL and the page
 * uses the excerpt. `META_DESCRIPTION_MAX` is the hard limit, counted on the cleaned text. The writer is guided to
 * `META_DESCRIPTION_IDEAL` (about what a result shows before it cuts the text), which only the form uses.
 * The 85 migrated descriptions are between 85 and 562 characters, 28 of them over the limit: an article keeps the
 * description it has (the update accepts a text equal to the stored one, as it does for a short excerpt), and only a
 * text the writer changes must fit. `META_DESCRIPTION_RAW_MAX` stops a pathological input before it is cleaned.
 */
export const META_DESCRIPTION_MAX = 300;
export const META_DESCRIPTION_IDEAL = { min: 50, max: 160 } as const;
export const META_DESCRIPTION_RAW_MAX = 2_000;

/** What a plain-text field refuses: the start of anything the HTML tokenizer reads as a tag, a comment, a doctype or an instruction. A lone `<` or `>` (`IPK < 3`) is text. */
const MARKUP_START = /<[A-Za-z/!?]/;

/**
 * A meta description as it is stored: invisible characters removed (controls, zero-width and direction marks, the
 * byte-order mark, unpaired surrogates), every run of whitespace (tabs, line breaks, non-breaking spaces) one space,
 * trimmed. An empty result is `""`; the caller turns that into NULL. Pure, and copied to the SPA's `rules.ts` for the
 * live counter (a Worker test compares the two on a matrix), so the form counts what will be stored.
 */
export function cleanMetaDescription(raw: string): string {
  return raw
    .replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, (char) => (/^[\t\n\v\f\r\u0085]$/.test(char) ? " " : ""))
    .replace(/\s+/g, " ")
    .trim();
}

/** True when a cleaned text holds markup. Checked after cleaning, so an invisible character cannot hide a tag (`<​script>`). */
export function hasMarkup(cleaned: string): boolean {
  return MARKUP_START.test(cleaned);
}

/** The longest slug the database accepts (`blog_posts_slug_check`). The legacy generator cut at 80. */
export const SLUG_MAX = 160;
const GENERATED_SLUG_MAX = 80;

/** Lowercase letters and digits, single hyphens between them: exactly what `blog_posts_slug_check` allows. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * "Judul Artikel: Cerita Kita!" becomes "judul-artikel-cerita-kita". The legacy `slugify`
 * (lib/blog-writer.ts: lowercase, accents folded, dashes, at most 80), with one fix: the legacy cut came after
 * the trimming of hyphens, so a title cut at a hyphen ended with one, which the database refuses. Never empty:
 * the legacy fallback for a title with nothing usable in it is "post".
 */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, GENERATED_SLUG_MAX)
    .replace(/-+$/g, "");
  return slug || "post";
}

/**
 * `base`, or `base-2`, `base-3`... the first not in `taken` (the legacy `uniqueSlug`, which looked for files).
 * Throws after 1,000 tries like the legacy one.
 */
export function pickFreeSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; n <= 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error("could not generate a unique slug");
}

/** A calendar day as the form writes it, `YYYY-MM-DD`, that exists (`2026-02-31` does not). */
export function isIsoDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** The instant of 00:00 in Jakarta on an ISO day: how an article dated by the form is stored (an imported one the same way). */
export function startOfIsoDayJakarta(isoDay: string): Date {
  const [year, month, day] = isoDay.split("-").map(Number) as [number, number, number];
  return new Date(startOfDayJakarta(Date.UTC(year, month - 1, day) / 86_400_000));
}

/** Strip WordPress-style "[...]" / "..." trailers from an imported excerpt (legacy cleanExcerpt), for the list. */
export { cleanExcerpt } from "../public/blog-rules";
