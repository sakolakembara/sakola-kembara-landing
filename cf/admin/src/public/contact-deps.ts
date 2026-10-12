import type { Bindings } from "../env";
import { isProduction } from "../env";
import { CONTACT_RATE_LIMIT } from "./contact";

// The two collaborators of the contact route that other parts of the backend
// own, as small interfaces. The route (src/api/public/contact.ts) only knows
// these; what stands behind them is chosen in `resolveContactDeps`, which is
// the single place to change when the shared limiter and the Turnstile helper
// of the auth work land (docs/cloudflare/public-api.md, "The seam").

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
 * Adapter over a Cloudflare rate limit binding (wrangler.jsonc `ratelimits`).
 * The binding answers yes or no and not "how long", so a refusal reports the
 * whole period as the wait: the honest upper bound. Counters are per
 * Cloudflare location and eventually consistent: a brake, not an exact quota.
 */
export function bindingRateLimiter(binding: Pick<RateLimit, "limit">, periodSeconds: number): RateLimiter {
  return {
    async hit(key) {
      const { success } = await binding.limit({ key });
      return { allowed: success, retryAfterSeconds: periodSeconds };
    },
  };
}

/**
 * A fixed-window counter in memory, like the legacy limiter but not shared:
 * every Worker isolate has its own, so on Workers it only stops a burst that
 * lands on one isolate. It exists for tests and as the fallback when no
 * binding is configured; it is not the production limiter.
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

/** Turnstile is not wired yet: every submission passes this check. */
export const turnstileDisabled: VerifyTurnstile = async () => true;

// ------------------------------------------------------------------ the seam

let fallbackLimiter: InMemoryRateLimiter | undefined;
let warnedFallback = false;

/**
 * What the contact route runs with. Replace the two lines marked SEAM when the
 * shared limiter and the Turnstile helper exist:
 *
 *   rateLimiter:     the shared limiter, adapted to `RateLimiter.hit`
 *   verifyTurnstile: the helper, adapted to `VerifyTurnstile`
 */
export function resolveContactDeps(env: Pick<Bindings, "ENVIRONMENT" | "PUBLIC_CONTACT_LIMIT">): ContactDeps {
  let rateLimiter: RateLimiter;
  if (env.PUBLIC_CONTACT_LIMIT) {
    // SEAM (rate limiter): the Cloudflare binding declared in wrangler.jsonc.
    rateLimiter = bindingRateLimiter(env.PUBLIC_CONTACT_LIMIT, CONTACT_RATE_LIMIT.windowSeconds);
  } else {
    fallbackLimiter ??= new InMemoryRateLimiter(CONTACT_RATE_LIMIT.limit, CONTACT_RATE_LIMIT.windowSeconds);
    rateLimiter = fallbackLimiter;
    if (isProduction(env) && !warnedFallback) {
      warnedFallback = true;
      console.warn("[contact] no rate limit binding: using the per-isolate in-memory limiter");
    }
  }
  return {
    rateLimiter,
    // SEAM (Turnstile): disabled until the helper is wired in.
    verifyTurnstile: turnstileDisabled,
    now: Date.now,
  };
}
