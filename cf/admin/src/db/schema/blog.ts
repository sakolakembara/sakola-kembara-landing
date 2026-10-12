import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAt, enumCheck, timestampMs, updatedAt, uuidPk } from "./_common";
import { users } from "./auth";

// New in D1. The legacy blog is 80 markdown files under content/blog with
// frontmatter (lib/blog-types.ts BlogArticle); in the new admin the blog is
// managed in the database. Shape follows the "Illustrative D1 mapping" of
// docs/cloudflare/content-api.md. Area: `konten` (Blog).

/** Fixed list of the legacy admin (lib/blog-types.ts BLOG_CATEGORIES). */
export const blogCategories = ["Career", "Cerita", "Education", "Kiat kiat", "News", "Testimonials", "Tips", "Uncategorized"] as const;
export type BlogCategory = (typeof blogCategories)[number];

export const blogStatus = ["draft", "published"] as const;
export type BlogStatus = (typeof blogStatus)[number];

/**
 * A blog article. The markdown is the source of truth; `contentHtml` is
 * rendered from it **when the article is saved** (never on a public read: Free
 * Workers have 10 ms of CPU per request) and stored next to it, so the two
 * must always be written together.
 *
 * Public wire fields derive like this (content-api.md): `slug`, `title`,
 * `category`, `author`, `featured`, `excerpt`, `image`, `imageWidth`,
 * `imageHeight`, `contentMarkdown`, `contentHtml` are columns; `dateISO` and
 * `date` come from `publishedAt` in the Asia/Jakarta zone; `modifiedISO` from
 * `updatedAt`. `status`, `wpId`, `sourceUrl` and the audit columns are never
 * exposed, and a draft is never served.
 */
export const blogPosts = sqliteTable(
  "blog_posts",
  {
    id: uuidPk(),
    /** The URL. Lowercase letters, digits, single inner hyphens. Immutable once published (enforced by the API, not the database). */
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    excerpt: text("excerpt").notNull(),
    contentMarkdown: text("content_markdown").notNull(),
    /** Rendered from contentMarkdown at save time, same pipeline as the Astro site's build-time renderer. */
    contentHtml: text("content_html").notNull(),
    /**
     * Hero image: root-relative public path ("/blog/images/2026/05/x.jpg").
     * For an upload through the admin the R2 key is the same string without the
     * leading slash. Width and height are recorded at upload because the public
     * site writes them on the <img> (parity with the build-time sizes).
     */
    image: text("image"),
    imageWidth: integer("image_width"),
    imageHeight: integer("image_height"),
    category: text("category", { enum: blogCategories }).notNull(),
    author: text("author").notNull(),
    featured: integer("featured", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: blogStatus }).notNull().default("draft"),
    /** The publication instant, set when the article goes live (null while a draft). Public dates are derived from it. */
    publishedAt: timestampMs("published_at"),
    /** WordPress post id for the 80 imported articles; null for articles written in the admin. */
    wpId: integer("wp_id"),
    /** Origin URL of an imported article. Internal. */
    sourceUrl: text("source_url"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("blog_posts_slug_idx").on(t.slug),
    // Several NULLs are allowed in a SQLite unique index, so articles written in the admin do not collide.
    uniqueIndex("blog_posts_wp_id_idx").on(t.wpId),
    // The public list: published only, newest first.
    index("blog_posts_status_published_idx").on(t.status, t.publishedAt),
    // The index's featured article: `ORDER BY featured DESC, published_at DESC LIMIT 1` over published rows is a seek, not a sort of every article (SAKEM-081, public API).
    index("blog_posts_status_featured_published_idx").on(t.status, t.featured, t.publishedAt),
    enumCheck("blog_posts_category_check", t.category, blogCategories),
    enumCheck("blog_posts_status_check", t.status, blogStatus),
    check(
      "blog_posts_slug_check",
      sql`length(${t.slug}) between 1 and 160 and ${t.slug} not glob '*[^a-z0-9-]*' and ${t.slug} not glob '-*' and ${t.slug} not glob '*-' and ${t.slug} not glob '*--*'`,
    ),
    // A published article has a date; a draft may not have one yet.
    check("blog_posts_published_at_check", sql`${t.status} <> 'published' or ${t.publishedAt} is not null`),
    // Both dimensions or neither, and real ones.
    check(
      "blog_posts_image_size_check",
      sql`((${t.imageWidth} is null) = (${t.imageHeight} is null)) and (${t.imageWidth} is null or (${t.imageWidth} > 0 and ${t.imageHeight} > 0))`,
    ),
  ],
);
