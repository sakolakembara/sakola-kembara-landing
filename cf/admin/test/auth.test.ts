import { env } from "cloudflare:workers";
import { createEmailVerificationToken } from "better-auth/api";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  call,
  CAPTCHA,
  cookiesOf,
  createVerifiedUser,
  emailsTo,
  fakeNetwork,
  linkIn,
  ORIGIN,
  PASSWORD,
  productionLike,
  resetTokenIn,
  signIn,
  signUp,
  uniqueEmail,
} from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

async function userRow(email: string) {
  return env.DB.prepare("SELECT id, email, email_verified AS emailVerified, role FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string; email: string; emailVerified: number; role: string }>();
}

async function auditActions(): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT action FROM audit_log ORDER BY created_at, rowid").all<{ action: string }>();
  return results.map((row) => row.action);
}

describe("registration and email verification", () => {
  test("registering does not log the user in and sends one verification email", async () => {
    const email = uniqueEmail();
    const res = await signUp(email);

    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toEqual([]); // no session before verification
    const sent = emailsTo(email);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ purpose: "verify-email", subject: "Verifikasi email Sakola Kembara" });
    expect(sent[0]!.html).toContain("/api/auth/verify-email?token=");
    expect((await userRow(email))?.emailVerified).toBe(0);
  });

  // Negative check: remove `requireEmailVerification: true` from src/auth/factory.ts
  // and this test fails (sign-in returns 200 with a session cookie).
  test("an unverified account cannot sign in, even with the right password", async () => {
    const email = uniqueEmail();
    await signUp(email);

    const res = await signIn(email);
    expect(res.status).toBe(403);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(await res.json()).toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
  });

  test("a correct password on an unverified account sends a fresh verification link", async () => {
    const email = uniqueEmail();
    await signUp(email);
    expect(emailsTo(email)).toHaveLength(1);

    await signIn(email);
    expect(emailsTo(email)).toHaveLength(2);
    expect(emailsTo(email)[1]!.subject).toBe("Verifikasi email Sakola Kembara");
  });

  test("following the emailed link verifies the email, then sign-in works", async () => {
    const email = uniqueEmail();
    await signUp(email);

    const verify = await call(linkIn(emailsTo(email)[0]!));
    expect(verify.status).toBe(302);
    expect(verify.headers.get("location")).toBe("/login?verified=1");
    expect((await userRow(email))?.emailVerified).toBe(1);

    const res = await signIn(email);
    expect(res.status).toBe(200);
    const cookie = cookiesOf(res);
    expect(cookie).toContain("better-auth.session_token=");

    const me = await call("/api/me", { cookie });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ user: { email, role: "student", emailVerified: true } });
  });

  test("registering and verifying are written to the audit log, with the person as the actor", async () => {
    const email = uniqueEmail();
    await signUp(email);
    await call(linkIn(emailsTo(email)[0]!));
    expect(await auditActions()).toEqual(["student.register", "user.email_verified"]);
    const row = await env.DB.prepare("SELECT actor_email, resource_type, metadata FROM audit_log WHERE action = 'student.register'").first<{
      actor_email: string;
      resource_type: string;
      metadata: string;
    }>();
    expect(row).toMatchObject({ actor_email: email, resource_type: "user" });
    expect(JSON.parse(row!.metadata)).toEqual({ via: "email" }); // never the password
  });

  test("a tampered verification token verifies nothing", async () => {
    const email = uniqueEmail();
    await signUp(email);
    const link = linkIn(emailsTo(email)[0]!);

    const res = await call(link.replace(/token=([^&]+)/, (_, t: string) => `token=${t.slice(0, -3)}abc`));
    // With a callbackURL the failure goes back to it, and the login page reads `error`.
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?verified=1&error=INVALID_TOKEN");
    expect((await userRow(email))?.emailVerified).toBe(0);
  });

  test("an expired verification token verifies nothing", async () => {
    const email = uniqueEmail();
    await signUp(email);
    const expired = await createEmailVerificationToken(env.BETTER_AUTH_SECRET!, email, undefined, -60);

    const res = await call(`/api/auth/verify-email?token=${expired}&callbackURL=${encodeURIComponent("/login?verified=1")}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?verified=1&error=TOKEN_EXPIRED");
    expect((await userRow(email))?.emailVerified).toBe(0);
    expect((await signIn(email)).status).toBe(403);
  });

  test("the link can be opened twice: the second time changes nothing and is not audited again", async () => {
    const email = uniqueEmail();
    await signUp(email);
    const link = linkIn(emailsTo(email)[0]!);

    expect((await call(link)).headers.get("location")).toBe("/login?verified=1");
    const second = await call(link);
    expect(second.status).toBe(302);
    expect(second.headers.get("location")).toBe("/login?verified=1");
    expect((await userRow(email))?.emailVerified).toBe(1);
    expect((await auditActions()).filter((action) => action === "user.email_verified")).toHaveLength(1);
  });

  test("the verification link sets no cookie: opening it signs nobody in", async () => {
    const email = uniqueEmail();
    await signUp(email);
    const res = await call(linkIn(emailsTo(email)[0]!));
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  test("a failed OAuth callback lands on the SPA error route, not Better Auth's page", async () => {
    const on = { GOOGLE_CLIENT_ID: "fake-client-id", GOOGLE_CLIENT_SECRET: "fake-client-secret" };
    // No state cookie, as when the user cancels or the cookie was lost.
    const res = await call("/api/auth/callback/google?code=abc&state=nope", { env: on });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^\/auth\/error\?error=/);

    // Better Auth's own error page is not served either (it is not in the route table).
    const page = await call("/api/auth/error?error=boom", { env: on });
    expect(page.status).toBe(404);
    expect(page.headers.get("content-type") ?? "").not.toContain("text/html");
  });

  test("the stored password is the PBKDF2 string, never the plain password", async () => {
    const email = uniqueEmail();
    const id = await createVerifiedUser(email);
    const account = await env.DB.prepare("SELECT password FROM account WHERE user_id = ? AND provider_id = 'credential'")
      .bind(id)
      .first<{ password: string }>();
    expect(account?.password).toMatch(/^pbkdf2-sha256\$100000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(account?.password).not.toContain(PASSWORD);
  });
});

describe("sign-in and the session cookie", () => {
  test("wrong password and unknown email give the same answer", async () => {
    const email = uniqueEmail();
    await createVerifiedUser(email);

    const wrong = await signIn(email, "not the password");
    const unknown = await signIn(uniqueEmail("nobody"));
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect(wrong.headers.getSetCookie()).toEqual([]);
  });

  test("development: a host-only, HttpOnly, SameSite=Lax cookie, not cacheable", async () => {
    const email = uniqueEmail();
    await createVerifiedUser(email);
    const res = await signIn(email);

    const [cookie] = res.headers.getSetCookie();
    expect(cookie).toContain("better-auth.session_token=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Secure"); // plain http locally
    expect(cookie).not.toContain("Domain=");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  // The default for production, decided in docs/cloudflare/auth.md#cookies.
  test("production with Turnstile configured: __Host-better-auth.session_token, Secure, Path=/, HttpOnly, SameSite=Lax, no Domain", async () => {
    const email = uniqueEmail();
    await createVerifiedUser(email);
    fakeNetwork();
    const res = await call("/api/auth/sign-in/email", { method: "POST", json: { email, password: PASSWORD }, env: productionLike, captcha: CAPTCHA });
    expect(res.status).toBe(200);
    const [cookie] = res.headers.getSetCookie();
    expect(cookie).toMatch(/^__Host-better-auth\.session_token=/);
    for (const attribute of ["Secure", "HttpOnly", "SameSite=Lax", "Path=/"]) expect(cookie).toContain(attribute);
    expect(cookie).not.toContain("Domain=");
    expect(cookie).toContain("Max-Age=604800"); // 7 days
  });

  test("production with COOKIE_DOMAIN set (opt-in): __Secure- prefix and the Domain attribute", async () => {
    const email = uniqueEmail();
    await createVerifiedUser(email);
    fakeNetwork();
    const res = await call("/api/auth/sign-in/email", {
      method: "POST",
      json: { email, password: PASSWORD },
      env: { ...productionLike, COOKIE_DOMAIN: ".example.test" },
      captcha: CAPTCHA,
    });
    expect(res.status).toBe(200);
    const [cookie] = res.headers.getSetCookie();
    expect(cookie).toContain("__Secure-better-auth.session_token=");
    expect(cookie).toContain("Domain=.example.test");
    expect(cookie).toContain("Secure");
  });

  test("a client cannot reach the session of another user with a forged cookie", async () => {
    const res = await call("/api/me", { cookie: "better-auth.session_token=forged.token" });
    expect(res.status).toBe(401);
  });

  test("sign-out ends the session", async () => {
    const email = uniqueEmail();
    await createVerifiedUser(email);
    const cookie = cookiesOf(await signIn(email));
    expect((await call("/api/me", { cookie })).status).toBe(200);

    const out = await call("/api/auth/sign-out", { method: "POST", cookie, json: {} });
    expect(out.status).toBe(200);
    expect((await call("/api/me", { cookie })).status).toBe(401);
  });

  test("an expired session is refused, and sign-in makes a new one", async () => {
    const email = uniqueEmail();
    const id = await createVerifiedUser(email);
    const cookie = cookiesOf(await signIn(email));
    await env.DB.prepare("UPDATE session SET expires_at = ? WHERE user_id = ?").bind(Date.now() - 1000, id).run();

    expect((await call("/api/me", { cookie })).status).toBe(401);
    expect((await signIn(email)).status).toBe(200);
  });
});

describe("password reset", () => {
  test("reset sets the new password, ends every session, and the link works once", async () => {
    const email = uniqueEmail();
    await createVerifiedUser(email);
    const oldCookie = cookiesOf(await signIn(email));
    expect((await call("/api/me", { cookie: oldCookie })).status).toBe(200);

    const request = await call("/api/auth/request-password-reset", { method: "POST", json: { email, redirectTo: "/reset-password" } });
    expect(request.status).toBe(200);
    const sent = emailsTo(email).filter((message) => message.purpose === "reset-password");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ subject: "Reset password akun Sakola Kembara" });

    // The emailed link redirects to the SPA with the token.
    const landing = await call(linkIn(sent[0]!));
    expect(landing.status).toBe(302);
    const token = new URL(landing.headers.get("location")!, ORIGIN).searchParams.get("token");
    expect(token).toBeTruthy();

    const newPassword = "a brand new passphrase 42";
    const reset = await call("/api/auth/reset-password", { method: "POST", json: { token, newPassword } });
    expect(reset.status).toBe(200);

    // revokeSessionsOnPasswordReset: the cookie from before the reset is dead.
    expect((await call("/api/me", { cookie: oldCookie })).status).toBe(401);
    expect((await signIn(email, PASSWORD)).status).toBe(401);
    expect((await signIn(email, newPassword)).status).toBe(200);

    // Single use.
    const again = await call("/api/auth/reset-password", { method: "POST", json: { token, newPassword: "yet another one 99" } });
    expect(again.status).toBe(400);
    expect((await signIn(email, "yet another one 99")).status).toBe(401);
  });

  // Negative check: set `revokeSessionsOnPasswordReset: false` in src/auth/factory.ts.
  test("a reset ends the sessions of every device, not only the one that asked", async () => {
    const email = uniqueEmail();
    await createVerifiedUser(email);
    const phone = cookiesOf(await signIn(email));
    const laptop = cookiesOf(await signIn(email));
    await call("/api/auth/request-password-reset", { method: "POST", json: { email, redirectTo: "/reset-password" } });
    const token = resetTokenIn(emailsTo(email).find((message) => message.purpose === "reset-password")!);

    expect((await call("/api/auth/reset-password", { method: "POST", json: { token, newPassword: "a brand new passphrase 42" } })).status).toBe(200);
    expect((await call("/api/me", { cookie: phone })).status).toBe(401);
    expect((await call("/api/me", { cookie: laptop })).status).toBe(401);
  });

  test("an expired reset link does nothing, and the token cannot be redeemed", async () => {
    const email = uniqueEmail();
    await createVerifiedUser(email);
    await call("/api/auth/request-password-reset", { method: "POST", json: { email, redirectTo: "/reset-password" } });
    const link = linkIn(emailsTo(email).find((message) => message.purpose === "reset-password")!);
    const token = resetTokenIn(emailsTo(email).find((message) => message.purpose === "reset-password")!);

    // 30 minutes pass.
    await env.DB.prepare("UPDATE verification SET expires_at = ?").bind(Date.now() - 1000).run();

    const landing = await call(link);
    expect(landing.status).toBe(302);
    expect(landing.headers.get("location")).toBe(`${ORIGIN}/reset-password?error=INVALID_TOKEN`);
    const reset = await call("/api/auth/reset-password", { method: "POST", json: { token, newPassword: "a brand new passphrase 42" } });
    expect(reset.status).toBe(400);
    expect((await signIn(email, PASSWORD)).status).toBe(200); // the old password still works
  });

  test("the reset link lives 30 minutes", async () => {
    const email = uniqueEmail();
    await createVerifiedUser(email);
    await call("/api/auth/request-password-reset", { method: "POST", json: { email, redirectTo: "/reset-password" } });
    const row = await env.DB.prepare("SELECT expires_at AS expiresAt FROM verification").first<{ expiresAt: number }>();
    const minutes = (row!.expiresAt - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(29);
    expect(minutes).toBeLessThanOrEqual(30);
  });

  test("a new password shorter than 8 characters is refused and the token is not used up", async () => {
    const email = uniqueEmail();
    await createVerifiedUser(email);
    await call("/api/auth/request-password-reset", { method: "POST", json: { email, redirectTo: "/reset-password" } });
    const token = resetTokenIn(emailsTo(email).find((message) => message.purpose === "reset-password")!);

    const weak = await call("/api/auth/reset-password", { method: "POST", json: { token, newPassword: "short" } });
    expect(weak.status).toBe(400);
    expect((await call("/api/auth/reset-password", { method: "POST", json: { token, newPassword: "long enough now" } })).status).toBe(200);
  });

  test("redeeming a reset link proves the mailbox: it verifies the address and writes the audit row", async () => {
    const email = uniqueEmail();
    await signUp(email, "password chosen by someone else"); // never verified
    await call("/api/auth/request-password-reset", { method: "POST", json: { email, redirectTo: "/reset-password" } });
    const token = resetTokenIn(emailsTo(email).find((message) => message.purpose === "reset-password")!);
    expect((await signIn(email, "password chosen by someone else")).status).toBe(403);

    expect((await call("/api/auth/reset-password", { method: "POST", json: { token, newPassword: "the owner's own password" } })).status).toBe(200);
    expect((await userRow(email))?.emailVerified).toBe(1);
    // The squatter's password is gone; the owner's works.
    expect((await signIn(email, "password chosen by someone else")).status).toBe(401);
    expect((await signIn(email, "the owner's own password")).status).toBe(200);
    expect(await auditActions()).toContain("user.password_reset");
  });

  test("the reset token is stored hashed", async () => {
    const email = uniqueEmail();
    await createVerifiedUser(email);
    await call("/api/auth/request-password-reset", { method: "POST", json: { email, redirectTo: "/reset-password" } });
    const token = resetTokenIn(emailsTo(email).find((message) => message.purpose === "reset-password")!);

    const rows = await env.DB.prepare("SELECT identifier FROM verification").all<{ identifier: string }>();
    expect(rows.results.length).toBeGreaterThan(0);
    for (const row of rows.results) expect(row.identifier).not.toContain(token);
  });

  test("an unknown email gets the same answer and no email", async () => {
    const known = uniqueEmail();
    await createVerifiedUser(known);
    const ghost = uniqueEmail("ghost");

    const a = await call("/api/auth/request-password-reset", { method: "POST", json: { email: known, redirectTo: "/reset-password" } });
    const b = await call("/api/auth/request-password-reset", { method: "POST", json: { email: ghost, redirectTo: "/reset-password" } });
    expect(a.status).toBe(b.status);
    expect(await a.json()).toEqual(await b.json());
    expect(emailsTo(known).filter((message) => message.purpose === "reset-password")).toHaveLength(1);
    expect(emailsTo(ghost)).toHaveLength(0);
  });

  test("a redirect target on another site is refused", async () => {
    const email = uniqueEmail();
    await createVerifiedUser(email);
    const res = await call("/api/auth/request-password-reset", { method: "POST", json: { email, redirectTo: "https://evil.example/steal" } });
    expect(res.status).toBe(403);
    expect(emailsTo(email).filter((message) => message.purpose === "reset-password")).toHaveLength(0);
  });
});

describe("Google sign-in availability", () => {
  test("is reported off, and the route does not exist, until both variables are set", async () => {
    expect(await (await call("/api/config")).json()).toEqual({ google: false, turnstileSiteKey: null });
    const start = await call("/api/auth/sign-in/social", { method: "POST", json: { provider: "google" } });
    expect(start.status).toBeGreaterThanOrEqual(400);

    const on = { GOOGLE_CLIENT_ID: "fake-client-id", GOOGLE_CLIENT_SECRET: "fake-client-secret" };
    expect(await (await call("/api/config", { env: on })).json()).toEqual({ google: true, turnstileSiteKey: null });
    const redirect = await call("/api/auth/sign-in/social", { method: "POST", json: { provider: "google", callbackURL: "/announcements" }, env: on });
    expect(redirect.status).toBe(200);
    const body = (await redirect.json()) as { url?: string };
    expect(body.url).toContain("https://accounts.google.com/");
    // Shared devices: always let the person choose the Google account (as the legacy app did).
    expect(new URL(body.url!).searchParams.get("prompt")).toBe("select_account");
    // The OAuth state cookie must survive the wrapper, or the callback fails with state_mismatch.
    expect(redirect.headers.getSetCookie().length).toBeGreaterThan(0);
  });

  test("/api/config serves the public Turnstile site key and nothing secret", async () => {
    const res = await call("/api/config", { env: { TURNSTILE_SITE_KEY: "1x00000000000000000000AA", TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA" } });
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ google: false, turnstileSiteKey: "1x00000000000000000000AA" });
    expect(text).not.toContain("0000000000000000000000000000000AA");
  });
});
