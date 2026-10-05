import "server-only";
import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { announcements, type Announcement } from "@/lib/db/schema";

// Announcement reader — used by the homepage strip + the admin list.
// Caches the "current active" lookup behind the "announcements" tag so admin
// writes that call revalidateTag immediately refresh the public render.

/**
 * Currently-active announcement, or null. "Active" = `active = true` AND
 * (startsAt is null OR startsAt ≤ now) AND (endsAt is null OR endsAt ≥ now).
 *
 * If multiple rows match, the most recently created wins. The admin UI
 * encourages publishing one at a time but doesn't enforce it — that lets the
 * team schedule a follow-up while the current one is still active.
 */
async function readCurrentAnnouncement(): Promise<Announcement | null> {
  const now = new Date();
  const row = await db.query.announcements.findFirst({
    where: and(
      eq(announcements.active, true),
      or(isNull(announcements.startsAt), lte(announcements.startsAt, now)),
      or(isNull(announcements.endsAt), gte(announcements.endsAt, now)),
    ),
    orderBy: desc(announcements.createdAt),
  });
  return row ?? null;
}

const getCachedCurrent = unstable_cache(
  () => readCurrentAnnouncement(),
  ["announcements-current"],
  { tags: ["announcements"] },
);

// unstable_cache JSON-serializes the value, which turns Date columns into ISO
// strings. Re-hydrate so callers can safely call .toLocaleString() etc.
function hydrateAnnouncement(
  row: Announcement | null | undefined,
): Announcement | null {
  if (!row) return null;
  return {
    ...row,
    startsAt: row.startsAt ? new Date(row.startsAt) : null,
    endsAt: row.endsAt ? new Date(row.endsAt) : null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

export async function getCurrentAnnouncement(): Promise<Announcement | null> {
  try {
    const row = await getCachedCurrent();
    return hydrateAnnouncement(row);
  } catch (err) {
    // The DB isn't reachable during `next build` (it lives on the VPS), and a
    // transient outage shouldn't blank the whole site. Degrade to "no
    // announcement" — the strip just doesn't render.
    console.error("[announcements] read failed, rendering without strip:", err);
    return null;
  }
}

/** Used by the admin list — bypasses the cache to always show fresh data. */
export async function getAllAnnouncements(): Promise<Announcement[]> {
  return db
    .select()
    .from(announcements)
    .orderBy(desc(announcements.createdAt));
}
