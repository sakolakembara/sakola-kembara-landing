import { NextResponse } from "next/server";

// Cache-Control for the public read endpoints. They are fetched
// server-to-server by the Astro Worker, which (or Cloudflare in front of this
// origin) may cache by these headers.
//
// Freshness: the readers sit behind unstable_cache tags that admin saves
// revalidate, so the origin is current right after a save. What can lag is a
// downstream cache: at most s-maxage (60 s) fresh, then one stale answer
// while it refetches (stale-while-revalidate), so an edit shows within about
// a minute and never takes more than ~6. Announcements are time-critical (an
// urgent notice should appear or disappear quickly), hence the shorter
// window. A 404 is cached briefly so a probe cannot hammer the origin, yet a
// freshly published article still appears within 30 s.
//
// Responses carry no cookies and do not vary on any request header, so they
// are safe to share; Accept-Encoding is the only Vary, added by the server.
export const CACHE_CONTENT = "public, s-maxage=60, stale-while-revalidate=300";
export const CACHE_ANNOUNCEMENT =
  "public, s-maxage=30, stale-while-revalidate=60";
export const CACHE_NOT_FOUND = "public, s-maxage=30";
export const CACHE_NONE = "no-store";

export function publicJson<T>(
  body: T,
  cacheControl: string,
  status = 200,
): NextResponse<T> {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": cacheControl },
  });
}

/** Uncached JSON error: `{ error, ...extra }` (the shape of ErrorResponse). */
export function publicError(
  status: number,
  error: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(
    { error, ...extra },
    { status, headers: { "Cache-Control": CACHE_NONE, ...headers } },
  );
}
