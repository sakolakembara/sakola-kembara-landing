import { pgTable, uuid, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { adminUsers } from "./admin-users";

export const announcementSeverity = ["info", "warning", "urgent"] as const;
export type AnnouncementSeverity = (typeof announcementSeverity)[number];

export const announcements = pgTable(
  "announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    body: text("body").notNull(), // markdown allowed

    severity: text("severity", { enum: announcementSeverity }).notNull().default("info"),

    ctaLabel: text("cta_label"),
    ctaUrl: text("cta_url"),

    active: boolean("active").notNull().default(false),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),

    createdBy: uuid("created_by").references(() => adminUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activeIdx: index("announcements_active_idx").on(t.active, t.startsAt, t.endsAt),
  }),
);

export type Announcement = typeof announcements.$inferSelect;
export type NewAnnouncement = typeof announcements.$inferInsert;
