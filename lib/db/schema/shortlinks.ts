import { pgTable, uuid, text, boolean, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Admin-managed vanity redirects served from the site root:
 * `https://sakolakembara.org/<slug>` → `targetUrl`.
 *
 * The redirect itself lives in `app/[slug]/page.tsx`, which only runs for
 * paths no real route or `public/` file already claims — Next resolves static
 * routes before dynamic ones. That precedence is silent, so a slug colliding
 * with a real route would save fine and then never fire; `RESERVED_SLUGS` in
 * `lib/shortlinks.ts` rejects those at write time instead.
 *
 * `slug` is stored already-lowercased (the action normalizes) and carries a
 * unique index, so the DB is the final arbiter of collisions even if two
 * admins submit the same slug concurrently.
 */
export const shortlinks = pgTable(
  "shortlinks",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Path segment after the domain, without a leading slash. Lowercase. */
    slug: text("slug").notNull(),
    /** Absolute http(s) URL, or a site-internal path starting with "/". */
    targetUrl: text("target_url").notNull(),
    /** Internal-only note: what this link is for, where it was shared. */
    note: text("note"),

    /** Inactive links 404 instead of redirecting — lets a campaign link be
     *  retired without freeing the slug for reuse. */
    active: boolean("active").notNull().default(true),

    clickCount: integer("click_count").notNull().default(0),
    lastClickedAt: timestamp("last_clicked_at", { withTimezone: true }),

    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugIdx: uniqueIndex("shortlinks_slug_idx").on(t.slug),
  }),
);

export type Shortlink = typeof shortlinks.$inferSelect;
export type NewShortlink = typeof shortlinks.$inferInsert;
