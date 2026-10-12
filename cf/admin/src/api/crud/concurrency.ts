import type { Context } from "hono";

// Optimistic concurrency (docs/cloudflare/admin-crud.md#6-optimistic-concurrency-updatedat-etag-if-match).
//
// The ETag of an item is its `updatedAt` in double quotes: "2026-10-12T08:30:00.123Z".
// The SPA builds `If-Match` from the `updatedAt` it loaded, so it never reads headers.

/** `"<ISO date>"`, the ETag of a row last updated at `updatedAt`. */
export function etagOf(updatedAt: Date): string {
  return `"${updatedAt.toISOString()}"`;
}

/** The instant inside an ETag (a weak `W/` prefix is accepted), or null when it is not one of ours. `*` is not accepted: it would match anything. */
export function parseEtag(value: string): Date | null {
  const match = /^(?:W\/)?"([^"]+)"$/.exec(value.trim());
  if (!match) return null;
  const time = Date.parse(match[1]!);
  return Number.isNaN(time) ? null : new Date(time);
}

export type IfMatch =
  | { present: false }
  /** `version` is null when the header is not one of our ETags: it can never match. */
  | { present: true; version: Date | null };

export function readIfMatch(c: Context): IfMatch {
  const header = c.req.header("if-match");
  if (header === undefined) return { present: false };
  return { present: true, version: parseEtag(header) };
}

/** True when the precondition names exactly the version the row has now. */
export function matches(precondition: IfMatch, current: Date): boolean {
  return precondition.present && precondition.version !== null && precondition.version.getTime() === current.getTime();
}

/** The `updatedAt` of the next save: now, but always after the previous one, so two saves in one millisecond still differ. */
export function nextVersion(previous: Date, now: Date = new Date()): Date {
  return new Date(Math.max(now.getTime(), previous.getTime() + 1));
}
