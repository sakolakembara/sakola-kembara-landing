import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAt, enumCheck, jsonCheck, timestampMs, updatedAt, uuidPk } from "./_common";
import { users } from "./auth";

// Site content managed from the admin and shown on the public site: reports,
// the team page, the document hub and shortlinks. Area: `konten` (Laporan,
// Tim, Shortlink) and `pendaftaran` (Pusat Dokumen). The blog is in blog.ts.
//
// File columns hold a root-relative public path ("/reports/2025-2026/x.pdf").
// For a file uploaded through the admin, the R2 object key is that path
// without its leading slash; see media.ts and docs/cloudflare/d1-schema.md.

// ---------------------------------------------------------------- reports

export const reportCategory = ["yearly", "financial", "impact", "donation"] as const;
export type ReportCategory = (typeof reportCategory)[number];

/** Mirror of lib/db/schema/reports.ts. */
export const reports = sqliteTable(
  "reports",
  {
    id: uuidPk(),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category", { enum: reportCategory }).notNull(),
    /** "2025" or "2025/2026". Sorted as text, newest first, which is why it is always 4-digit padded. */
    year: text("year").notNull(),
    /** Public path of the PDF, e.g. /reports/2025-2026/impact/laporan-dampak.pdf */
    filePath: text("file_path").notNull(),
    fileSize: integer("file_size").notNull(), // bytes
    uploadedBy: text("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    uploadedAt: createdAt("uploaded_at"),
  },
  (t) => [
    index("reports_category_year_idx").on(t.category, t.year),
    enumCheck("reports_category_check", t.category, reportCategory),
    check("reports_file_size_check", sql`${t.fileSize} >= 0`),
    // The two shapes the admin accepts. Anything else breaks the text sort order.
    check(
      "reports_year_check",
      sql`${t.year} glob '[0-9][0-9][0-9][0-9]' or ${t.year} glob '[0-9][0-9][0-9][0-9]/[0-9][0-9][0-9][0-9]'`,
    ),
  ],
);

// ------------------------------------------------------------ team members

export const teamCategory = ["dewan_pembina", "dewan_pengawas", "pengurus"] as const;
export type TeamCategory = (typeof teamCategory)[number];

export type EducationEntry = {
  institution: string;
  degree?: string | null;
  year?: string | null;
};

export type WorkEntry = {
  organization: string;
  role: string;
  period?: string | null;
};

/** Mirror of lib/db/schema/team-members.ts. */
export const teamMembers = sqliteTable(
  "team_members",
  {
    id: uuidPk(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    /** Public path of the photo (/images/team/<slug>-<rand>.jpg). Optional. */
    image: text("image"),
    /** Which section of /tim the member appears under. */
    category: text("category", { enum: teamCategory }).notNull().default("pengurus"),
    /** Long-form bio shown in the profile drawer. */
    bio: text("bio"),
    educationHistory: text("education_history", { mode: "json" }).$type<EducationEntry[]>().notNull().default([]),
    workHistory: text("work_history", { mode: "json" }).$type<WorkEntry[]>().notNull().default([]),
    /** Manual sort key: lower first within the same category. 0 to 9999. */
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("team_members_display_order_idx").on(t.displayOrder),
    index("team_members_category_idx").on(t.category),
    enumCheck("team_members_category_check", t.category, teamCategory),
    check("team_members_display_order_check", sql`${t.displayOrder} between 0 and 9999`),
    jsonCheck("team_members_education_json_check", t.educationHistory),
    jsonCheck("team_members_work_json_check", t.workHistory),
    check("team_members_history_array_check", sql`json_type(${t.educationHistory}) = 'array' and json_type(${t.workHistory}) = 'array'`),
  ],
);

// --------------------------------------------------------- site resources

export const resourceCategory = ["panduan", "berkas-pendaftaran", "berkas-marketing", "tutorial", "lainnya"] as const;
export type ResourceCategory = (typeof resourceCategory)[number];

export const resourceContentType = ["file", "url", "text"] as const;
export type ResourceContentType = (typeof resourceContentType)[number];

/**
 * Catalog behind `/gabung-siswa/docs` (menu "Pusat Dokumen"; the table keeps
 * its legacy name). Each row is exactly one of three shapes, chosen by
 * `contentType`, and a CHECK enforces it:
 *   file  filePath and fileSize set
 *   url   externalUrl set
 *   text  bodyText set (short snippets meant to be copied)
 * Mirror of lib/db/schema/site-resources.ts.
 */
export const siteResources = sqliteTable(
  "site_resources",
  {
    id: uuidPk(),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category", { enum: resourceCategory }).notNull().default("lainnya"),
    displayOrder: integer("display_order").notNull().default(0),
    contentType: text("content_type", { enum: resourceContentType }).notNull(),
    /** For "file": public path, /resources/<file>. */
    filePath: text("file_path"),
    fileSize: integer("file_size"),
    /** For "url": link to Drive, Canva, YouTube and so on. */
    externalUrl: text("external_url"),
    /** For "text": the copy-able content. */
    bodyText: text("body_text"),
    /** Admin-only note. Never exposed by the public API. */
    notes: text("notes"),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("site_resources_category_order_idx").on(t.category, t.displayOrder),
    enumCheck("site_resources_category_check", t.category, resourceCategory),
    enumCheck("site_resources_content_type_check", t.contentType, resourceContentType),
    check("site_resources_file_size_check", sql`${t.fileSize} is null or ${t.fileSize} >= 0`),
    // Exactly one shape per row, as the public API contract requires.
    check(
      "site_resources_shape_check",
      sql`(${t.contentType} = 'file' and ${t.filePath} is not null and ${t.fileSize} is not null and ${t.externalUrl} is null and ${t.bodyText} is null)
        or (${t.contentType} = 'url' and ${t.externalUrl} is not null and ${t.filePath} is null and ${t.fileSize} is null and ${t.bodyText} is null)
        or (${t.contentType} = 'text' and ${t.bodyText} is not null and ${t.filePath} is null and ${t.fileSize} is null and ${t.externalUrl} is null)`,
    ),
  ],
);

// -------------------------------------------------------------- shortlinks

/**
 * Admin-managed redirects served from the site root: `/<slug>` to `targetUrl`
 * (307; inactive links answer 404). Mirror of lib/db/schema/shortlinks.ts.
 * The slug is stored lowercase and unique; the CHECK is the legacy
 * `validateSlug` grammar, so the database stays the final arbiter. The list of
 * reserved slugs (paths of real routes) is application code, not a constraint.
 */
export const shortlinks = sqliteTable(
  "shortlinks",
  {
    id: uuidPk(),
    /** Path segment after the domain, no leading slash. Lowercase letters, digits, single inner hyphens, at most 64. */
    slug: text("slug").notNull(),
    /** Absolute http(s) URL, or a site-internal path starting with a single "/". */
    targetUrl: text("target_url").notNull(),
    /** Internal-only note: what the link is for, where it was shared. */
    note: text("note"),
    /** Inactive links answer 404 but keep their slug reserved. */
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    clickCount: integer("click_count").notNull().default(0),
    lastClickedAt: timestampMs("last_clicked_at"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("shortlinks_slug_idx").on(t.slug),
    check(
      "shortlinks_slug_check",
      sql`length(${t.slug}) between 1 and 64 and ${t.slug} not glob '*[^a-z0-9-]*' and ${t.slug} not glob '-*' and ${t.slug} not glob '*-' and ${t.slug} not glob '*--*'`,
    ),
    check(
      "shortlinks_target_check",
      sql`(${t.targetUrl} like '/%' and ${t.targetUrl} not like '//%') or ${t.targetUrl} like 'http://%' or ${t.targetUrl} like 'https://%'`,
    ),
    check("shortlinks_click_count_check", sql`${t.clickCount} >= 0`),
  ],
);
