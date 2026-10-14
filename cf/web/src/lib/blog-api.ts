// Blog data as the content API returns it (docs/cloudflare/content-api.md,
// GET /api/public/blog and /api/public/blog/{slug}) and the tolerant parsers the
// site runs on it. The wire names are the contract's: `slug`, not the legacy `id`.
//
// The input crosses a network, so parsing is defensive: an entry that is not
// usable is dropped, a payload that is not the right shape is `null` (the loader
// treats that like an API failure and falls back to the stale copy).

export interface BlogSummary {
  slug: string;
  title: string;
  category: string;
  /** Indonesian display date, "21 Mei 2026". */
  date: string;
  /** Sort key, `YYYY-MM-DD`. */
  dateISO: string;
  /** WordPress trailers already stripped by the API. */
  excerpt: string;
  /** Cover path as stored: root-relative (`/blog/images/...`) or an absolute https URL; null when none. */
  image: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  author: string;
  /** The stored flag. The featured CARD is `BlogListPayload.featured`, whichever article that is. */
  featured: boolean;
  /** Not in the contract's list entries (only in the article); used for the sitemap `lastmod` when an API sends it. */
  modifiedISO?: string;
}

export interface BlogArticle extends BlogSummary {
  modifiedISO: string;
  /**
   * The text for `<meta name="description">`, og:description and the JSON-LD description, when it is not the excerpt
   * (SAKEM-090); null when the API has none or does not send the field (an API from before it): use `excerpt`.
   */
  description: string | null;
  /**
   * HTML rendered by the API when the article was saved. It is injected UNESCAPED
   * (`set:html`), so it is trusted only because the API sanitizes at save (the
   * contract's rule: a producer other than the API must re-render or sanitize).
   * `contentMarkdown` is part of the wire payload but unused here, so it is dropped on parse.
   */
  contentHtml: string;
}

export interface BlogListPayload {
  featured: BlogSummary | null;
  articles: BlogSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface BlogArticlePayload {
  article: BlogArticle;
  related: BlogSummary[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const dim = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 100_000 ? v : null);
const count = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : fallback);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/**
 * An image path the site will put in `src` and `og:image`: root-relative (and not
 * protocol-relative) or absolute http(s). Anything else (`javascript:`, `data:`) is no image.
 */
export function safeImagePath(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  return /^\/(?!\/)/.test(s) || /^https?:\/\//i.test(s) ? s : null;
}

/** One list entry, or null when it lacks what a card needs (slug, title, a date). */
export function parseSummary(raw: unknown): BlogSummary | null {
  if (!isRecord(raw)) return null;
  const slug = str(raw.slug);
  const title = str(raw.title);
  const dateISO = str(raw.dateISO);
  if (!slug || !title || !dateISO || !ISO_DATE.test(dateISO)) return null;
  const image = safeImagePath(raw.image);
  const summary: BlogSummary = {
    slug,
    title,
    category: str(raw.category) ?? '',
    date: str(raw.date) ?? '',
    dateISO,
    excerpt: typeof raw.excerpt === 'string' ? raw.excerpt : '',
    image,
    imageWidth: image ? dim(raw.imageWidth) : null,
    imageHeight: image ? dim(raw.imageHeight) : null,
    author: str(raw.author) ?? 'Sakola Kembara',
    featured: raw.featured === true,
  };
  const modified = str(raw.modifiedISO);
  if (modified && ISO_DATE.test(modified)) summary.modifiedISO = modified;
  return summary;
}

const summaries = (raw: unknown): BlogSummary[] =>
  Array.isArray(raw) ? raw.flatMap((r) => parseSummary(r) ?? []) : [];

/** `GET /api/public/blog` body, or null when it is not a list payload. */
export function parseBlogList(payload: unknown): BlogListPayload | null {
  if (!isRecord(payload) || !Array.isArray(payload.articles)) return null;
  const featured = payload.featured === null || payload.featured === undefined ? null : parseSummary(payload.featured);
  const articles = summaries(payload.articles);
  return {
    featured,
    articles,
    page: Math.max(1, count(payload.page, 1)),
    pageSize: Math.max(1, count(payload.pageSize, articles.length || 1)),
    total: count(payload.total, articles.length),
    totalPages: Math.max(1, count(payload.totalPages, 1)),
  };
}

/** `GET /api/public/blog/{slug}` body, or null when it is not an article payload (or has no HTML to show). */
export function parseBlogArticle(payload: unknown): BlogArticlePayload | null {
  if (!isRecord(payload) || !isRecord(payload.article)) return null;
  const summary = parseSummary(payload.article);
  const html = payload.article.contentHtml;
  if (!summary || typeof html !== 'string' || html.trim() === '') return null;
  const modifiedISO = str(payload.article.modifiedISO);
  return {
    article: {
      ...summary,
      modifiedISO: modifiedISO && ISO_DATE.test(modifiedISO) ? modifiedISO : summary.dateISO,
      description: str(payload.article.description),
      contentHtml: html,
    },
    related: summaries(payload.related),
  };
}
