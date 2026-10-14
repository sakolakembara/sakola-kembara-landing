import type { Context, MiddlewareHandler, Next } from "hono";
import type { AppEnv } from "../context";
import { EMAIL_QUOTA_MESSAGE, emailAvailable, emailQuotaSpent } from "../email/send";
import { clientIp, emailKey } from "../security/client";
import { checkLimits, limitedResponse, type LimitCheck } from "../security/rate-limit";
import { guardTurnstile, type TurnstileAction } from "../security/turnstile";
import { STUDENT_AUDIENCE } from "./audience";
import { AUTH_BASE_PATH } from "./factory";

// One table says which routes under /api/auth are public and what each one is
// protected with. Anything not in it is answered 404, so the ~40 endpoints
// Better Auth ships (change-email, delete-user, update-user, list-sessions,
// sign-up/email without Turnstile, ...) are not reachable by accident, and a
// route can never be added without choosing its limits.
//
// Order for a listed route, cheapest first, none of it touching the database but the one marked:
//   1. JSON only (POST)         415, so form-encoded bodies cannot dodge the keys below
//   2. email available          503, a route that sends email refuses BEFORE it creates anything
//   3. rate limits              429 with Retry-After and the Indonesian message
//   4. the day's email quota    503 `email_quota`: ONE D1 read, only for a route that sends email on the PORTAL's mount
//                               point (docs/cloudflare/portal-architecture.md, 9.2); the admin's routes are unchanged
//   5. Turnstile                403 failed or reused, 503 when the check cannot run
// then Better Auth (or src/auth/register.ts) runs.

interface RouteKeys {
  ip: string;
  /** Hash of the email in the body, or null when the body has none. */
  email: string | null;
}

/** A limit keyed by the email. A request without one is not counted against a shared "no email" key; the IP limits still apply to it. */
function byEmail(name: LimitCheck["name"], email: string | null): LimitCheck[] {
  return email === null ? [] : [{ name, key: email }];
}

interface Policy {
  method: "GET" | "POST";
  /** Path below /api/auth. A trailing "/" means "this prefix and a parameter after it". */
  path: string;
  /** The route sends an email, so it needs a working provider (production) before it does anything. */
  sendsEmail?: boolean;
  turnstile?: TurnstileAction;
  limits: (keys: RouteKeys) => LimitCheck[];
}

const none = () => [];

export const AUTH_POLICIES: readonly Policy[] = [
  {
    method: "POST",
    path: "/sign-in/email",
    turnstile: "login",
    limits: ({ ip, email }) => [{ name: "login", key: `${ip}|${email ?? "none"}` }, ...byEmail("loginAccount", email)],
  },
  {
    // Not a Better Auth route: our own, see register.ts. Better Auth's sign-up/email is NOT exposed.
    method: "POST",
    path: "/register",
    sendsEmail: true,
    turnstile: "register",
    limits: ({ ip, email }) => [{ name: "register", key: ip }, ...byEmail("mailTarget", email)],
  },
  {
    method: "POST",
    path: "/request-password-reset",
    sendsEmail: true,
    turnstile: "forgot-password",
    limits: ({ ip, email }) => [{ name: "reset", key: ip }, ...byEmail("mailTarget", email)],
  },
  {
    method: "POST",
    path: "/send-verification-email",
    sendsEmail: true,
    // Sends email, so it needs the same protection as the other routes that do.
    // The legacy resend button was behind a session; this one is not.
    turnstile: "resend-verification",
    limits: ({ ip, email }) => [...byEmail("verifyResend", email), ...byEmail("mailTarget", email), { name: "reset", key: ip }],
  },
  { method: "POST", path: "/reset-password", limits: ({ ip }) => [{ name: "token", key: ip }] },
  { method: "GET", path: "/reset-password/", limits: ({ ip }) => [{ name: "token", key: ip }] },
  { method: "GET", path: "/verify-email", limits: ({ ip }) => [{ name: "token", key: ip }] },
  { method: "POST", path: "/sign-in/social", limits: ({ ip }) => [{ name: "token", key: ip }] },
  { method: "GET", path: "/callback/", limits: ({ ip }) => [{ name: "token", key: ip }] },
  { method: "POST", path: "/sign-out", limits: none },
  { method: "GET", path: "/get-session", limits: none },
];

/** The policy of a request, looked up below the audience's mount point (`/api/auth` for the admin, `/portal/api/auth` for the portal). */
export function findPolicy(method: string, path: string, basePath: string = AUTH_BASE_PATH): Policy | undefined {
  const below = path.startsWith(basePath) ? path.slice(basePath.length) : path;
  return AUTH_POLICIES.find(
    (policy) => policy.method === method && (policy.path.endsWith("/") ? below.startsWith(policy.path) && below.length > policy.path.length : below === policy.path),
  );
}

// No legitimate auth request is near this size. Reading is capped so a huge
// body cannot cost CPU or memory before the limits have looked at it.
const MAX_BODY_BYTES = 8 * 1024;

/** The body as JSON, read from a clone (Better Auth reads the original), or undefined when it is too big or not JSON. */
async function readSmallJson(request: Request): Promise<{ tooBig: boolean; value: unknown }> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return { tooBig: true, value: undefined };
  const reader = request.clone().body?.getReader();
  if (!reader) return { tooBig: false, value: undefined };
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return { tooBig: true, value: undefined };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { tooBig: false, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { tooBig: false, value: undefined };
  }
}

/** The gate for one audience's mount point. The route table and the order of checks are the same for both. */
export function createAuthGate(basePath: string): MiddlewareHandler<AppEnv> {
  return (c, next) => runGate(basePath, c, next);
}

/** The admin Worker's gate: `/api/auth/*`. */
export const authGate: MiddlewareHandler<AppEnv> = createAuthGate(AUTH_BASE_PATH);

async function runGate(basePath: string, c: Context<AppEnv>, next: Next): Promise<Response | void> {
  const path = c.req.path.replace(/\/+$/, "");
  const policy = findPolicy(c.req.method, path, basePath);
  if (!policy) return c.json({ error: "not_found" }, 404);

  let email: string | null = null;
  if (c.req.method === "POST") {
    if (!c.req.header("content-type")?.toLowerCase().startsWith("application/json")) {
      return c.json({ error: "json_required" }, 415);
    }
    const body = await readSmallJson(c.req.raw);
    if (body.tooBig) return c.json({ error: "body_too_large" }, 413);
    const given = (body.value as { email?: unknown } | undefined)?.email;
    if (typeof given === "string" && given.trim() !== "") email = await emailKey(given);
  }

  if (policy.sendsEmail && !emailAvailable(c.env)) {
    console.error("[auth] email provider is not configured; refusing a route that must send email");
    return c.json({ error: "email_unavailable", message: "Layanan email sedang tidak tersedia. Silakan coba lagi nanti." }, 503);
  }

  const ip = clientIp(c.req.raw.headers);
  const limited = await checkLimits(c.env, policy.limits({ ip, email }));
  if (!limited.allowed) return limitedResponse(limited);

  // Resend's 100 a day: once they are spent a registration, a resend or a reset would answer "ok" and send nothing
  // (the anonymous routes answer the same for everyone), so the person is told instead, before anything is created
  // and before a Turnstile token is spent. A function of the day, not of the address: it enumerates nobody.
  if (policy.sendsEmail && basePath === STUDENT_AUDIENCE.basePath && (await emailQuotaSpent(c.env))) {
    return c.json({ error: "email_quota", message: EMAIL_QUOTA_MESSAGE }, 503);
  }

  if (policy.turnstile) {
    const refused = await guardTurnstile(c.env, c.req.raw, policy.turnstile);
    if (refused) return refused;
  }
  return next();
}
