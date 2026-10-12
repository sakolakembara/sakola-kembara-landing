import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAt, enumCheck, timestampMs, updatedAt, uuidPk } from "./_common";
import { users } from "./auth";

// Communication: the announcement strip and the public contact form's inbox.
// Area: `komunikasi` (Pesan, Pengumuman).

export const announcementSeverity = ["info", "warning", "urgent"] as const;
export type AnnouncementSeverity = (typeof announcementSeverity)[number];

/** Mirror of lib/db/schema/announcements.ts. Shown on every public page while active and inside its window. */
export const announcements = sqliteTable(
  "announcements",
  {
    id: uuidPk(),
    title: text("title").notNull(),
    body: text("body").notNull(), // markdown allowed
    severity: text("severity", { enum: announcementSeverity }).notNull().default("info"),
    ctaLabel: text("cta_label"),
    ctaUrl: text("cta_url"),
    active: integer("active", { mode: "boolean" }).notNull().default(false),
    startsAt: timestampMs("starts_at"),
    endsAt: timestampMs("ends_at"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("announcements_active_idx").on(t.active, t.startsAt, t.endsAt),
    enumCheck("announcements_severity_check", t.severity, announcementSeverity),
    // Rules the legacy server action enforced; the public API relies on them.
    check("announcements_cta_pair_check", sql`(${t.ctaLabel} is null) = (${t.ctaUrl} is null)`),
    check("announcements_window_check", sql`${t.startsAt} is null or ${t.endsAt} is null or ${t.endsAt} >= ${t.startsAt}`),
  ],
);

export const contactSubject = ["partnership", "donation", "other"] as const;
export type ContactSubject = (typeof contactSubject)[number];

/**
 * Messages from the public contact form (`POST /api/public/contact`).
 * Personal data of a visitor: only the Pesan menu and the audit trail
 * (without the text) may touch it.
 */
export const contactMessages = sqliteTable(
  "contact_messages",
  {
    id: uuidPk(),
    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    subject: text("subject", { enum: contactSubject }).notNull(),
    message: text("message").notNull(),
    /** Null until an admin opens the detail page. */
    readAt: timestampMs("read_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("contact_messages_created_at_idx").on(t.createdAt),
    index("contact_messages_read_at_idx").on(t.readAt),
    index("contact_messages_email_idx").on(t.email),
    enumCheck("contact_messages_subject_check", t.subject, contactSubject),
  ],
);
