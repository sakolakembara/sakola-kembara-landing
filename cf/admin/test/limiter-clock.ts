import { vi } from "vitest";
import type { Bindings } from "../src/env";
import { RATE_LIMITS, type LimitConfig, type RateLimitBinding } from "../src/security/rate-limit";

// The clock of the rate limiters in the tests (SAKEM-088; docs/cloudflare/auth.md#controlling-the-limiter-clock-in-tests).
//
// Every limiter counts in a fixed window, and the windows follow the wall clock. Miniflare's rate limit binding
// (the one `wrangler.jsonc` declares and the tests used to get) counts in windows that line up with the clock:
// `floor(Date.now() / period)`, so a "minute" ends at :00 whatever second the first attempt came at. A test that
// counts exactly (five tries pass, the sixth is refused) therefore fails whenever the minute turns in the middle of
// it, and the slower the machine, the likelier that is. The binding runs outside the test's isolate: its clock
// cannot be faked from here. So `call()` (test/helpers.ts) hands the worker a limiter of ours instead, with the
// binding's contract and a clock the test owns, and the real binding is checked on its own, with the window
// watched, in test/rate-limit.test.ts.
//
// Two other fixed windows exist and each has its own lever:
//   * the in-memory fallback of src/security/rate-limit.ts (a binding left out of `env`) reads `Date.now()`:
//     `withFrozenDate` below freezes `Date` for one scenario;
//   * `InMemoryRateLimiter` (src/public/contact-deps.ts) takes its clock as a constructor argument:
//     pass `limiterClock.read`.

/** An instant that opens a window of every period (10 s and 60 s): 2030-01-01T00:00:00Z. The clock starts here before each test. */
export const LIMITER_START = Date.UTC(2030, 0, 1);

let now = LIMITER_START;

/** The clock the limiter doubles read. Frozen: it moves only when a test moves it. Put back at `LIMITER_START` before each test. */
export const limiterClock = {
  /** Milliseconds since the epoch, like `Date.now()`. */
  read: (): number => now,
  set: (ms: number): void => void (now = ms),
  /** Moves time forward. A window ends at the next multiple of its period: 60 s, or less when the clock is part way in. */
  advance: (ms: number): void => void (now += ms),
};

/**
 * What Miniflare's rate limit binding does (workers/ratelimit/ratelimit-object.worker.js): a counter per key, valid
 * for the window `floor(now / period)`; the call that would pass the limit is refused and not counted; a new window
 * starts every key from zero. The method takes `{ key }` and nothing else, as Cloudflare documents it (Miniflare also
 * lets a call carry `limit` and `period`; the double refuses them, so a call the real service would not honour
 * cannot pass here).
 */
export function fakeRateLimit(config: Pick<LimitConfig, "limit" | "period">, clock: () => number = limiterClock.read): RateLimit {
  const buckets = new Map<string, { epoch: number; count: number }>();
  return {
    async limit(options: RateLimitOptions): Promise<RateLimitOutcome> {
      const extra = Object.keys(options ?? {}).filter((name) => name !== "key");
      if (typeof options !== "object" || options === null || extra.length > 0 || typeof options.key !== "string") {
        throw new Error(`bad rate limit options: [${extra.join(",")}]`);
      }
      const epoch = Math.floor(clock() / (config.period * 1000));
      const bucket = buckets.get(options.key);
      const count = bucket && bucket.epoch === epoch ? bucket.count : 0;
      if (count >= config.limit) return { success: false };
      buckets.set(options.key, { epoch, count: count + 1 });
      return { success: true };
    },
  };
}

function buildLimiters(): Pick<Bindings, RateLimitBinding> {
  return Object.fromEntries(Object.values(RATE_LIMITS).map((config) => [config.binding, fakeRateLimit(config)])) as Pick<Bindings, RateLimitBinding>;
}

let limiters = buildLimiters();

/** The limiter bindings `call()` gives the worker unless a test overrides them: the table's numbers, the test's clock, empty counters. */
export function limiterBindings(): Pick<Bindings, RateLimitBinding> {
  return limiters;
}

/** Empty counters and the clock back at `LIMITER_START`. Runs before each test (test/setup.ts). */
export function resetLimiters(): void {
  now = LIMITER_START;
  limiters = buildLimiters();
}

// ─── The in-memory fallback, and anything else that reads `Date` ──────────

export interface FrozenDate {
  /** `Date.now()`, which stays where it is until `advance` moves it. */
  readonly now: number;
  advance(ms: number): void;
}

/**
 * Runs `scenario` with `Date` frozen at the real time it started (or at `at`), then puts the real clock back. For
 * the fallback counter of src/security/rate-limit.ts, whose window starts at the first attempt and lasts the period
 * by the wall clock: frozen, a slow scenario cannot outlast it. Only `Date` is frozen; timers and `performance`
 * still run. Everything that stamps time inside the scenario stamps the same instant, so do not use it around code
 * whose rows are ordered by their timestamps.
 */
export async function withFrozenDate<T>(scenario: (clock: FrozenDate) => Promise<T> | T, at: number = vi.getRealSystemTime()): Promise<T> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at);
  try {
    return await scenario({
      get now() {
        return Date.now();
      },
      advance: (ms) => vi.setSystemTime(Date.now() + ms),
    });
  } finally {
    vi.useRealTimers();
  }
}

// ─── The real binding ─────────────────────────────────────────────────────

/**
 * The bindings Miniflare provides, for the tests that exist to check them. Their windows line up with the real wall
 * clock and cannot be moved, so a scenario that counts exactly can fail when the window turns during it. Run it
 * through `inOneRealWindow`.
 */
export function realLimiterBindings(realEnv: Pick<Bindings, RateLimitBinding>): Pick<Bindings, RateLimitBinding> {
  return Object.fromEntries(Object.values(RATE_LIMITS).map((config) => [config.binding, realEnv[config.binding]])) as Pick<Bindings, RateLimitBinding>;
}

/**
 * Runs a scenario against a real binding and trusts a failure only when the window did not turn while it ran.
 * A pass is a pass. A failure with the window turned is not evidence of anything (the counters restarted under the
 * scenario): it runs again, from the start, with a fresh window in front of it (the scenario must use keys of its
 * own and clean up after itself). A failure inside one window is thrown as it is. After `attempts` turns in a row
 * it gives up and throws the last failure, which a one-minute window and a scenario of milliseconds cannot reach.
 */
export async function inOneRealWindow(period: LimitConfig["period"], scenario: () => Promise<void>, attempts = 5): Promise<void> {
  const windowOf = () => Math.floor(vi.getRealSystemTime() / (period * 1000));
  for (let attempt = 1; ; attempt++) {
    const before = windowOf();
    try {
      await scenario();
      return;
    } catch (failure) {
      if (windowOf() === before || attempt >= attempts) throw failure;
    }
  }
}
