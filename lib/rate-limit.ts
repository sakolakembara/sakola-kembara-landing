import "server-only";
import { isIP } from "node:net";
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
  /**
   * Include the client IP in the bucket key. Defaults to true. Set to false
   * for a limit that follows `extraKey` alone, regardless of where the
   * request comes from (e.g. attempts against one account).
   */
  perIp?: boolean;
}

/**
 * Consume one token in the (action[, ip][, extraKey]) bucket.
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
  const now = new Date();
  const windowMs = opts.windowSeconds * 1000;
  const windowStart = new Date(
    Math.floor(now.getTime() / windowMs) * windowMs,
  );
  const key = await bucketKey(opts);

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

async function bucketKey(opts: RateLimitOptions): Promise<string> {
  if (opts.perIp === false) {
    // "-" can never be an IP, so this cannot collide with an IP bucket.
    return `${opts.action}:-:${opts.extraKey ?? ""}`;
  }
  const ip = await clientIp();
  return opts.extraKey
    ? `${opts.action}:${ip}:${opts.extraKey}`
    : `${opts.action}:${ip}`;
}

type HeaderReader = { get(name: string): string | null };

/** Accept only well-formed IPv4 / IPv6 literals; anything else is ignored. */
function parseIp(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value || !isIP(value)) return null;
  return value.toLowerCase();
}

/**
 * Pick the client IP out of the request headers, or null when none of them
 * can be trusted.
 *
 * Production runs behind Cloudflare and nginx. Both append to any
 * X-Forwarded-For value the client sent, so the LEFT side of that header is
 * client-controlled and must never decide a bucket. Two values are set by
 * infrastructure instead:
 *
 * 1. `CF-Connecting-IP`: Cloudflare overwrites it with the address it
 *    received the connection from. Only meaningful when the origin accepts
 *    traffic from Cloudflare alone (see docs/current-state/deployment.md).
 * 2. The RIGHTMOST `X-Forwarded-For` entry: the address the nearest proxy
 *    saw as its peer. Used when there is no Cloudflare header (the Caddy
 *    stack in docker-compose.yml, a local proxy). Behind Cloudflare this
 *    is a Cloudflare edge address, so it is only a fallback.
 *
 * `X-Real-IP` is deliberately not read: nothing guarantees a proxy sets it.
 */
export function resolveClientIp(h: HeaderReader): string | null {
  const cf = parseIp(h.get("cf-connecting-ip"));
  if (cf) return cf;

  const xff = h.get("x-forwarded-for");
  if (xff) {
    const nearest = parseIp(xff.split(",").pop());
    if (nearest) return nearest;
  }
  return null;
}

let warnedMissingClientIp = false;

/**
 * Client IP used for bucketing. When no trusted header is present, all such
 * requests share the "unknown" bucket: over-throttling is the safe failure,
 * and the app cannot read the socket address itself. Logged once per
 * process so a proxy misconfiguration is visible instead of silent.
 */
async function clientIp(): Promise<string> {
  const ip = resolveClientIp(await headers());
  if (ip) return ip;
  if (!warnedMissingClientIp) {
    warnedMissingClientIp = true;
    console.warn(
      "[rate-limit] no cf-connecting-ip / x-forwarded-for on the request; " +
        "requests without a client IP share one rate-limit bucket",
    );
  }
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
