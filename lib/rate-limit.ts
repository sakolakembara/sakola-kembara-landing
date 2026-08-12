import "server-only";
import { headers } from "next/headers";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { rateLimitHits } from "@/lib/db/schema";

// Simple fixed-window rate limiter backed by Postgres. Good enough for
// public-form spam protection at our scale; not a substitute for a proper
// WAF / bot mitigation if the site ever attracts targeted abuse.

export interface RateLimitResult {
  allowed: boolean;
  /** Hits observed in the current window (including this one). */
  count: number;
  /** Max hits allowed per window. */
  limit: number;
  /** ISO ms when the current window resets. */
  resetAt: number;
}

interface RateLimitOptions {
  /** Distinguishes different endpoints, e.g. "contact.submit". */
  action: string;
  /** Max requests allowed per window. */
  limit: number;
  /** Window size in seconds (e.g. 60 for 1 min). */
  windowSeconds: number;
  /** Additional dimension to bucket by, e.g. an email. Combined with IP. */
  extraKey?: string;
}

/**
 * Consume one token in the (action, ip[, extraKey]) bucket.
 *
 * Returns `{ allowed: false }` when the caller is over the limit for the
 * current window. Callers should short-circuit with a user-facing error
 * (HTTP 429 or a "coba lagi nanti" message) instead of proceeding with
 * the mutation.
 *
 * Safe to call from server actions and route handlers. Uses an upsert +
 * atomic increment so concurrent requests don't race.
 */
export async function rateLimit(
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const ip = await clientIp();
  const now = new Date();
  const windowMs = opts.windowSeconds * 1000;
  const windowStart = new Date(
    Math.floor(now.getTime() / windowMs) * windowMs,
  );
  const key = opts.extraKey
    ? `${opts.action}:${ip}:${opts.extraKey}`
    : `${opts.action}:${ip}`;

  // Upsert-and-increment in one statement so parallel calls don't race.
  const [row] = await db
    .insert(rateLimitHits)
    .values({ key, windowStart, hits: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: [rateLimitHits.key, rateLimitHits.windowStart],
      set: {
        hits: sql`${rateLimitHits.hits} + 1`,
        updatedAt: now,
      },
    })
    .returning({ hits: rateLimitHits.hits });

  const count = row?.hits ?? 1;
  return {
    allowed: count <= opts.limit,
    count,
    limit: opts.limit,
    resetAt: windowStart.getTime() + windowMs,
  };
}

/**
 * Extract the client IP from the request. Trusts x-forwarded-for when it's
 * present (Caddy sets it in prod) — the first entry is the original client,
 * subsequent entries are added by proxies. Falls back to a placeholder so
 * we still throttle when the header is missing (better to over-throttle
 * than to let a spammer bypass by stripping the header).
 */
async function clientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = h.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

/**
 * Best-effort cleanup — delete rate-limit rows older than the cutoff.
 * Not on a schedule; call this ad-hoc from a maintenance action if the
 * table grows beyond expectation.
 */
export async function pruneRateLimitHits(olderThan: Date): Promise<number> {
  const result = await db
    .delete(rateLimitHits)
    .where(and(eq(sql`true`, sql`true`), sql`${rateLimitHits.updatedAt} < ${olderThan}`));
  return result.rowCount ?? 0;
}
