import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";

export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    /** Affiliation — typically a university or institution. Optional. */
    university: text("university"),
    /** Path under /public (e.g. /images/team/<slug>-<rand>.jpg). Optional. */
    image: text("image"),
    /** Manual sort key — lower numbers appear first on the public page. */
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    displayOrderIdx: index("team_members_display_order_idx").on(t.displayOrder),
  }),
);

export type TeamMember = typeof teamMembers.$inferSelect;
export type NewTeamMember = typeof teamMembers.$inferInsert;
