import { and, eq, type Placeholder } from "drizzle-orm";
import type { Db } from "../db/audit";
import { shortlinks } from "../db/schema";

// The two D1 statements of a shortlink redirect, in one place (docs/cloudflare/admin-konten.md, "The redirect"):
// one indexed read to find where a slug goes, and one write to count the visit. Neither selects more than the
// redirect needs; nothing about the visitor is read or kept.

/**
 * The ACTIVE link behind a slug: its id (for the count) and its target. An inactive link is not found at all,
 * the same answer as an unknown slug, so a retired campaign link does not confirm that it ever existed
 * (legacy `resolveShortlink`). The plan is a seek on the unique index `shortlinks_slug_idx`; `active` is checked
 * on the row it finds.
 */
export const shortlinkQuery = (db: Db, slug: string | Placeholder) =>
  db
    .select({ id: shortlinks.id, targetUrl: shortlinks.targetUrl })
    .from(shortlinks)
    .where(and(eq(shortlinks.slug, slug), eq(shortlinks.active, true)))
    .limit(1);

/**
 * The count of one visit: ONE `UPDATE` of ONE row, with no read before it (SQL does the addition), so two visits
 * in the same instant both count. `click_count` and `last_clicked_at` are in no index, so D1 bills it as one row
 * written. `updated_at` is deliberately NOT touched: a click is not an edit, and bumping the version would make
 * every admin's open form "stale" the moment someone followed the link.
 *
 * Plain D1 (not a Drizzle `update()`) because Drizzle would add `updated_at` itself (`$onUpdate` on the column).
 */
export const CLICK_SQL = "UPDATE shortlinks SET click_count = click_count + 1, last_clicked_at = ? WHERE id = ?";

export async function recordClick(d1: D1Database, id: string, now: number = Date.now()): Promise<void> {
  await d1.prepare(CLICK_SQL).bind(now, id).run();
}
