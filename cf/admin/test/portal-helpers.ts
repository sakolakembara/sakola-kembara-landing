import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { vi } from "vitest";
import { STUDENT_AUDIENCE } from "../src/auth/audience";
import type { UserRole } from "../src/auth/roles";
import type { AppEnv } from "../src/context";
import { mailbox, type RecordedEmail } from "../src/email/send";
import type { Bindings } from "../src/env";
import { studentAuthContext } from "../src/portal/auth-context";
import { apiHeaders } from "../src/portal/headers";
import portalWorker from "../src/portal/worker";
import { sameOriginGuard } from "../src/security/csrf";
import { emailsTo, freshIp, google, PASSWORD, uniqueEmail } from "./helpers";
import { limiterBindings } from "./limiter-clock";

// The portal Worker in the tests (SAKEM-083). Same idea as test/helpers.ts, for `sakem-portal`: the Worker module is
// called directly with the test's bindings, on the APEX origin, with a BETTER_AUTH_SECRET of its own. The admin's
// tests keep using `call()` and the admin's secret, so a test that carries a cookie from one Worker to the other
// meets exactly what production has: two cookie names and two secrets.

/** The apex, where the portal lives (`<apex>/portal/...`). The admin's tests use https://admin.test. */
export const PORTAL_ORIGIN = "https://sakola.test";
/** A different value from the admin's test secret (vitest.config.ts): a token of one audience is not valid for the other. */
export const PORTAL_SECRET = "portal-test-only-secret-9876543210-zyxwvutsrqpo";

type Handler = { fetch: (request: Request, env: Bindings, ctx: ExecutionContext) => Response | Promise<Response> };

interface PortalCallInit extends RequestInit {
  /** Bindings for this call only, over the test's defaults (the portal's secret, the limiter doubles). `RL_X: undefined` leaves one out. */
  env?: Partial<Bindings>;
  /** The client address (CF-Connecting-IP). `null` sends none. */
  ip?: string | null;
  cookie?: string;
  /** What a browser puts in Origin on a same-origin write by default; `null` sends no Origin header at all. */
  origin?: string | null;
  json?: unknown;
  /** Sent as X-Turnstile-Token. */
  captcha?: string;
  /** The host to call (default: the apex). */
  host?: string;
  /** Another handler instead of the portal Worker (a test mounts routes of its own: `portalAppAround`). */
  via?: Handler;
}

/** Calls the portal Worker like the Workers runtime does, and waits for `waitUntil` work. */
export async function portalCall(path: string, init: PortalCallInit = {}): Promise<Response> {
  const { env: overrides, ip, cookie, json, captcha, origin, via, host, ...rest } = init;
  const base = host ?? PORTAL_ORIGIN;
  const headers = new Headers(rest.headers);
  if (ip !== null) headers.set("cf-connecting-ip", ip ?? freshIp());
  if (cookie) headers.set("cookie", cookie);
  if (captcha) headers.set("x-turnstile-token", captcha);
  let body = rest.body;
  if (json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(json);
  }
  if (origin) headers.set("origin", origin);
  else if (origin === undefined && rest.method && rest.method !== "GET" && !headers.has("origin")) headers.set("origin", base);

  const ctx = createExecutionContext();
  const bindings = { ...env, BETTER_AUTH_SECRET: PORTAL_SECRET, ...limiterBindings(), ...overrides } as Bindings;
  const response = await (via ?? portalWorker).fetch!(new Request(`${base}${path}`, { ...rest, headers, body, redirect: "manual" }), bindings, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

/**
 * The portal's chain (the same-origin guard, the student audience's session) around routes of a test's own, because
 * the skeleton mounts none yet: `portalCall(path, { via: portalAppAround({ "/portal/api": routes }) })`.
 */
export function portalAppAround(mounts: Record<string, Hono<AppEnv>>): Handler {
  const app = new Hono<AppEnv>();
  app.use("/portal/api/*", apiHeaders);
  app.use("/portal/api/*", sameOriginGuard);
  app.use("/portal/api/*", studentAuthContext);
  for (const [path, routes] of Object.entries(mounts)) app.route(path, routes);
  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((error, c) => {
    console.error(`[portal] unhandled error: ${error.message}`);
    return c.json({ error: "internal" }, 500);
  });
  return { fetch: (request, bindings, ctx) => Promise.resolve(app.fetch(request, bindings, ctx)) };
}

// ─── Accounts, through the portal's own auth routes ────────────────────

export const REGISTER_PATH = "/portal/api/auth/register";
export const SIGN_IN_PATH = "/portal/api/auth/sign-in/email";
/** Where a registration sends the browser once the address is verified. */
export const VERIFIED_CALLBACK = "/portal/login?verified=1";

export async function portalRegister(email: string, init: { password?: string; name?: string; ip?: string | null; env?: Partial<Bindings>; captcha?: string; extra?: Record<string, unknown> } = {}) {
  return portalCall(REGISTER_PATH, {
    method: "POST",
    ip: init.ip,
    env: init.env,
    captcha: init.captcha,
    json: { email, password: init.password ?? PASSWORD, name: init.name ?? "Tester", callbackURL: VERIFIED_CALLBACK, ...init.extra },
  });
}

export async function portalSignIn(email: string, password = PASSWORD, init: { ip?: string; env?: Partial<Bindings>; captcha?: string } = {}) {
  return portalCall(SIGN_IN_PATH, { method: "POST", json: { email, password }, ...init });
}

/** First link in an email text that points at the portal, as a path with its query. */
export function portalLinkIn(email: Pick<RecordedEmail, "text">): string {
  const match = email.text.match(/https:\/\/sakola\.test\/\S+/);
  if (!match) throw new Error("no link in email");
  return match[0].replace(PORTAL_ORIGIN, "");
}

/** The token of a reset link (`/portal/api/auth/reset-password/<token>?callbackURL=...`). */
export function portalResetTokenIn(email: Pick<RecordedEmail, "text">): string {
  const match = portalLinkIn(email).match(/reset-password\/([^?]+)/);
  if (!match) throw new Error("no reset token in email");
  return match[1]!;
}

/**
 * Register, follow the emailed verification link, and return the user id. `role` changes the account's role afterwards,
 * straight in the table: how a test makes "an admin account on the portal" (the portal has no way to make one).
 */
export async function createVerifiedStudent(email: string, role?: UserRole): Promise<string> {
  const res = await portalRegister(email);
  if (res.status !== 200) throw new Error(`register failed: ${res.status}`);
  const verification = emailsTo(email).find((message) => message.purpose === "verify-email");
  if (!verification) throw new Error("no verification email was sent");
  const followed = await portalCall(portalLinkIn(verification));
  if (followed.status !== 302) throw new Error(`verification link answered ${followed.status}`);
  // Registering and verifying write audit rows of their own; as fixtures they would only add noise to a test that counts rows.
  await env.DB.prepare("DELETE FROM audit_log WHERE action IN ('student.register', 'user.email_verified')").run();
  if (role) await env.DB.prepare("UPDATE users SET role = ? WHERE email = ?").bind(role, email).run();
  const row = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
  return row!.id;
}

/** The name=value pairs of every Set-Cookie, ready for a Cookie header. */
export function cookieHeaderOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/** A verified account, signed in on the portal. Returns the Cookie header for later calls. */
export async function portalSignedIn(email: string = uniqueEmail("siswa"), role?: UserRole): Promise<string> {
  await createVerifiedStudent(email, role);
  const res = await portalSignIn(email);
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.status}`);
  return cookieHeaderOf(res);
}

/** The names of the cookies a response sets. */
export function cookieNames(response: Response): string[] {
  return response.headers.getSetCookie().map((cookie) => cookie.split("=")[0]!);
}

export { mailbox };

// ─── Google, with a faked token endpoint ───────────────────────────────

function b64url(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Starts the flow on `host` and returns the `url` the browser would be sent to, and the state cookie it must bring back. */
export async function portalGoogleStart(host = PORTAL_ORIGIN) {
  const start = await portalCall("/portal/api/auth/sign-in/social", {
    method: "POST",
    host,
    json: { provider: "google", callbackURL: "/portal/" },
    env: google,
  });
  if (start.status !== 200) throw new Error(`Google sign-in did not start: ${start.status}`);
  const { url } = (await start.json()) as { url: string };
  return { start, url: new URL(url), cookie: cookieHeaderOf(start) };
}

/** Runs the whole Google flow on the portal with a faked Google token endpoint. Returns the callback response. */
export async function portalSignInWithGoogle(profile: { email: string; email_verified: boolean; sub?: string; name?: string }) {
  const { url, cookie } = await portalGoogleStart();
  const state = url.searchParams.get("state")!;
  const idToken = `${b64url({ alg: "none", typ: "JWT" })}.${b64url({
    iss: "https://accounts.google.com",
    aud: google.GOOGLE_CLIENT_ID,
    sub: profile.sub ?? "google-sub-1",
    name: profile.name ?? "Google User",
    ...profile,
  })}.sig`;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (target.startsWith("https://oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "fake-access", id_token: idToken, expires_in: 3600, token_type: "Bearer" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected outbound request: ${target}`);
  });
  return portalCall(`/portal/api/auth/callback/google?code=fake-code&state=${state}`, { env: google, cookie });
}
