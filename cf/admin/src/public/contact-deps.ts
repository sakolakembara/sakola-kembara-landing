import type { Bindings } from "../env";
import { isProduction } from "../env";
import { checkLimits, RATE_LIMITS, type LimitEnv } from "../security/rate-limit";
import { verifyTurnstile } from "../security/turnstile";

// The two collaborators of the contact route that other parts of the backend
// own, as small interfaces. The route (src/api/public/contact.ts) only knows
// these; what stands behind them is chosen in `resolveContactDeps`. Since the
// auth work (SAKEM-081 part B) they are the shared limiter and the shared
// Turnstile check of src/security/ (docs/cloudflare/public-api.md, "The seam",
// and docs/cloudflare/auth.md).

export interface RateLimitVerdict {
  allowed: boolean;
  /** Seconds the caller should wait. Only meaningful when `allowed` is false. */
  retryAfterSeconds: number;
}

/** Counts one attempt for `key` and says whether it is within the limit. */
export interface RateLimiter {
  hit(key: string): Promise<RateLimitVerdict>;
}

/**
 * Checks a Cloudflare Turnstile token for a visitor. `token` is whatever the
 * caller forwarded (null when it sent none); `ip` is the trusted visitor
 * address. Returns false for a missing, invalid or reused token. It should
 * throw only for an infrastructure failure (the route then answers 500 and
 * stores nothing).
 */
export type VerifyTurnstile = (input: { token: string | null; ip: string }) => Promise<boolean>;

export interface ContactDeps {
  rateLimiter: RateLimiter;
  verifyTurnstile: VerifyTurnstile;
  /** Milliseconds since the epoch; a parameter so tests can move the clock. */
  now(): number;
}

// ---------------------------------------------------------- implementations

/**
 * A fixed-window counter in memory with `RateLimiter`'s shape. Per isolate, so
 * on Workers it is not a limiter at all: it is the test double of the contact
 * tests (they inject it through `ContactDeps`). Production runs
 * `sharedRateLimiter`, which falls back to the shared in-memory counter of
 * src/security/rate-limit.ts only outside production.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private windows = new Map<string, { start: number; hits: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowSeconds: number,
    private readonly now: () => number = Date.now,
  ) {}

  async hit(key: string): Promise<RateLimitVerdict> {
    const now = this.now();
    const windowMs = this.windowSeconds * 1000;
    const start = Math.floor(now / windowMs) * windowMs;
    // Forget windows that are over, so the map cannot grow without bound.
    if (this.windows.size > 1000) {
      for (const [k, w] of this.windows) if (w.start < start) this.windows.delete(k);
    }
    const current = this.windows.get(key);
    const hits = current && current.start === start ? current.hits + 1 : 1;
    this.windows.set(key, { start, hits });
    return { allowed: hits <= this.limit, retryAfterSeconds: Math.max(1, Math.ceil((start + windowMs - now) / 1000)) };
  }
}

/**
 * A check that passes everything. Not used by `resolveContactDeps` any more
 * (the real check below skips itself outside production when no secret is set);
 * kept as the "no bot check" double of the contact tests.
 */
export const turnstileDisabled: VerifyTurnstile = async () => true;

/** A refusal that is the operator's problem, not the visitor's: the route turns a throw into a 500 and stores nothing. */
class ContactInfrastructureError extends Error {
  constructor(name: "RateLimitUnavailable" | "TurnstileUnavailable") {
    super(name);
    this.name = name;
  }
}

/**
 * The shared limiter (src/security/rate-limit.ts, binding `RL_CONTACT`, 5 per
 * 60 s) as a `RateLimiter`. `key` is what the route built, "contact:<address>",
 * with the address from X-Sakem-Client-Ip and nothing else. The binding answers
 * yes or no and not "how long", so a refusal reports the whole period: the
 * honest upper bound. A missing binding is refused in production (a throw: the
 * route answers 500 and stores nothing); outside production the shared
 * in-memory counter takes over.
 */
export function sharedRateLimiter(env: LimitEnv): RateLimiter {
  return {
    async hit(key) {
      const result = await checkLimits(env, [{ name: "contact", key }]);
      if (result.allowed) return { allowed: true, retryAfterSeconds: 0 };
      if (result.reason === "unavailable") throw new ContactInfrastructureError("RateLimitUnavailable");
      return { allowed: false, retryAfterSeconds: RATE_LIMITS.contact.period };
    },
  };
}

/**
 * The shared Turnstile check (src/security/turnstile.ts, action "contact") as a
 * `VerifyTurnstile`. `token` is what the Astro Worker forwarded in
 * X-Sakem-Turnstile-Token and `ip` the trusted visitor address, sent to
 * Siteverify as `remoteip`. A failed, missing or reused token is `false` (the
 * route answers 400 turnstile_failed). No secret in production, Siteverify
 * unreachable or unreadable: a throw (500, nothing stored), so a broken check
 * never lets a message through. Outside production without a secret the check
 * is skipped, like the forms of the auth routes.
 */
export function sharedTurnstile(env: Pick<Bindings, "ENVIRONMENT" | "TURNSTILE_SECRET_KEY">): VerifyTurnstile {
  return async ({ token, ip }) => {
    const result = await verifyTurnstile({ secret: env.TURNSTILE_SECRET_KEY, production: isProduction(env) }, token, ip, "contact");
    if (result.ok) return true;
    if (result.reason === "rejected" || result.reason === "missing_token") return false;
    throw new ContactInfrastructureError("TurnstileUnavailable");
  };
}

// ------------------------------------------------------------------ the seam

/**
 * What the contact route runs with: the shared limiter and the shared
 * Turnstile check. One limiter only: the `PUBLIC_CONTACT_LIMIT` binding of the
 * first version of this route is gone (same 5 per 60 s, but with no
 * production fallback to a per-isolate counter, which on Workers limits
 * nothing).
 */
export function resolveContactDeps(env: Pick<Bindings, "ENVIRONMENT" | "TURNSTILE_SECRET_KEY"> & LimitEnv): ContactDeps {
  return {
    rateLimiter: sharedRateLimiter(env),
    verifyTurnstile: sharedTurnstile(env),
    now: Date.now,
  };
}
