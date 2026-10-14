// Rate limiting with Cloudflare's rate limit bindings, one per concern.
//
// Why not a table (legacy lib/rate-limit.ts: a Postgres row per request): on D1
// Free every counted request would spend a row write of the 100,000/day budget,
// and a bot is exactly the traffic that would burn it. Why not Better Auth's
// own limiter: in memory it is per isolate (useless on Workers) and in D1 it
// is the same write per request. A binding costs no D1 and no extra CPU worth
// measuring. What it gives up: counters live per Cloudflare location and are
// eventually consistent, and the period is 10 or 60 seconds only (legacy used
// 5 minutes to an hour). It is a brake, not an exact quota.
//
// The numbers below are the source of truth for the in-memory fallback and
// must equal the `ratelimits` in wrangler.jsonc (test/rate-limit.test.ts reads
// that file and fails when they differ).
//
// This file has no imports from the rest of the app on purpose: the worker
// that serves the public contact form can import `checkLimits` and
// `limitedResponse` and declare the `RL_CONTACT` binding itself.

export type RateLimitBinding =
  | "RL_LOGIN"
  | "RL_LOGIN_ACCOUNT"
  | "RL_REGISTER"
  | "RL_RESET"
  | "RL_VERIFY_RESEND"
  | "RL_MAIL_TARGET"
  | "RL_TOKEN"
  | "RL_CONTACT"
  | "RL_UPLOAD"
  | "RL_BLOG_PREVIEW"
  | "RL_PORTAL_READ"
  | "RL_PORTAL_SAVE"
  | "RL_PORTAL_UPLOAD"
  | "RL_PORTAL_SUBMIT"
  | "RL_ADMIN_FILE";

export interface LimitConfig {
  binding: RateLimitBinding;
  /** Requests allowed per `period`. */
  limit: number;
  /** Cloudflare allows 10 or 60 only. */
  period: 10 | 60;
  /** Shown to the user. Legacy copy where the window still fits (see docs/cloudflare/auth.md). */
  message: string;
}

export const RATE_LIMITS = {
  /** Sign-in. Key: route + IP + email hash. One client on one account. */
  login: {
    binding: "RL_LOGIN",
    limit: 5,
    period: 60,
    message: "Terlalu banyak percobaan masuk. Silakan tunggu beberapa menit lalu coba lagi.",
  },
  /** Sign-in. Key: email hash. One account from many addresses. */
  loginAccount: {
    binding: "RL_LOGIN_ACCOUNT",
    limit: 20,
    period: 60,
    message: "Terlalu banyak percobaan masuk. Silakan tunggu beberapa menit lalu coba lagi.",
  },
  /** Student registration. Key: IP. */
  register: {
    binding: "RL_REGISTER",
    limit: 10,
    period: 60,
    message: "Terlalu banyak percobaan pendaftaran. Silakan tunggu beberapa menit lalu coba lagi.",
  },
  /** "Forgot password". Key: IP. Legacy said "sekitar satu jam" for its 3-per-hour window; ours is a minute. */
  reset: {
    binding: "RL_RESET",
    limit: 5,
    period: 60,
    message: "Terlalu banyak permintaan. Silakan tunggu satu menit lalu coba lagi.",
  },
  /** "Send the verification link again". Key: email hash. */
  verifyResend: {
    binding: "RL_VERIFY_RESEND",
    limit: 2,
    period: 60,
    message: "Terlalu banyak permintaan. Coba lagi sekitar satu menit lagi.",
  },
  /** Any email to one mailbox (register, reset, resend, invite). Key: email hash. */
  mailTarget: {
    binding: "RL_MAIL_TARGET",
    limit: 3,
    period: 60,
    message: "Terlalu banyak email dikirim ke alamat ini. Silakan tunggu satu menit lalu coba lagi.",
  },
  /** Redeeming a token, starting Google sign-in. Key: IP. */
  token: {
    binding: "RL_TOKEN",
    limit: 20,
    period: 60,
    message: "Terlalu banyak percobaan. Coba lagi dalam beberapa menit.",
  },
  /** Public contact form, 5 per minute per visitor address (legacy and docs/cloudflare/content-api.md). Key: IP. */
  contact: {
    binding: "RL_CONTACT",
    limit: 5,
    period: 60,
    message: "Terlalu banyak percobaan pengiriman. Silakan tunggu satu menit lalu coba lagi.",
  },
  /** Admin uploads and their deletes, 20 per minute per signed-in user. Key: user id (not the address: an office shares one). */
  upload: {
    binding: "RL_UPLOAD",
    limit: 20,
    period: 60,
    message: "Terlalu banyak unggahan. Silakan tunggu satu menit lalu coba lagi.",
  },
  /**
   * The blog editor's preview (src/api/blog.ts, a markdown render on the Worker per request), 60 per minute per
   * signed-in user. The editor asks at most once per 400 ms of a pause in typing, so a person never meets it; a
   * stuck client or a stolen session cannot spend the CPU of the Worker. Key: user id.
   */
  blogPreview: {
    binding: "RL_BLOG_PREVIEW",
    limit: 60,
    period: 60,
    message: "Terlalu banyak permintaan pratinjau. Silakan tunggu satu menit lalu coba lagi.",
  },

  // ─── The student portal (SAKEM-083; docs/cloudflare/portal-architecture.md, 6.3) ───
  // Signed-in routes are limited by USER ID, never by address or email: a school or a warnet shares one address.
  // The limiter runs right after the session is read (src/portal/guard.ts) and before the body or any other D1 or
  // R2 access. The portal Worker declares these (and the auth limiters above) with namespaces of its own, so a flood
  // of students never spends an admin's bucket.

  /** The draft, the overview, the status list and one's own files: reads. Key: user id. */
  portalRead: {
    binding: "RL_PORTAL_READ",
    limit: 60,
    period: 60,
    message: "Terlalu banyak permintaan. Silakan tunggu satu menit lalu coba lagi.",
  },
  /** `PUT .../steps/:step`. A student saves a step when they finish it: seven times in a session, 30 is a stuck client. Key: user id. */
  portalSave: {
    binding: "RL_PORTAL_SAVE",
    limit: 30,
    period: 60,
    message: "Terlalu banyak penyimpanan. Silakan tunggu satu menit lalu coba lagi.",
  },
  /** `PUT` and `DELETE` of a file. Keeps a stuck client from burning the R2 Class A budget and the memory of many streams. Key: user id. */
  portalUpload: {
    binding: "RL_PORTAL_UPLOAD",
    limit: 20,
    period: 60,
    message: "Terlalu banyak unggahan. Silakan tunggu satu menit lalu coba lagi.",
  },
  /** `POST .../submit`. The legacy allowed 3 per 5 minutes; a binding allows a window of 10 or 60 seconds only, so 3 per minute. Key: user id. */
  portalSubmit: {
    binding: "RL_PORTAL_SUBMIT",
    limit: 3,
    period: 60,
    message: "Terlalu banyak percobaan pengiriman. Silakan tunggu beberapa menit lalu coba lagi.",
  },
  /** An admin opening an applicant's file (on `sakem-admin`). Bounds a stolen session's bulk copying. Key: admin id. */
  adminFile: {
    binding: "RL_ADMIN_FILE",
    limit: 120,
    period: 60,
    message: "Terlalu banyak berkas dibuka. Silakan tunggu satu menit lalu coba lagi.",
  },
} as const satisfies Record<string, LimitConfig>;

export type LimitName = keyof typeof RATE_LIMITS;

export interface LimitCheck {
  name: LimitName;
  /** Already bounded and free of personal data: build it with `emailKey`, never the raw address. */
  key: string;
}

export type LimitResult =
  | { allowed: true }
  | { allowed: false; reason: "limited"; name: LimitName }
  | { allowed: false; reason: "unavailable"; name: LimitName };

/** The bindings an environment may carry, plus `ENVIRONMENT`. */
export type LimitEnv = { ENVIRONMENT?: string } & { [K in RateLimitBinding]?: RateLimit };

// ─── In-memory fallback: local dev and tests only ─────────────────────────

/**
 * Used ONLY when a binding is missing AND the environment is not production.
 * Fixed window per key, in this isolate's memory, same limit and period as the
 * binding. It exists so a developer who runs the worker without the bindings
 * (or a test that removes one) still sees the limits work. In production a
 * missing binding is a configuration error and the request is refused.
 */
const windows = new Map<string, { count: number; resetsAt: number }>();
const MAX_TRACKED_KEYS = 5000;

function memoryAllows(config: LimitConfig, key: string, now = Date.now()): boolean {
  if (windows.size > MAX_TRACKED_KEYS) {
    for (const [stored, entry] of windows) if (entry.resetsAt <= now) windows.delete(stored);
    if (windows.size > MAX_TRACKED_KEYS) windows.clear(); // an attack on the fallback must not grow memory without bound
  }
  const id = `${config.binding}|${key}`;
  const current = windows.get(id);
  if (!current || current.resetsAt <= now) {
    windows.set(id, { count: 1, resetsAt: now + config.period * 1000 });
    return true;
  }
  current.count += 1;
  return current.count <= config.limit;
}

/** Test helper: forget every in-memory counter. */
export function resetMemoryLimits(): void {
  windows.clear();
}

// ─── Checking ─────────────────────────────────────────────────────────────

function isProductionEnv(env: { ENVIRONMENT?: string }): boolean {
  return env.ENVIRONMENT !== "development" && env.ENVIRONMENT !== "test";
}

/**
 * Counts every check, even when an earlier one already refuses: an attacker
 * who is over one limit keeps filling the others, which is what you want.
 */
export async function checkLimits(env: LimitEnv, checks: readonly LimitCheck[]): Promise<LimitResult> {
  const outcomes = await Promise.all(
    checks.map(async ({ name, key }): Promise<LimitResult> => {
      const config = RATE_LIMITS[name];
      const binding = env[config.binding];
      if (binding) {
        const { success } = await binding.limit({ key });
        return success ? { allowed: true } : { allowed: false, reason: "limited", name };
      }
      if (isProductionEnv(env)) {
        // Fail closed: without the binding nothing throttles this route.
        console.error(`[rate-limit] binding ${config.binding} is not configured; refusing the request`);
        return { allowed: false, reason: "unavailable", name };
      }
      return memoryAllows(config, key) ? { allowed: true } : { allowed: false, reason: "limited", name };
    }),
  );
  // "unavailable" outranks "limited": it is the operator's problem, not the visitor's.
  return outcomes.find((o) => !o.allowed && o.reason === "unavailable") ?? outcomes.find((o) => !o.allowed) ?? { allowed: true };
}

/** 429 with `Retry-After` and the legacy Indonesian message; 503 when the binding itself is missing. */
export function limitedResponse(result: Exclude<LimitResult, { allowed: true }>): Response {
  if (result.reason === "unavailable") {
    return Response.json({ error: "service_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const config = RATE_LIMITS[result.name];
  return Response.json(
    { error: "rate_limited", message: config.message, retryAfterSeconds: config.period },
    { status: 429, headers: { "Retry-After": String(config.period), "Cache-Control": "no-store" } },
  );
}
