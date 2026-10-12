import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../context";

// Same-origin guard for every state-changing request to /api/*.
//
// Cookies authenticate this API. SameSite=Lax already stops a browser from
// attaching them to a cross-site POST, but a defence that depends on one
// attribute is one misconfiguration from failing (a COOKIE_DOMAIN set for a
// sibling subdomain, an older browser, a future SameSite change), so the
// request itself is checked too, with headers a page cannot forge:
//
//   1. `Origin` is sent by browsers on every POST, PUT, PATCH and DELETE. It
//      must be this site's own origin or one listed in TRUSTED_ORIGINS
//      (e.g. a Vite dev server). The string "null" never matches.
//   2. No Origin: `Sec-Fetch-Site` decides. `same-origin` (a fetch from our own
//      page) and `none` (typed in the address bar) pass; `same-site` and
//      `cross-site` do not. A sibling subdomain is same-site, so a compromised
//      or careless subdomain cannot post here.
//   3. Neither: `Referer`'s origin, same rule as 1.
//   4. None of the three: not a browser that does CSRF. It passes only when it
//      carries no cookie (nothing to abuse: a session route answers 401 anyway).
//      With a cookie it is refused.
//
// Safe methods (GET, HEAD, OPTIONS) are not checked: they change nothing. The
// verification and reset links in emails are GETs and must work from a mail
// client, which is a cross-site navigation.
//
// Better Auth runs its own origin check on /api/auth/* for requests that carry
// a cookie. This guard is the one for everything else (announcements, admin
// users, every later API) and it also covers the cookie-less auth POSTs
// (sign-in CSRF: logging a victim into the attacker's account).

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type OriginVerdict = { ok: true } | { ok: false; reason: "origin_mismatch" | "cross_site" | "no_origin_signal" };

/** Exact origins from a comma-separated variable. Anything that is not an http(s) origin is dropped. */
export function parseOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().replace(/\/+$/, "").toLowerCase())
    .filter((item) => /^https?:\/\/[^/\s]+$/.test(item));
}

function originOf(value: string | null): string | null {
  if (!value || value === "null") return null;
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

/** The decision, as a pure function of the headers (unit-tested without a worker). */
export function checkRequestOrigin(headers: Pick<Headers, "get" | "has">, ownOrigin: string, trusted: readonly string[]): OriginVerdict {
  const allowed = (origin: string | null) => origin !== null && (origin === ownOrigin.toLowerCase() || trusted.includes(origin));

  const origin = headers.get("origin");
  if (origin !== null) return allowed(originOf(origin)) ? { ok: true } : { ok: false, reason: "origin_mismatch" };

  const site = headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (site) return site === "same-origin" || site === "none" ? { ok: true } : { ok: false, reason: "cross_site" };

  const referer = headers.get("referer");
  if (referer) return allowed(originOf(referer)) ? { ok: true } : { ok: false, reason: "origin_mismatch" };

  return headers.has("cookie") ? { ok: false, reason: "no_origin_signal" } : { ok: true };
}

export const sameOriginGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();
  const verdict = checkRequestOrigin(c.req.raw.headers, new URL(c.req.url).origin, parseOrigins(c.env.TRUSTED_ORIGINS));
  if (!verdict.ok) {
    // Reason only: the headers are the attacker's to fill in.
    return c.json({ error: "forbidden", reason: verdict.reason }, 403);
  }
  return next();
};
