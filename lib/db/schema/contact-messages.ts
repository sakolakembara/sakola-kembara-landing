import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";

export const contactSubject = ["partnership", "donation", "other"] as const;
export type ContactSubject = (typeof contactSubject)[number];

export const contactMessages = pgTable(
  "contact_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    subject: text("subject", { enum: contactSubject }).notNull(),
    message: text("message").notNull(),
    /** Null until an admin opens the detail page. */
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    createdAtIdx: index("contact_messages_created_at_idx").on(t.createdAt),
    readAtIdx: index("contact_messages_read_at_idx").on(t.readAt),
    emailIdx: index("contact_messages_email_idx").on(t.email),
  }),
);

export type ContactMessage = typeof contactMessages.$inferSelect;
export type NewContactMessage = typeof contactMessages.$inferInsert;
