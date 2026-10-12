import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { vi } from "vitest";
import type { GrantableArea } from "../src/auth/permissions";
import type { UserRole } from "../src/auth/roles";
import { mailbox, type RecordedEmail } from "../src/email/send";
import type { Bindings } from "../src/env";
import { SITEVERIFY_URL, TURNSTILE_TEST_SECRETS } from "../src/security/turnstile";
import worker from "../src/worker";

export const ORIGIN = "https://admin.test";
export const PASSWORD = "correct horse battery staple";

let counter = 0;
/** A fresh fake client address, so the per-IP rate limit never couples two tests. */
export function freshIp(): string {
  counter += 1;
  return `203.0.113.${(counter % 250) + 1}`;
}

/**
 * The rate limit bindings count in windows that line up with the clock, so a
 * test that makes several slow calls (Better Auth's resend route takes half a
 * second by design) and counts exactly would fail now and then if the minute
 * turned in the middle. Waits out the last `needMs` of a minute instead.
 */
export async function awaitFreshWindow(needMs = 6000) {
  const into = Date.now() % 60_000;
  if (into > 60_000 - needMs) await new Promise((resolve) => setTimeout(resolve, 60_000 - into + 50));
}

export function uniqueEmail(label = "user"): string {
  counter += 1;
  return `${label}-${counter}-${crypto.randomUUID().slice(0, 8)}@example.test`;
}

interface CallInit extends RequestInit {
  /** Replaces bindings for this call only, e.g. { ENVIRONMENT: "production" }. */
  env?: Partial<Bindings>;
  /** The client address (CF-Connecting-IP). `null` sends none, like a local run without the edge. */
  ip?: string | null;
  cookie?: string;
  /** What a browser puts in Origin on a same-origin POST by default; `null` sends no Origin header at all. */
  origin?: string | null;
  json?: unknown;
  /** Sent as X-Turnstile-Token. */
  captcha?: string;
  /** Another handler instead of the worker: a test mounts routes of its own (test/crud-app.ts). */
  via?: { fetch: (request: Request, env: Bindings, ctx: ExecutionContext) => Response | Promise<Response> };
}

/** Calls the worker like the Workers runtime does, and waits for `waitUntil` work. */
export async function call(path: string, init: CallInit = {}): Promise<Response> {
  const { env: overrides, ip, cookie, json, captcha, origin, via, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (ip !== null) headers.set("cf-connecting-ip", ip ?? freshIp());
  if (cookie) headers.set("cookie", cookie);
  if (captcha) headers.set("x-turnstile-token", captcha);
  let body = rest.body;
  if (json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(json);
  }
  // `origin` is what a browser sends on a same-origin POST.
  if (origin) headers.set("origin", origin);
  else if (origin === undefined && rest.method && rest.method !== "GET" && !headers.has("origin")) headers.set("origin", ORIGIN);

  const ctx = createExecutionContext();
  const bindings = { ...env, ...overrides } as Bindings;
  const response = await (via ?? worker).fetch!(new Request(`${ORIGIN}${path}`, { ...rest, headers, body, redirect: "manual" }), bindings, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

/** Name=value pairs of every Set-Cookie, ready for a Cookie header. */
export function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

// ─── Email: the in-memory mailbox, and the Resend path when a key is set ───

/** Everything "sent" so far (no Resend key, not production). Emptied before each test by test/setup.ts. */
export function emails(): RecordedEmail[] {
  return mailbox.messages;
}

export function emailsTo(address: string): RecordedEmail[] {
  return mailbox.messages.filter((message) => message.to === address);
}

/** First link in an email text that points at this app, as a path. */
export function linkIn(email: Pick<RecordedEmail, "text">): string {
  const match = email.text.match(/https:\/\/admin\.test\/\S+/);
  if (!match) throw new Error("no link in email");
  return match[0].replace(ORIGIN, "");
}

/** The token of a reset or invite link (`/api/auth/reset-password/<token>?callbackURL=...`). */
export function resetTokenIn(email: Pick<RecordedEmail, "text">): string {
  const match = linkIn(email).match(/reset-password\/([^?]+)/);
  if (!match) throw new Error("no reset token in email");
  return match[1]!;
}

export interface FakeNetwork {
  /** What reached Resend, parsed. */
  resend: { to: string; subject: string; text: string; html: string; from: string }[];
  resendRequests: { headers: Headers }[];
  /** What reached Siteverify. */
  siteverify: { secret: string | null; response: string | null; remoteip: string | null }[];
  /** Status the fake Resend answers with. 200 until changed. */
  resendStatus: number;
  resendHeaders: Record<string, string>;
  resendBody: string;
}

/**
 * Replaces fetch. Resend and Siteverify are faked (Siteverify behaves like
 * Cloudflare's published test secrets); any other outbound request fails the
 * test, because this worker calls nothing else (Google is faked in its own test).
 */
export function fakeNetwork(): FakeNetwork {
  const state: FakeNetwork = { resend: [], resendRequests: [], siteverify: [], resendStatus: 200, resendHeaders: {}, resendBody: JSON.stringify({ id: "fake-id" }) };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://api.resend.com/emails") {
      state.resend.push(JSON.parse(String(init?.body)));
      state.resendRequests.push({ headers: new Headers(init?.headers) });
      return new Response(state.resendBody, { status: state.resendStatus, headers: state.resendHeaders });
    }
    if (url === SITEVERIFY_URL) {
      const form = new URLSearchParams(String(init?.body));
      const secret = form.get("secret");
      state.siteverify.push({ secret, response: form.get("response"), remoteip: form.get("remoteip") });
      if (secret === TURNSTILE_TEST_SECRETS.alwaysPass) {
        return Response.json({ success: Boolean(form.get("response")), "error-codes": form.get("response") ? [] : ["missing-input-response"] });
      }
      if (secret === TURNSTILE_TEST_SECRETS.spent) return Response.json({ success: false, "error-codes": ["timeout-or-duplicate"] });
      return Response.json({ success: false, "error-codes": ["invalid-input-response"] });
    }
    throw new Error(`unexpected outbound request: ${url}`);
  });
  return state;
}

/** Local env that has a (fake) Resend key, so email goes through fetch. */
export const withEmail: Partial<Bindings> = {
  RESEND_API_KEY: "re_fake_key_for_tests",
  EMAIL_FROM: "Sakola Kembara <no-reply@example.test>",
};

/** Production behaviour with a working provider and Turnstile, for the tests of the gate. */
export const productionLike: Partial<Bindings> = {
  ...withEmail,
  ENVIRONMENT: "production",
  TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRETS.alwaysPass,
};

/** A token the fake Siteverify accepts for `TURNSTILE_TEST_SECRETS.alwaysPass`. */
export const CAPTCHA = "XXXX.DUMMY.TOKEN.XXXX";

// ─── Accounts ──────────────────────────────────────────────────────────────

/** The student registration endpoint. */
export async function register(email: string, init: { password?: string; name?: string; ip?: string | null; env?: Partial<Bindings>; captcha?: string; extra?: Record<string, unknown> } = {}) {
  return call("/api/auth/register", {
    method: "POST",
    ip: init.ip,
    env: init.env,
    captcha: init.captcha,
    json: { email, password: init.password ?? PASSWORD, name: init.name ?? "Tester", callbackURL: "/login?verified=1", ...init.extra },
  });
}

export async function signUp(email: string, password = PASSWORD, name = "Tester") {
  return register(email, { password, name });
}

/**
 * Register, follow the emailed verification link, and return the user id.
 * `areas` are inserted into admin_area_grants (for editors; for any other role
 * they are the stray rows the permission model must ignore).
 */
export async function createVerifiedUser(email: string, role?: UserRole, areas: readonly GrantableArea[] = []) {
  const res = await signUp(email);
  if (res.status !== 200) throw new Error(`register failed: ${res.status}`);
  const verification = emailsTo(email).find((message) => message.purpose === "verify-email");
  if (!verification) throw new Error("no verification email was sent");
  await call(linkIn(verification));
  // Registering and verifying write audit rows of their own (student.register,
  // user.email_verified; tested in test/register.test.ts). As test fixtures they
  // would only add noise to the tests that count the audit rows of the API under
  // test, so the fixture removes them.
  await env.DB.prepare("DELETE FROM audit_log WHERE action IN ('student.register', 'user.email_verified')").run();
  if (role) await env.DB.prepare("UPDATE users SET role = ? WHERE email = ?").bind(role, email).run();
  const row = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
  for (const area of areas) await grantArea(row!.id, area);
  return row!.id;
}

/** Straight into the table, bypassing the API (tests of the API itself use the API). */
export async function grantArea(userId: string, area: GrantableArea) {
  await env.DB.prepare("INSERT INTO admin_area_grants (user_id, area) VALUES (?, ?)").bind(userId, area).run();
}

export async function revokeArea(userId: string, area: GrantableArea) {
  await env.DB.prepare("DELETE FROM admin_area_grants WHERE user_id = ? AND area = ?").bind(userId, area).run();
}

/**
 * Changes a role straight in the table. The database refuses to leave the
 * system without an active super_admin (migration 0006), so demoting the only
 * one first creates a stand-in, as a real deployment would have a second one.
 */
export async function setRole(email: string, role: UserRole) {
  const current = await env.DB.prepare("SELECT id, role FROM users WHERE email = ?").bind(email).first<{ id: string; role: string }>();
  if (current?.role === "super_admin" && role !== "super_admin") await ensureAnotherSuperAdmin(current.id);
  await env.DB.prepare("UPDATE users SET role = ? WHERE email = ?").bind(role, email).run();
}

/** A second active super_admin, so the first can be demoted or deactivated in a test. */
export async function ensureAnotherSuperAdmin(exceptId: string) {
  const other = await env.DB.prepare("SELECT 1 AS found FROM users WHERE role = 'super_admin' AND deactivated_at IS NULL AND id <> ?").bind(exceptId).first();
  if (other) return;
  await env.DB.prepare("INSERT INTO users (id, name, email, email_verified, role) VALUES (?, 'Stand-in', ?, 1, 'super_admin')")
    .bind(crypto.randomUUID(), uniqueEmail("standin"))
    .run();
}

export async function signIn(email: string, password = PASSWORD, ip?: string) {
  return call("/api/auth/sign-in/email", { method: "POST", json: { email, password }, ip });
}

/** Verified user, signed in. Returns the Cookie header to use on later calls. */
export async function signedInCookie(email: string, role?: UserRole, areas: readonly GrantableArea[] = []) {
  await createVerifiedUser(email, role, areas);
  const res = await signIn(email);
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.status}`);
  return cookiesOf(res);
}

// ─── Google, with a faked token endpoint ──────────────────────────────────

export const google = { GOOGLE_CLIENT_ID: "fake-client-id", GOOGLE_CLIENT_SECRET: "fake-client-secret" };

function b64url(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Runs the whole Google flow with a faked Google token endpoint. Returns the callback response. */
export async function signInWithGoogle(profile: { email: string; email_verified: boolean; sub?: string; name?: string }) {
  const start = await call("/api/auth/sign-in/social", {
    method: "POST",
    json: { provider: "google", callbackURL: "/announcements" },
    env: google,
  });
  if (start.status !== 200) throw new Error(`Google sign-in did not start: ${start.status}`);
  const { url } = (await start.json()) as { url: string };
  const state = new URL(url).searchParams.get("state")!;

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

  return call(`/api/auth/callback/google?code=fake-code&state=${state}`, { env: google, cookie: cookiesOf(start) });
}
