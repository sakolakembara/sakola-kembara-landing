import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../context";
import { AUTH_BASE_PATH } from "./factory";

// Throttles the Better Auth routes that guess passwords or send email, using
// Cloudflare's rate limit bindings (wrangler.jsonc). Counters are per
// Cloudflare location and eventually consistent: a brake, not an exact quota.
//
// Three buckets, because one number cannot serve a school behind one address
// and an attacker behind many:
//   pair   route + IP + email   one client working on one account   (5/min)
//   email  route + email        one account from many addresses    (20/min)
//   ip     route + IP           one address flooding email routes  (10/min)
// The ip bucket covers only routes that send email, so a classroom signing in
// together is never throttled by address alone.

const ROUTES: Record<string, { sendsEmail: boolean }> = {
  [`${AUTH_BASE_PATH}/sign-in/email`]: { sendsEmail: false },
  [`${AUTH_BASE_PATH}/sign-up/email`]: { sendsEmail: true },
  [`${AUTH_BASE_PATH}/request-password-reset`]: { sendsEmail: true },
  [`${AUTH_BASE_PATH}/send-verification-email`]: { sendsEmail: true },
};

const MAX_BODY_BYTES_TO_INSPECT = 4096;

async function emailOf(request: Request): Promise<string> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length > MAX_BODY_BYTES_TO_INSPECT) return "";
  const body: unknown = await request.clone().json().catch(() => null);
  const email = (body as { email?: unknown } | null)?.email;
  return typeof email === "string" ? email.trim().toLowerCase().slice(0, 254) : "";
}

export const authRateLimit: MiddlewareHandler<AppEnv> = async (c, next) => {
  const route = c.req.method === "POST" ? ROUTES[c.req.path] : undefined;
  if (!route) return next();

  // Set by Cloudflare's edge and not client-controllable. Absent only locally.
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const email = await emailOf(c.req.raw);
  const checks = [
    c.env.AUTH_PAIR_LIMIT.limit({ key: `${c.req.path}|${ip}|${email}` }),
    c.env.AUTH_EMAIL_LIMIT.limit({ key: `${c.req.path}|${email}` }),
  ];
  if (route.sendsEmail) checks.push(c.env.AUTH_IP_LIMIT.limit({ key: `${c.req.path}|${ip}` }));

  // Every bucket is counted even when an earlier one already refuses.
  const results = await Promise.all(checks);
  if (results.some((result) => !result.success)) {
    c.header("Retry-After", "60");
    return c.json({ error: "rate_limited" }, 429);
  }
  return next();
};
