import { and, count, eq, gte, inArray, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { requireArea } from "../auth/guard";
import type { AppEnv, AuthUser } from "../context";
import type { Db } from "../db/audit";
import * as schema from "../db/schema";
import { blogCategories, blogStatus, type BlogStatus } from "../db/schema";
import { imageLookup, legacyEntry } from "../blog/images";
import { renderArticle, uploadPathsIn } from "../blog/render";
import { isSafeImageSrc } from "../blog/sanitize";
import {
  AUTHOR_MAX,
  AUTHOR_MIN,
  BODY_MAX,
  BODY_MIN,
  cleanExcerpt,
  EXCERPT_MAX,
  EXCERPT_MIN,
  IMAGE_PATH_MAX,
  isIsoDay,
  pickFreeSlug,
  SLUG_MAX,
  SLUG_PATTERN,
  slugify,
  startOfIsoDayJakarta,
  TITLE_MAX,
  TITLE_MIN,
} from "../blog/rules";
import { isoDayJakarta } from "../public/dates";
import { notifyContentChanged, type ContentChange } from "../public/purge";
import { keyForPath } from "../uploads/key";
import { deleteUploadByPath } from "../uploads/store";
import {
  changedFields,
  conflict,
  crudHandlers,
  enumFilter,
  etagOf,
  isAllowedFilePath,
  isUniqueViolation,
  matches,
  nextVersion,
  notFound,
  pageOf,
  parseBody,
  parseListQuery,
  preconditionRequired,
  readIfMatch,
  stale,
  validationError,
  withAudit,
  type CrudDeps,
} from "./crud";

// Blog (area `konten`): /api/admin/blog, SAKEM-082. The legacy admin wrote markdown files to the container disk
// (app/(admin)/admin/blog/actions.ts, lib/blog-writer.ts); here an article is a row of `blog_posts`, and the
// markdown is rendered to sanitised HTML when it is SAVED (src/blog/render.ts), never when it is read. How it is
// built, the rules and what differs from the legacy: docs/cloudflare/admin-blog.md.
//
//   GET    /                list     ?page &pageSize &q (title or excerpt) &status &category &sort
//   POST   /                create   a draft; the slug is made from the title unless one is given
//   GET    /:id             one      the form's values (never `contentHtml`)
//   PUT    /:id             replace  needs If-Match; renders; a slug can change only while a draft
//   DELETE /:id             delete   the crud kit's: audit row, purge, replaced uploads
//   POST   /:id/publish     status = published; published_at is set when it has none
//   POST   /:id/unpublish   status = draft (the date stays)
//   POST   /preview         { contentMarkdown } -> { html }: the same render, nothing saved
//
// Create, update and the two verbs are written by hand from the functions the crud kit is made of
// (parseBody, withAudit, changedFields, nextVersion, the error helpers), because they do work the generic
// routes do not: a render, a slug, media lookups, a status. The list is hand-written because the kit's would read
// the two long columns of every row; get and delete are the kit's.

type Row = typeof schema.blogPosts.$inferSelect;

/** The JSON body of a save: the markdown can be 12,000 characters of multi-byte text, the rest is small. */
const MAX_BODY_BYTES = 128 * 1024;

const bodyLimitLabel = BODY_MAX.toLocaleString("en-US").replace(",", ".");

const blogInput = z.object({
  title: z.string().trim().min(TITLE_MIN, "Judul minimal 3 karakter").max(TITLE_MAX, "Judul maksimal 200 karakter"),
  // Optional: a new article gets one from its title, like the legacy admin did. Lower case is done for the writer.
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(SLUG_MAX, "Slug maksimal 160 karakter")
    .nullish()
    .transform((value) => value || null)
    .refine((value) => value === null || SLUG_PATTERN.test(value), { message: "Slug hanya boleh huruf kecil, angka, dan tanda hubung" }),
  category: z.enum(blogCategories, { error: "Kategori tidak dikenal" }),
  excerpt: z.string().trim().min(EXCERPT_MIN, "Excerpt minimal 20 karakter").max(EXCERPT_MAX, "Maksimal 500 karakter"),
  contentMarkdown: z.string().trim().min(BODY_MIN, "Isi minimal 50 karakter").max(BODY_MAX, `Isi maksimal ${bodyLimitLabel} karakter`),
  author: z.string().trim().min(AUTHOR_MIN, "Wajib diisi").max(AUTHOR_MAX, "Maksimal 120 karakter"),
  // An upload of kind `blog-image` or a file of the legacy blog (`/blog/images/...`); the size is read from `media`, never from the client.
  image: z
    .string()
    .trim()
    .max(IMAGE_PATH_MAX, "Berkas tidak valid. Unggah ulang berkasnya.")
    .nullish()
    .transform((value) => value || null)
    // An upload of kind blog-image, or a file of the legacy blog's folder. (The kit's check takes every legacy static
    // folder, `/files`, `/reports`..., and no `@`; five of the blog's files have an `@` in their names, which the
    // sanitiser's rule for that folder allows.)
    .refine((value) => value === null || (keyForPath(value) !== null ? isAllowedFilePath(value, ["blog-image"]) : isSafeImageSrc(value) && value.startsWith("/blog/images/")), { message: "Berkas tidak valid. Unggah ulang berkasnya." }),
  featured: z.boolean().default(false),
  // The publication day. Empty on a draft means "the day it is published".
  date: z
    .string()
    .trim()
    .nullish()
    .transform((value) => value || null)
    .refine((value) => value === null || isIsoDay(value), { message: "Format harus YYYY-MM-DD" }),
});

type BlogInput = z.output<typeof blogInput>;

const previewInput = z.object({
  contentMarkdown: z.string().max(BODY_MAX, `Isi maksimal ${bodyLimitLabel} karakter`),
});

const DATE_REQUIRED = "Format harus YYYY-MM-DD";
const SLUG_LOCKED = "Slug tidak bisa diubah setelah artikel terbit";
const IMAGE_INVALID = "Berkas tidak valid. Unggah ulang berkasnya.";

const dayOf = (row: Pick<Row, "publishedAt">) => (row.publishedAt ? isoDayJakarta(row.publishedAt.getTime()) : null);

/** The form's values and a little more, for the edit screen. No `contentHtml`, `wpId`, `sourceUrl` or user ids. */
function present(row: Row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    contentMarkdown: row.contentMarkdown,
    category: row.category,
    author: row.author,
    featured: row.featured,
    status: row.status,
    date: dayOf(row),
    image: row.image,
    imageWidth: row.imageWidth,
    imageHeight: row.imageHeight,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const listColumns = {
  id: schema.blogPosts.id,
  slug: schema.blogPosts.slug,
  title: schema.blogPosts.title,
  excerpt: schema.blogPosts.excerpt,
  category: schema.blogPosts.category,
  author: schema.blogPosts.author,
  featured: schema.blogPosts.featured,
  status: schema.blogPosts.status,
  publishedAt: schema.blogPosts.publishedAt,
  createdAt: schema.blogPosts.createdAt,
  updatedAt: schema.blogPosts.updatedAt,
} as const;

type ListRow = { [K in keyof typeof listColumns]: Row[K] };

/** A row of the list: what a table needs, with the WordPress `[...]` trailer of an imported excerpt already cleaned (as the legacy list did). */
function presentListItem(row: ListRow) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: cleanExcerpt(row.excerpt),
    category: row.category,
    author: row.author,
    featured: row.featured,
    status: row.status,
    date: dayOf(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const listSpec = {
  // The legacy list searched the title and the excerpt (contains). About 80 articles: a scan is fine (docs, "D1 budget").
  search: [schema.blogPosts.title, schema.blogPosts.excerpt],
  filters: {
    status: enumFilter(schema.blogPosts.status, blogStatus),
    category: enumFilter(schema.blogPosts.category, blogCategories),
  },
  sorts: {
    updatedAt: schema.blogPosts.updatedAt,
    publishedAt: schema.blogPosts.publishedAt,
    createdAt: schema.blogPosts.createdAt,
    title: schema.blogPosts.title,
  },
  defaultSort: "-updatedAt",
  id: schema.blogPosts.id,
} as const;

/** The upload paths an article holds: its hero and every `/uploads/` image or link in the markdown. */
export function uploadsOf(row: Pick<Row, "image" | "contentMarkdown">): string[] {
  return [...new Set([...(row.image ? [row.image] : []), ...uploadPathsIn(row.contentMarkdown)])];
}

/** Public changes: a row that is, or just was, on the site. A draft touched while still a draft changes nothing visible. */
function publicChanges(...rows: (Row | null)[]): ContentChange[] {
  const slugs = new Set<string>();
  for (const row of rows) if (row && row.status === "published") slugs.add(row.slug);
  return [...slugs].map((slug) => ({ area: "blog", slug }));
}

function waitUntilOf(c: Context): (promise: Promise<unknown>) => void {
  try {
    const ctx = c.executionCtx;
    return (promise) => ctx.waitUntil(promise);
  } catch {
    return (promise) => void promise.catch(() => undefined);
  }
}

const normaliseNewlines = (text: string) => text.replace(/\r\n?/g, "\n");

interface MediaSize {
  width: number;
  height: number;
}

/** The recorded size of the uploads among `paths`: one statement, and none when there is nothing to look up. */
async function uploadSizes(db: Db, paths: readonly string[]): Promise<Map<string, MediaSize>> {
  const byKey = new Map<string, string>();
  for (const path of paths) {
    const key = keyForPath(path);
    if (key) byKey.set(key, path);
  }
  const sizes = new Map<string, MediaSize>();
  if (byKey.size === 0) return sizes;
  const rows = await db
    .select({ key: schema.media.key, width: schema.media.width, height: schema.media.height })
    .from(schema.media)
    .where(inArray(schema.media.key, [...byKey.keys()]));
  for (const row of rows) {
    const path = byKey.get(row.key);
    if (path && row.width !== null && row.height !== null) sizes.set(path, { width: row.width, height: row.height });
  }
  return sizes;
}

type Prepared =
  | { ok: true; markdown: string; html: string; image: string | null; imageWidth: number | null; imageHeight: number | null }
  | { ok: false; fields: Record<string, string> };

/**
 * What the markdown and the hero image of a save become: the sanitised HTML, and the size of the hero.
 *
 *  - The hero's size comes from `media` (recorded at upload) or, for a file of the legacy blog, from the asset
 *    manifest's table: never from the client. An upload that has no `media` row is refused.
 *  - Inline images get their recorded size too, so the public page can reserve their space.
 *  - An update whose markdown did not change keeps the stored HTML: a change of title, category or
 *    "featured" costs no render (CPU), and a stored article is never re-rendered by anything but a save of its text.
 */
async function prepare(db: Db, form: BlogInput, before: Row | null): Promise<Prepared> {
  const markdown = normaliseNewlines(form.contentMarkdown);
  const paths = [...(form.image ? [form.image] : []), ...uploadPathsIn(markdown)];
  const sizes = await uploadSizes(db, paths);

  let imageWidth: number | null = null;
  let imageHeight: number | null = null;
  if (form.image) {
    if (before && before.image === form.image) {
      imageWidth = before.imageWidth;
      imageHeight = before.imageHeight;
    } else if (keyForPath(form.image)) {
      const size = sizes.get(form.image);
      if (!size) return { ok: false, fields: { image: IMAGE_INVALID } };
      imageWidth = size.width;
      imageHeight = size.height;
    } else {
      // A file of the legacy blog: the table of the asset pipeline knows its size.
      const entry = legacyEntry(form.image);
      imageWidth = entry ? entry[0] : null;
      imageHeight = entry ? entry[1] : null;
    }
  }

  const html = before && before.contentMarkdown === markdown ? before.contentHtml : renderArticle(markdown, { images: imageLookup(sizes) }).html;
  return { ok: true, markdown, html, image: form.image, imageWidth, imageHeight };
}

/** How the publication instant follows the form's day: the same day keeps the instant, another day is 00:00 in Jakarta. */
function publishedAtFor(date: string | null, before: Row | null): Date | null {
  if (date === null) return null;
  if (before?.publishedAt && dayOf(before) === date) return before.publishedAt;
  return startOfIsoDayJakarta(date);
}

export function createBlogRoutes(deps: CrudDeps = { notify: notifyContentChanged, deleteUpload: deleteUploadByPath }) {
  // The kit's `get` and `remove`: the audit row, the purge of the page, the cleanup of replaced uploads.
  const kit = crudHandlers(
    {
      area: "konten",
      table: schema.blogPosts,
      version: schema.blogPosts.updatedAt,
      audit: { name: "blog", type: "blog", label: (row) => row.title },
      schema: blogInput,
      toRow: () => {
        throw new Error("blog: create and update are written by hand (src/api/blog.ts)");
      },
      present,
      list: { ...listSpec },
      purge: (row) => publicChanges(row),
      uploads: uploadsOf,
    },
    deps,
  );

  function afterCommit(c: Context<AppEnv>, user: AuthUser, before: Row | null, after: Row | null) {
    const waitUntil = waitUntilOf(c);
    for (const change of publicChanges(before, after)) deps.notify(change, waitUntil);
    if (before) {
      const kept = new Set(after ? uploadsOf(after) : []);
      const removed = uploadsOf(before).filter((path) => !kept.has(path));
      if (removed.length > 0) {
        waitUntil(
          Promise.all(removed.map((path) => deps.deleteUpload(c.env, user, path))).catch(() => {
            // Message only: a path can hold a file name.
            console.error("[blog] upload cleanup failed");
          }),
        );
      }
    }
  }

  const withEtag = (c: Context, row: Row) => c.header("ETag", etagOf(row.updatedAt));

  async function findRow(c: Context<AppEnv>, id: string): Promise<Row | null> {
    if (id.length === 0 || id.length > 128) return null;
    const db = drizzle(c.env.DB, { schema });
    const rows = await db.select().from(schema.blogPosts).where(eq(schema.blogPosts.id, id)).limit(1);
    return rows[0] ?? null;
  }

  /** `base`, or `base-2`, `base-3`...: the legacy `uniqueSlug`, over D1 instead of files (one range read of the unique index). */
  async function freeSlug(db: Db, base: string): Promise<string> {
    const rows = await db
      .select({ slug: schema.blogPosts.slug })
      .from(schema.blogPosts)
      // "~" sorts after every letter, digit and hyphen: the range holds every slug that starts with `base`.
      .where(and(gte(schema.blogPosts.slug, base), lt(schema.blogPosts.slug, `${base}~`)));
    return pickFreeSlug(base, new Set(rows.map((row) => row.slug)));
  }

  const app = new Hono<AppEnv>();

  app.get("/", requireArea("konten", "read"), async (c) => {
    const parsed = parseListQuery(c, listSpec);
    if (!parsed.ok) return parsed.response;
    const { query } = parsed;
    const db = drizzle(c.env.DB, { schema });
    // One round trip: the page and the total over the same WHERE. Only short columns: never the markdown or the HTML.
    const [rows, totals] = await db.batch([
      db.select(listColumns).from(schema.blogPosts).where(query.where).orderBy(...query.order).limit(query.pageSize).offset(query.offset),
      db.select({ total: count() }).from(schema.blogPosts).where(query.where),
    ]);
    return c.json(pageOf(rows.map(presentListItem), query, totals[0]?.total ?? 0));
  });

  // Before "/:id" verbs, and a POST: nothing is saved. The same render a save does, with the same sizes.
  app.post("/preview", requireArea("konten", "write"), async (c) => {
    const body = await parseBody(c, previewInput, { maxBytes: MAX_BODY_BYTES });
    if (!body.ok) return body.response;
    const markdown = normaliseNewlines(body.data.contentMarkdown).trim();
    if (markdown === "") return c.json({ html: "" });
    const db = drizzle(c.env.DB, { schema });
    const sizes = await uploadSizes(db, uploadPathsIn(markdown));
    return c.json({ html: renderArticle(markdown, { images: imageLookup(sizes) }).html });
  });

  app.post("/", requireArea("konten", "write"), async (c) => {
    const body = await parseBody(c, blogInput, { maxBytes: MAX_BODY_BYTES });
    if (!body.ok) return body.response;
    const form = body.data;
    const user = c.get("user");
    const db = drizzle(c.env.DB, { schema });

    const prepared = await prepare(db, form, null);
    if (!prepared.ok) return validationError(c, prepared.fields);
    const slug = form.slug ?? (await freeSlug(db, slugify(form.title)));

    const values = {
      id: crypto.randomUUID(),
      slug,
      title: form.title,
      excerpt: form.excerpt,
      contentMarkdown: prepared.markdown,
      contentHtml: prepared.html,
      image: prepared.image,
      imageWidth: prepared.imageWidth,
      imageHeight: prepared.imageHeight,
      category: form.category,
      author: form.author,
      featured: form.featured,
      // Always a draft: publishing is its own step (the legacy admin had no such state).
      status: "draft" as BlogStatus,
      publishedAt: publishedAtFor(form.date, null),
      createdBy: user.id,
      updatedBy: user.id,
    };

    let created: Row | undefined;
    try {
      const [rows] = await withAudit(
        db,
        user,
        { action: "blog.create", resourceType: "blog", resourceId: values.id, fields: Object.keys(values).filter((key) => key !== "id" && key !== "createdBy" && key !== "updatedBy"), label: values.title },
        [db.insert(schema.blogPosts).values(values).returning()],
      );
      created = (rows as Row[])[0];
    } catch (error) {
      if (isUniqueViolation(error, "blog_posts.slug")) return conflict(c, { slug: "Slug sudah dipakai" });
      throw error;
    }
    if (!created) throw new Error("blog: insert returned no row");
    afterCommit(c, user, null, created);
    withEtag(c, created);
    return c.json({ item: present(created) }, 201);
  });

  app.get("/:id", requireArea("konten", "read"), kit.get);

  app.put("/:id", requireArea("konten", "write"), async (c) => {
    const id = c.req.param("id") ?? "";
    const precondition = readIfMatch(c);
    if (!precondition.present) return preconditionRequired(c);
    const body = await parseBody(c, blogInput, { maxBytes: MAX_BODY_BYTES });
    if (!body.ok) return body.response;
    const form = body.data;

    const before = await findRow(c, id);
    if (!before) return notFound(c);
    if (!matches(precondition, before.updatedAt)) return stale(c);

    // Rules that need the stored row (a form alone cannot know them).
    const problems: Record<string, string> = {};
    if (form.slug !== null && form.slug !== before.slug && before.status === "published") problems.slug = SLUG_LOCKED;
    if (before.status === "published" && form.date === null) problems.date = DATE_REQUIRED;
    if (Object.keys(problems).length > 0) return validationError(c, problems);

    const user = c.get("user");
    const db = drizzle(c.env.DB, { schema });
    const prepared = await prepare(db, form, before);
    if (!prepared.ok) return validationError(c, prepared.fields);

    const values = {
      slug: form.slug ?? before.slug,
      title: form.title,
      excerpt: form.excerpt,
      contentMarkdown: prepared.markdown,
      contentHtml: prepared.html,
      image: prepared.image,
      imageWidth: prepared.imageWidth,
      imageHeight: prepared.imageHeight,
      category: form.category,
      author: form.author,
      featured: form.featured,
      publishedAt: publishedAtFor(form.date, before),
    };
    const fields = changedFields(before, values);
    if (fields.length === 0) {
      // Nothing to save: no write, no audit row, the version stays.
      withEtag(c, before);
      return c.json({ item: present(before) });
    }

    let updated: Row | undefined;
    try {
      // The version is in the WHERE too: two saves that read the same version cannot both win.
      const [rows] = await withAudit(db, user, { action: "blog.update", resourceType: "blog", resourceId: id, fields, label: values.title }, [
        db
          .update(schema.blogPosts)
          .set({ ...values, updatedBy: user.id, updatedAt: nextVersion(before.updatedAt) })
          .where(and(eq(schema.blogPosts.id, id), eq(schema.blogPosts.updatedAt, before.updatedAt)))
          .returning(),
      ]);
      updated = (rows as Row[])[0];
    } catch (error) {
      if (isUniqueViolation(error, "blog_posts.slug")) return conflict(c, { slug: "Slug sudah dipakai" });
      throw error;
    }
    if (!updated) return stale(c); // lost the race: nothing was written, no audit row either
    afterCommit(c, user, before, updated);
    withEtag(c, updated);
    return c.json({ item: present(updated) });
  });

  /** The two verbs: a change of status that is not an edit, guarded by the version like a save. */
  const setStatus = (to: BlogStatus) => async (c: Context<AppEnv>) => {
    const id = c.req.param("id") ?? "";
    const precondition = readIfMatch(c);
    if (!precondition.present) return preconditionRequired(c);
    const before = await findRow(c, id);
    if (!before) return notFound(c);
    if (!matches(precondition, before.updatedAt)) return stale(c);
    if (before.status === to) {
      // Already there: nothing to write and nothing to audit.
      withEtag(c, before);
      return c.json({ item: present(before) });
    }

    const user = c.get("user");
    const db = drizzle(c.env.DB, { schema });
    // Publishing dates the article now unless the writer already gave it a day; unpublishing keeps the day.
    const publishedAt = to === "published" ? (before.publishedAt ?? new Date()) : before.publishedAt;
    let updated: Row | undefined;
    const [rows] = await withAudit(
      db,
      user,
      { action: to === "published" ? "blog.publish" : "blog.unpublish", resourceType: "blog", resourceId: id, fields: to === "published" && !before.publishedAt ? ["status", "publishedAt"] : ["status"], label: before.title },
      [
        db
          .update(schema.blogPosts)
          .set({ status: to, publishedAt, updatedBy: user.id, updatedAt: nextVersion(before.updatedAt) })
          .where(and(eq(schema.blogPosts.id, id), eq(schema.blogPosts.updatedAt, before.updatedAt)))
          .returning(),
      ],
    );
    updated = (rows as Row[])[0];
    if (!updated) return stale(c);
    afterCommit(c, user, before, updated);
    withEtag(c, updated);
    return c.json({ item: present(updated) });
  };

  app.post("/:id/publish", requireArea("konten", "write"), setStatus("published"));
  app.post("/:id/unpublish", requireArea("konten", "write"), setStatus("draft"));

  app.delete("/:id", requireArea("konten", "write"), kit.remove);

  return app;
}

export const blogRoutes = createBlogRoutes();
