import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users";

export const resourceCategory = [
  "panduan",
  "berkas-pendaftaran",
  "berkas-marketing",
  "tutorial",
  "lainnya",
] as const;
export type ResourceCategory = (typeof resourceCategory)[number];

export const resourceContentType = ["file", "url", "text"] as const;
export type ResourceContentType = (typeof resourceContentType)[number];

/**
 * Admin-managed catalog of documents that public visitors can consume via
 * `/gabung-siswa/docs`. Each row is exactly one of three shapes based on
 * `contentType`:
 *   - "file": `filePath` populated (uploaded under public/resources/…)
 *   - "url":  `externalUrl` populated (link to Drive / Canva / YouTube / etc.)
 *   - "text": `bodyText` populated (short snippets meant to be copied — e.g.
 *             IG caption, twibbon text, template broadcast pesan)
 *
 * The wizard links contextually into stable category anchors
 * (`/gabung-siswa/docs#berkas-marketing`).
 */
export const siteResources = pgTable(
  "site_resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category", { enum: resourceCategory })
      .notNull()
      .default("lainnya"),
    displayOrder: integer("display_order").notNull().default(0),
    contentType: text("content_type", { enum: resourceContentType }).notNull(),
    /** For contentType="file": path under /public — /resources/<file>. */
    filePath: text("file_path"),
    fileSize: integer("file_size"),
    /** For contentType="url": external URL. */
    externalUrl: text("external_url"),
    /** For contentType="text": the raw copy-able content. */
    bodyText: text("body_text"),
    notes: text("notes"),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    categoryOrderIdx: index("site_resources_category_order_idx").on(
      t.category,
      t.displayOrder,
    ),
  }),
);

export type SiteResource = typeof siteResources.$inferSelect;
export type NewSiteResource = typeof siteResources.$inferInsert;
