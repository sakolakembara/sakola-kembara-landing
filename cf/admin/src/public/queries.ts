// Every D1 read of the public API, in one place. Two rules, both for the
// Workers Free budget (10 ms CPU per request; D1 5M rows read per day):
//
//   1. Select an explicit column list, never the whole row. A column added to
//      a table later stays private until someone lists it here on purpose, and
//      the list endpoints never read the article bodies.
//   2. One or two statements per endpoint, no loop over rows that runs a query
//      per row. Statements that are known up front go into one `db.batch`
//      (one round trip). The plans are checked in test/public-plans.test.ts.
//
// The builders (`*Query`) return unexecuted Drizzle queries, so the plan test
// can run EXPLAIN QUERY PLAN on exactly what the endpoints run.

import { and, asc, count, desc, eq, gte, isNull, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Db } from "../db/audit";
import { announcements, blogPosts, reports, resourceCategory, siteResources, teamCategory, teamMembers, type BlogCategory } from "../db/schema";
import { relatedWindow, RELATED_LIMIT } from "./blog-rules";

/** `case col when 'a' then 0 when 'b' then 1 ... else n end`: an explicit rank instead of relying on text order. */
function rankBy(column: SQLiteColumn, order: readonly string[]): SQL {
  // The values are this app's own enum constants, never user input.
  const whens = order.map((value, index) => `when '${value}' then ${index}`).join(" ");
  return sql`case ${column} ${sql.raw(whens)} else ${sql.raw(String(order.length))} end`;
}

/** Last tiebreak: the table's row order, so equal rows always come back in the same order. */
const byRowidAsc = sql`rowid`;
const byRowidDesc = sql`rowid desc`;

// ------------------------------------------------------------------ team

/** Category rank (`teamCategory` is in display order), then the admin's manual order, then creation. */
export const teamQuery = (db: Db) =>
  db
    .select({
      id: teamMembers.id,
      name: teamMembers.name,
      role: teamMembers.role,
      image: teamMembers.image,
      category: teamMembers.category,
      bio: teamMembers.bio,
      educationHistory: teamMembers.educationHistory,
      workHistory: teamMembers.workHistory,
    })
    .from(teamMembers)
    .orderBy(rankBy(teamMembers.category, teamCategory), asc(teamMembers.displayOrder), asc(teamMembers.createdAt), byRowidAsc);

// --------------------------------------------------------------- reports

/** Newest `year` first (text order is chronological for YYYY and YYYY/YYYY), then newest upload first. */
export const reportsQuery = (db: Db) =>
  db
    .select({
      id: reports.id,
      title: reports.title,
      description: reports.description,
      category: reports.category,
      year: reports.year,
      filePath: reports.filePath,
      fileSize: reports.fileSize,
    })
    .from(reports)
    .orderBy(desc(reports.year), desc(reports.uploadedAt), byRowidDesc);

// ------------------------------------------------------------- resources

/** The page's category order (`resourceCategory` is in page order), then the admin's manual order. `notes` is never selected. */
export const resourcesQuery = (db: Db) =>
  db
    .select({
      id: siteResources.id,
      title: siteResources.title,
      description: siteResources.description,
      category: siteResources.category,
      contentType: siteResources.contentType,
      filePath: siteResources.filePath,
      fileSize: siteResources.fileSize,
      externalUrl: siteResources.externalUrl,
      bodyText: siteResources.bodyText,
    })
    .from(siteResources)
    .orderBy(rankBy(siteResources.category, resourceCategory), asc(siteResources.displayOrder), asc(siteResources.createdAt), byRowidAsc);

// ----------------------------------------------------------- announcement

/** Inside its window: either end may be open, both ends are inclusive (the legacy reader's rule). `now` is a parameter. */
export const announcementInWindow = (now: Date) => and(or(isNull(announcements.startsAt), lte(announcements.startsAt, now)), or(isNull(announcements.endsAt), gte(announcements.endsAt, now)));

/** Switched on and inside its window: the announcements that may be shown at `now`. */
export const announcementIsLive = (now: Date) => and(eq(announcements.active, true), announcementInWindow(now));

/** When several are live, the most recently created is the one shown; the row order breaks a tie between two saved in the same instant. */
export const announcementNewestFirst = [desc(announcements.createdAt), byRowidDesc] as const;

/**
 * The one active announcement: switched on and inside its window (either end
 * may be open), the most recently created wins. `now` is a parameter: the
 * window is evaluated at request time, never read from a cache. The admin's
 * Pengumuman list marks "Tampil sekarang" with the same predicate and order
 * (src/api/announcements.ts), so what it says is what this serves.
 */
export const currentAnnouncementQuery = (db: Db, now: Date) =>
  db
    .select({
      title: announcements.title,
      body: announcements.body,
      severity: announcements.severity,
      ctaLabel: announcements.ctaLabel,
      ctaUrl: announcements.ctaUrl,
    })
    .from(announcements)
    .where(announcementIsLive(now))
    .orderBy(...announcementNewestFirst)
    .limit(1);

// ------------------------------------------------------------------ blog

/** Only published articles are ever served. A draft has no public existence, not even a different error. */
const published = eq(blogPosts.status, "published");

/** Newest first; the row order breaks ties between articles saved with the same instant. */
const newestFirst = [desc(blogPosts.publishedAt), byRowidDesc] as const;

/** What a card shows (list entries, related articles). No body, no ids, no audit columns. */
const summaryColumns = {
  slug: blogPosts.slug,
  title: blogPosts.title,
  category: blogPosts.category,
  excerpt: blogPosts.excerpt,
  image: blogPosts.image,
  imageWidth: blogPosts.imageWidth,
  imageHeight: blogPosts.imageHeight,
  author: blogPosts.author,
  featured: blogPosts.featured,
  publishedAt: blogPosts.publishedAt,
} as const;

/** The index's featured article: the newest one flagged `featured`, otherwise the newest. */
const featuredOrder = [desc(blogPosts.featured), ...newestFirst] as const;

export const featuredPostQuery = (db: Db) =>
  db
    .select(summaryColumns)
    .from(blogPosts)
    .where(published)
    .orderBy(...featuredOrder)
    .limit(1);

export const publishedCountQuery = (db: Db) => db.select({ n: count() }).from(blogPosts).where(published);

/**
 * One page of the grid: every published article except the featured one,
 * newest first. The featured one is found by a subquery with the same order as
 * `featuredPostQuery`, so the page can be fetched in the same batch as the
 * featured article and the count.
 */
export const blogPageQuery = (db: Db, pageSize: number, offset: number) => {
  const featuredId = db
    .select({ id: blogPosts.id })
    .from(blogPosts)
    .where(published)
    .orderBy(...featuredOrder)
    .limit(1);
  return db
    .select(summaryColumns)
    .from(blogPosts)
    .where(and(published, ne(blogPosts.id, sql`(${featuredId})`)))
    .orderBy(...newestFirst)
    .limit(pageSize)
    .offset(offset);
};

/** One published article with both bodies and the dates the page needs. */
export const articleQuery = (db: Db, slug: string) =>
  db
    .select({ ...summaryColumns, id: blogPosts.id, updatedAt: blogPosts.updatedAt, metaDescription: blogPosts.metaDescription, contentMarkdown: blogPosts.contentMarkdown, contentHtml: blogPosts.contentHtml })
    .from(blogPosts)
    .where(and(published, eq(blogPosts.slug, slug)))
    .limit(1);

/**
 * "Artikel Lainnya": up to three others in the same category or dated within
 * 180 days (range on `published_at`, see `relatedWindow`), newest first.
 */
export const relatedQuery = (db: Db, article: { id: string; category: BlogCategory; publishedAtMs: number }) => {
  const { from, to } = relatedWindow(article.publishedAtMs);
  return db
    .select(summaryColumns)
    .from(blogPosts)
    .where(and(published, ne(blogPosts.id, article.id), or(eq(blogPosts.category, article.category), and(gte(blogPosts.publishedAt, new Date(from)), lt(blogPosts.publishedAt, new Date(to))))))
    .orderBy(...newestFirst)
    .limit(RELATED_LIMIT);
};

/** The fallback when nothing is related: the newest other articles. */
export const newestOthersQuery = (db: Db, id: string) =>
  db
    .select(summaryColumns)
    .from(blogPosts)
    .where(and(published, ne(blogPosts.id, id)))
    .orderBy(...newestFirst)
    .limit(RELATED_LIMIT);
