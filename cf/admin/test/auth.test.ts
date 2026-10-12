import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  call,
  captureEmails,
  cookiesOf,
  createVerifiedUser,
  linkIn,
  ORIGIN,
  PASSWORD,
  signIn,
  signUp,
  uniqueEmail,
  withEmail,
} from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

async function userRow(email: string) {
  return env.DB.prepare("SELECT id, email, email_verified AS emailVerified, role FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string; email: string; emailVerified: number; role: string }>();
}

describe("sign-up and email verification", () => {
  test("sign-up does not log the user in and sends one verification email through Resend", async () => {
    const { sent } = captureEmails();
    const email = uniqueEmail();
    const res = await signUp(email);

    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toEqual([]); // no session before verification
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: email, subject: "Verifikasi email Sakola Kembara" });
    expect(sent[0]!.html).toContain("/api/auth/verify-email?token=");
    expect((await userRow(email))?.emailVerified).toBe(0);
  });

  // Negative test: remove `requireEmailVerification: true` from src/auth/factory.ts
  // and this test fails (sign-in returns 200 with a session cookie).
  test("an unverified account cannot sign in, even with the right password", async () => {
    captureEmails();
    const email = uniqueEmail();
    await signUp(email);

    const res = await signIn(email);
    expect(res.status).toBe(403);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(await res.json()).toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
  });

  test("a correct password on an unverified account sends a fresh verification link", async () => {
    const { sent } = captureEmails();
    const email = uniqueEmail();
    await signUp(email);
    expect(sent).toHaveLength(1);

    await call("/api/auth/sign-in/email", { method: "POST", json: { email, password: PASSWORD }, env: withEmail });
    expect(sent).toHaveLength(2);
    expect(sent[1]!.subject).toBe("Verifikasi email Sakola Kembara");
  });

  test("following the emailed link verifies the email, then sign-in works", async () => {
    const { sent } = captureEmails();
    const email = uniqueEmail();
    await signUp(email);

    const verify = await call(linkIn(sent[0]!), { env: withEmail });
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

  test("a tampered verification token verifies nothing", async () => {
    const { sent } = captureEmails();
    const email = uniqueEmail();
    await signUp(email);
    const link = linkIn(sent[0]!);

    const res = await call(link.replace(/token=([^&]+)/, (_, t: string) => `token=${t.slice(0, -3)}abc`), { env: withEmail });
    // With a callbackURL the failure goes back to it, and the login page reads `error`.
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?verified=1&error=INVALID_TOKEN");
    expect((await userRow(email))?.emailVerified).toBe(0);
  });

  test("a failed OAuth callback lands on the SPA error route, not Better Auth's page", async () => {
    const on = { GOOGLE_CLIENT_ID: "fake-client-id", GOOGLE_CLIENT_SECRET: "fake-client-secret" };
    // No state cookie, as when the user cancels or the cookie was lost.
    const res = await call("/api/auth/callback/google?code=abc&state=nope", { env: on });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^\/auth\/error\?error=/);

    // Better Auth's own error page is not served either.
    const page = await call("/api/auth/error?error=boom", { env: on });
    expect(page.headers.get("content-type") ?? "").not.toContain("text/html");
  });

  test("a client cannot choose its own role at sign-up", async () => {
    captureEmails();
    const email = uniqueEmail();
    const res = await call("/api/auth/sign-up/email", {
      method: "POST",
      json: { email, password: PASSWORD, name: "Sneaky", role: "super_admin" },
      env: withEmail,
    });
    // Either refused or ignored; never stored.
    expect((await userRow(email))?.role ?? "student").toBe("student");
    expect([200, 400, 422]).toContain(res.status);
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

describe("sign-in", () => {
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

  test("the session cookie is forwarded intact and responses are not cacheable", async () => {
    const email = uniqueEmail();
    await createVerifiedUser(email);
    const res = await signIn(email);

    const [cookie] = res.headers.getSetCookie();
    expect(cookie).toContain("better-auth.session_token=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Secure"); // plain http locally, see the production test below
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("production cookies are Secure and scoped to the configured parent domain", async () => {
    const email = uniqueEmail();
    await createVerifiedUser(email);
    const res = await call("/api/auth/sign-in/email", {
      method: "POST",
      json: { email, password: PASSWORD },
      env: { ENVIRONMENT: "production", COOKIE_DOMAIN: ".example.test" },
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
});

describe("password reset", () => {
  test("reset sets the new password, ends every session, and the link works once", async () => {
    const email = uniqueEmail();
    await createVerifiedUser(email);
    const oldCookie = cookiesOf(await signIn(email));
    expect((await call("/api/me", { cookie: oldCookie })).status).toBe(200);

    const { sent } = captureEmails();
    const request = await call("/api/auth/request-password-reset", {
      method: "POST",
      json: { email, redirectTo: "/reset-password" },
      env: withEmail,
    });
    expect(request.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: email, subject: "Reset password akun Sakola Kembara" });

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
  });

  test("the reset token is stored hashed", async () => {
    const email = uniqueEmail();
    await createVerifiedUser(email);
    const { sent } = captureEmails();
    await call("/api/auth/request-password-reset", { method: "POST", json: { email, redirectTo: "/reset-password" }, env: withEmail });
    const token = linkIn(sent[0]!).match(/reset-password\/([^?]+)/)![1]!;

    const rows = await env.DB.prepare("SELECT identifier FROM verification").all<{ identifier: string }>();
    expect(rows.results.length).toBeGreaterThan(0);
    for (const row of rows.results) expect(row.identifier).not.toContain(token);
  });

  test("an unknown email gets the same answer and no email", async () => {
    const { sent } = captureEmails();
    const known = uniqueEmail();
    await createVerifiedUser(known);
    sent.length = 0;

    const a = await call("/api/auth/request-password-reset", { method: "POST", json: { email: known, redirectTo: "/reset-password" }, env: withEmail });
    const b = await call("/api/auth/request-password-reset", { method: "POST", json: { email: uniqueEmail("ghost"), redirectTo: "/reset-password" }, env: withEmail });
    expect(a.status).toBe(b.status);
    expect(await a.json()).toEqual(await b.json());
    expect(sent).toHaveLength(1);
  });

  test("a redirect target on another site is refused", async () => {
    const email = uniqueEmail();
    await createVerifiedUser(email);
    const { sent } = captureEmails();
    const res = await call("/api/auth/request-password-reset", {
      method: "POST",
      json: { email, redirectTo: "https://evil.example/steal" },
      env: withEmail,
    });
    expect(res.status).toBe(403);
    expect(sent).toHaveLength(0);
  });
});

describe("email fails closed in production", () => {
  function consoleOutput() {
    const lines: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      });
    }
    return lines;
  }

  test("sign-up without a Resend key sends nothing and logs no link, token or address", async () => {
    const lines = consoleOutput();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const email = uniqueEmail("prod");

    const res = await call("/api/auth/sign-up/email", {
      method: "POST",
      json: { email, password: PASSWORD, name: "Prod" },
      env: { ENVIRONMENT: "production", RESEND_API_KEY: undefined, EMAIL_FROM: undefined },
    });

    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled(); // nothing went to Resend (or anywhere)
    const all = lines.join("\n");
    expect(all).toContain("provider not configured; verify-email email was not sent");
    expect(all).not.toContain(email);
    expect(all).not.toContain("token=");
    expect(all).not.toContain("/api/auth/");
    expect(all).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/); // no JWT-looking string
    // And the account cannot be used: it is unverified, so sign-in is refused.
    expect((await userRow(email))?.emailVerified).toBe(0);
  });

  test("password reset without a Resend key sends nothing and logs no link", async () => {
    const email = uniqueEmail("prod-reset");
    await createVerifiedUser(email);
    const lines = consoleOutput();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const res = await call("/api/auth/request-password-reset", {
      method: "POST",
      json: { email, redirectTo: "/reset-password" },
      env: { ENVIRONMENT: "production", RESEND_API_KEY: undefined, EMAIL_FROM: undefined },
    });

    expect(res.status).toBe(200); // same answer as with a working provider
    expect(fetchSpy).not.toHaveBeenCalled();
    const all = lines.join("\n");
    expect(all).toContain("reset-password email was not sent");
    expect(all).not.toContain(email);
    expect(all).not.toContain("/reset-password/");
    expect(all).not.toContain("callbackURL");
  });

  test("a missing ENVIRONMENT counts as production", async () => {
    const lines = consoleOutput();
    const email = uniqueEmail("noenv");
    await call("/api/auth/sign-up/email", {
      method: "POST",
      json: { email, password: PASSWORD, name: "No Env" },
      env: { ENVIRONMENT: undefined, RESEND_API_KEY: undefined, EMAIL_FROM: undefined },
    });
    expect(lines.join("\n")).not.toContain("token=");
  });

  test("outside production the same situation prints the link for the developer", async () => {
    const lines = consoleOutput();
    const email = uniqueEmail("dev");
    await call("/api/auth/sign-up/email", {
      method: "POST",
      json: { email, password: PASSWORD, name: "Dev" },
      env: { ENVIRONMENT: "development", RESEND_API_KEY: undefined, EMAIL_FROM: undefined },
    });
    const all = lines.join("\n");
    expect(all).toContain("[email:dev] verify-email");
    expect(all).toContain("/api/auth/verify-email?token=");
  });

  test("a provider error is logged by status only", async () => {
    const lines = consoleOutput();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom: recipient not allowed", { status: 422 }));
    const email = uniqueEmail("rejected");
    const res = await signUp(email);

    expect(res.status).toBe(200);
    const all = lines.join("\n");
    expect(all).toContain("provider rejected verify-email email: HTTP 422");
    expect(all).not.toContain(email);
    expect(all).not.toContain("recipient not allowed");
  });
});

describe("Google sign-in availability", () => {
  test("is reported off, and the route does not exist, until both variables are set", async () => {
    expect(await (await call("/api/config")).json()).toEqual({ google: false });
    const start = await call("/api/auth/sign-in/social", { method: "POST", json: { provider: "google" } });
    expect(start.status).toBeGreaterThanOrEqual(400);

    const on = { GOOGLE_CLIENT_ID: "fake-client-id", GOOGLE_CLIENT_SECRET: "fake-client-secret" };
    expect(await (await call("/api/config", { env: on })).json()).toEqual({ google: true });
    const redirect = await call("/api/auth/sign-in/social", { method: "POST", json: { provider: "google", callbackURL: "/announcements" }, env: on });
    expect(redirect.status).toBe(200);
    const body = (await redirect.json()) as { url?: string };
    expect(body.url).toContain("https://accounts.google.com/");
    // The OAuth state cookie must survive the wrapper, or the callback fails with state_mismatch.
    expect(redirect.headers.getSetCookie().length).toBeGreaterThan(0);
  });
});
