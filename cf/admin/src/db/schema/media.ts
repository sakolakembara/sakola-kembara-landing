import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAt, enumCheck, uuidPk } from "./_common";
import { users } from "./auth";

// New in D1. A registry of the files the admin uploaded to R2. It exists for
// three reasons the contract and the uploads need:
//   1. image dimensions recorded once at upload, so the blog renderer can put
//      `width` and `height` on inline images (content-api.md) and the hero
//      image can be copied into blog_posts.image_width/height;
//   2. one place to list and clean up what is in the bucket (orphans);
//   3. size and type checks that do not need an R2 `head` call per request.
//
// It is a registry, not a foreign-key target: reports, team members, resources
// and blog posts keep a plain public path, exactly like the legacy columns, so
// the 80 imported articles and their images need no media rows.

/** What an upload is for. Decides which area may upload it (blog/team/report: konten; resource: pendaftaran). */
export const mediaPurpose = ["blog", "team", "report", "resource"] as const;
export type MediaPurpose = (typeof mediaPurpose)[number];

export const media = sqliteTable(
  "media",
  {
    id: uuidPk(),
    /** The R2 object key, no leading slash: "blog/images/2026/10/foto-ab12cd.webp". The public path is "/" + key. */
    key: text("key").notNull(),
    purpose: text("purpose", { enum: mediaPurpose }).notNull(),
    contentType: text("content_type").notNull(),
    /** Bytes. */
    size: integer("size").notNull(),
    /** Pixels; set for images, null for PDFs and other files. Both or neither. */
    width: integer("width"),
    height: integer("height"),
    uploadedBy: text("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("media_key_idx").on(t.key),
    index("media_purpose_created_idx").on(t.purpose, t.createdAt),
    enumCheck("media_purpose_check", t.purpose, mediaPurpose),
    check("media_key_check", sql`length(${t.key}) > 0 and ${t.key} not like '/%'`),
    check("media_size_check", sql`${t.size} >= 0`),
    check("media_dimensions_check", sql`((${t.width} is null) = (${t.height} is null)) and (${t.width} is null or (${t.width} > 0 and ${t.height} > 0))`),
  ],
);
