import { pgTable, uuid, text, integer, timestamp, index, jsonb } from "drizzle-orm/pg-core";

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

export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    /** Path under /public (e.g. /images/team/<slug>-<rand>.jpg). Optional. */
    image: text("image"),
    /** Which section this member appears under on /tim. */
    category: text("category", { enum: teamCategory })
      .notNull()
      .default("pengurus"),
    /** Long-form bio shown inside the profile drawer. */
    bio: text("bio"),
    educationHistory: jsonb("education_history")
      .$type<EducationEntry[]>()
      .notNull()
      .default([]),
    workHistory: jsonb("work_history")
      .$type<WorkEntry[]>()
      .notNull()
      .default([]),
    /** Manual sort key — lower numbers appear first within the same category. */
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
    categoryIdx: index("team_members_category_idx").on(t.category),
  }),
);

export type TeamMember = typeof teamMembers.$inferSelect;
export type NewTeamMember = typeof teamMembers.$inferInsert;
