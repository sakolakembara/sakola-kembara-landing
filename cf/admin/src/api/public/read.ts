import { drizzle } from "drizzle-orm/d1";
import { Hono, type Context } from "hono";
import * as schema from "../../db/schema";
import type { Bindings } from "../../env";
import { pageWindow, parseIntParam, resolvePageSize } from "../../public/blog-rules";
import { articleTag, CACHE_ANNOUNCEMENT, CACHE_CONTENT, CACHE_NONE, CACHE_NOT_FOUND, TAGS } from "../../public/cache";
import {
  articleQuery,
  blogPageQuery,
  currentAnnouncementQuery,
  featuredPostQuery,
  newestOthersQuery,
  publishedCountQuery,
  relatedQuery,
  reportsQuery,
  resourcesQuery,
  teamQuery,
} from "../../public/queries";
import {
  serializeAnnouncement,
  serializeBlogArticle,
  serializeBlogSummary,
  serializeReport,
  serializeResource,
  serializeTeamMember,
} from "../../public/serializers";
import type { AnnouncementResponse, BlogArticleResponse, BlogListResponse, ReportsResponse, ResourcesResponse, TeamResponse } from "../../public/types";

// The unauthenticated, read-only half of the public API (contract:
// docs/cloudflare/content-api.md). Mounted under /api/public on the internal
// app only, which the `PublicApi` entrypoint serves to the Astro Worker's
// service binding; the Worker's public face (the default export) mounts none
// of it (./index.ts). No cookies, no CORS, no request header changes an answer.

type ReadEnv = { Bindings: Bindings };
type ReadContext = Context<ReadEnv>;

/** A slug is lowercase letters, digits and single inner hyphens (blog_posts_slug_check). Anything else cannot exist, so it is a 404 without a D1 read. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MAX_LENGTH = 160;

/** `page` is clamped, but the first batch needs an offset before the total is known: guess within this bound and refetch only when the guess was wrong. */
const MAX_GUESSED_PAGE = 10_000;

function ok(c: ReadContext, body: object, cache: string, tag: string) {
  return c.json(body, 200, { "Cache-Control": cache, "Cache-Tag": tag });
}

function notFound(c: ReadContext) {
  return c.json({ error: "not_found" }, 404, { "Cache-Control": CACHE_NOT_FOUND });
}

export const publicReadRoutes = new Hono<ReadEnv>();

// An unhandled failure (a D1 error) is a plain 500 that must not carry
// s-maxage, so nothing is told to cache a failure. Message only in the log:
// the stack and the request can carry personal data elsewhere in this app.
publicReadRoutes.onError((error, c) => {
  console.error(`[public-api] unhandled error: ${error.message}`);
  return c.json({ error: "internal" }, 500, { "Cache-Control": CACHE_NONE });
});

publicReadRoutes.get("/team", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const rows = await teamQuery(db);
  const body: TeamResponse = { members: rows.map(serializeTeamMember) };
  return ok(c, body, CACHE_CONTENT, TAGS.team);
});

publicReadRoutes.get("/reports", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const rows = await reportsQuery(db);
  const body: ReportsResponse = { reports: rows.map(serializeReport) };
  return ok(c, body, CACHE_CONTENT, TAGS.reports);
});

publicReadRoutes.get("/resources", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const rows = await resourcesQuery(db);
  const body: ResourcesResponse = { resources: rows.map(serializeResource) };
  return ok(c, body, CACHE_CONTENT, TAGS.resources);
});

// The window (starts_at / ends_at) is evaluated against the clock on every
// request that reaches the Worker, so the edge cache (30 s) is the only
// staleness. A D1 failure is a 500, never `{ announcement: null }`: a cache
// must not store a false "nothing is announced".
publicReadRoutes.get("/announcements/current", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const [row] = await currentAnnouncementQuery(db, new Date());
  const body: AnnouncementResponse = { announcement: row ? serializeAnnouncement(row) : null };
  return ok(c, body, CACHE_ANNOUNCEMENT, TAGS.announcement);
});

publicReadRoutes.get("/blog", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const pageSize = resolvePageSize(c.req.query("pageSize"));
  const requested = parseIntParam(c.req.query("page"));

  // One round trip in the usual case: the featured article, the count and the
  // page asked for, in one batch. The page is clamped once the count is known;
  // only an out-of-range page costs a second query.
  const guessedPage = Math.min(Math.max(1, requested ?? 1), MAX_GUESSED_PAGE);
  const [featuredRows, countRows, guessedRows] = await db.batch([
    featuredPostQuery(db),
    publishedCountQuery(db),
    blogPageQuery(db, pageSize, (guessedPage - 1) * pageSize),
  ]);

  const featured = featuredRows[0] ?? null;
  // The grid is every published article but the featured one.
  const total = Math.max(0, (countRows[0]?.n ?? 0) - 1);
  const span = pageWindow(total, pageSize, requested);
  const rows = span.page === guessedPage ? guessedRows : await blogPageQuery(db, pageSize, span.offset);

  const body: BlogListResponse = {
    featured: featured ? serializeBlogSummary(featured) : null,
    articles: rows.map(serializeBlogSummary),
    page: span.page,
    pageSize,
    total,
    totalPages: span.totalPages,
  };
  return ok(c, body, CACHE_CONTENT, TAGS.blog);
});

publicReadRoutes.get("/blog/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (slug.length > SLUG_MAX_LENGTH || !SLUG_PATTERN.test(slug)) return notFound(c);

  const db = drizzle(c.env.DB, { schema });
  const [row] = await articleQuery(db, slug);
  // Unknown and unpublished are the same answer.
  if (!row) return notFound(c);

  const target = { id: row.id, category: row.category, publishedAtMs: row.publishedAt?.getTime() ?? 0 };
  let related = await relatedQuery(db, target);
  // Nothing in the same category or time window: the newest others (second query only in that case).
  if (related.length === 0) related = await newestOthersQuery(db, row.id);

  const body: BlogArticleResponse = { article: serializeBlogArticle(row), related: related.map(serializeBlogSummary) };
  // Tagged with the list's tag too: an edit can change the card, not only the article.
  return c.json(body, 200, { "Cache-Control": CACHE_CONTENT, "Cache-Tag": `${articleTag(slug)},${TAGS.blog}` });
});
