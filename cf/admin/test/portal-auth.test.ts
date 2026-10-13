import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ADMIN_AUDIENCE, AUTH_BASE_PATH, STUDENT_AUDIENCE } from "../src/auth/factory";
import { AUTH_POLICIES, findPolicy } from "../src/auth/gate";
import { REGISTER_MESSAGE } from "../src/auth/register";
import { TURNSTILE_TEST_SECRETS } from "../src/security/turnstile";
import {
  call,
  CAPTCHA,
  cookiesOf,
  emails,
  emailsTo,
  fakeNetwork,
  freshIp,
  google,
  PASSWORD,
  productionLike,
  signedInCookie,
  signIn,
  uniqueEmail,
} from "./helpers";
import {
  cookieHeaderOf,
  cookieNames,
  createVerifiedStudent,
  PORTAL_ORIGIN,
  PORTAL_SECRET,
  portalCall,
  portalGoogleStart,
  portalLinkIn,
  portalRegister,
  portalResetTokenIn,
  portalSignedIn,
  portalSignIn,
  portalSignInWithGoogle,
  REGISTER_PATH,
  SIGN_IN_PATH,
  VERIFIED_CALLBACK,
} from "./portal-helpers";

// The student audience of auth (docs/cloudflare/auth.md#base-path-and-audience): the admin's whole route table under
// /portal/api/auth, a cookie and a secret of its own, the Google callback on the apex. A student can register, verify,
// sign in and call `GET /portal/api/me` against the skeleton; an admin cookie does not work here and a student cookie
// does not work on the admin.

afterEach(() => {
  vi.restoreAllMocks();
});

const BASE = STUDENT_AUDIENCE.basePath;

async function userRow(email: string) {
  return env.DB.prepare("SELECT id, email, email_verified AS emailVerified, role FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string; email: string; emailVerified: number; role: string }>();
}

async function userCount(): Promise<number> {
  return (await env.DB.prepare("SELECT count(*) AS n FROM users").first<{ n: number }>())!.n;
}

describe("the audiences", () => {
  test("the admin's is exactly what it was; the student's has its own mount point, error page and cookie", () => {
    expect(ADMIN_AUDIENCE).toEqual({ name: "admin", basePath: "/api/auth", errorPath: "/auth/error", cookiePrefix: "better-auth" });
    expect(STUDENT_AUDIENCE).toEqual({ name: "student", basePath: "/portal/api/auth", errorPath: "/portal/auth/error", cookiePrefix: "sakem-student" });
    expect(AUTH_BASE_PATH).toBe("/api/auth"); // what src/worker.ts and the admin SPA use
  });

  test("the two test secrets differ (the deployed ones must too: docs/cloudflare/portal-architecture.md, section 12, item 3)", () => {
    expect(PORTAL_SECRET).not.toBe(env.BETTER_AUTH_SECRET);
    expect(PORTAL_SECRET.length).toBeGreaterThanOrEqual(32);
  });
});

describe("a student registers, verifies, signs in and calls /portal/api/me", () => {
  test("the whole flow, on the portal's own paths", async () => {
    const email = uniqueEmail("siswa");

    // 1. Register: 200, the neutral message, no session, one verification email with a link on the portal's base path.
    const registered = await portalRegister(email, { name: "Sari Dewi" });
    expect(registered.status).toBe(200);
    expect(await registered.json()).toEqual({ ok: true, message: REGISTER_MESSAGE });
    expect(registered.headers.getSetCookie()).toEqual([]);
    expect(emailsTo(email)).toHaveLength(1);
    const verification = emailsTo(email)[0]!;
    expect(verification).toMatchObject({ purpose: "verify-email", subject: "Verifikasi email Sakola Kembara" });
    const link = portalLinkIn(verification);
    expect(link.startsWith(`${BASE}/verify-email?token=`)).toBe(true);
    expect(new URL(link, PORTAL_ORIGIN).searchParams.get("callbackURL")).toBe(VERIFIED_CALLBACK);
    expect(await userRow(email)).toMatchObject({ emailVerified: 0, role: "student" });

    // 2. Signing in before the link is opened is refused, and a fresh link is sent.
    const early = await portalSignIn(email);
    expect(early.status).toBe(403);
    expect(await early.json()).toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
    expect(early.headers.getSetCookie()).toEqual([]);
    expect(emailsTo(email)).toHaveLength(2);

    // 3. The link verifies the address and sends the browser to the SPA's sign-in page. It does not sign anyone in.
    const verified = await portalCall(link);
    expect(verified.status).toBe(302);
    expect(verified.headers.get("location")).toBe("/portal/login?verified=1");
    expect(verified.headers.getSetCookie()).toEqual([]);
    expect(await userRow(email)).toMatchObject({ emailVerified: 1 });

    // 4. Sign in: the portal's cookie, and only that.
    const signedIn = await portalSignIn(email);
    expect(signedIn.status).toBe(200);
    expect(cookieNames(signedIn)).toEqual(["sakem-student.session_token"]);
    const cookie = cookieHeaderOf(signedIn);

    // 5. `me`: who they are, with the role the SPA decides the screen by.
    const me = await portalCall("/portal/api/me", { cookie });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ user: { id: (await userRow(email))!.id, name: "Sari Dewi", email, emailVerified: true, role: "student" } });

    // 6. get-session is Better Auth's own answer, and its `user.role` is the field the public site's navbar reads.
    const session = (await (await portalCall(`${BASE}/get-session`, { cookie })).json()) as { user: { role: string; email: string }; session: { token: string } };
    expect(session.user).toMatchObject({ role: "student", email });

    // 7. Sign out ends the session.
    expect((await portalCall(`${BASE}/sign-out`, { method: "POST", json: {}, cookie })).status).toBe(200);
    expect((await portalCall("/portal/api/me", { cookie })).status).toBe(401);
    expect(await (await portalCall(`${BASE}/get-session`, { cookie })).json()).toBeNull();
  });

  test("registering, verifying and signing in are audited with the person as the actor, never a password", async () => {
    const email = uniqueEmail();
    await createVerifiedStudent(email);
    // createVerifiedStudent removes the rows of the fixture; do it again by hand to read them.
    const other = uniqueEmail();
    await portalRegister(other);
    await portalCall(portalLinkIn(emailsTo(other)[0]!));
    const { results } = await env.DB.prepare("SELECT action, actor_email, metadata FROM audit_log ORDER BY created_at, rowid").all<{ action: string; actor_email: string; metadata: string | null }>();
    expect(results.map((row) => row.action)).toEqual(["student.register", "user.email_verified"]);
    expect(results[0]).toMatchObject({ actor_email: other });
    expect(JSON.parse(results[0]!.metadata!)).toEqual({ via: "email" });
    expect(JSON.stringify(results)).not.toContain(PASSWORD);
  });

  test("a wrong password and an unknown address answer the same 401", async () => {
    const email = uniqueEmail();
    await createVerifiedStudent(email);
    const wrong = await portalSignIn(email, "not the password");
    const unknown = await portalSignIn(uniqueEmail("ghost"), PASSWORD);
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  test("a deactivated account cannot sign in, and gets no email", async () => {
    const email = uniqueEmail();
    await createVerifiedStudent(email);
    await env.DB.prepare("UPDATE users SET deactivated_at = ? WHERE email = ?").bind(Date.now(), email).run();
    const res = await portalSignIn(email);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "ACCOUNT_DEACTIVATED" });
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  test("a tampered or expired verification link verifies nothing and goes back to the SPA's page with the error", async () => {
    const email = uniqueEmail();
    await portalRegister(email);
    const link = portalLinkIn(emailsTo(email)[0]!);
    const tampered = await portalCall(link.replace(/token=([^&]+)/, (_, t: string) => `token=${t.slice(0, -3)}abc`));
    expect(tampered.status).toBe(302);
    expect(tampered.headers.get("location")).toBe("/portal/login?verified=1&error=INVALID_TOKEN");
    expect((await userRow(email))?.emailVerified).toBe(0);
  });

  test("the verification link can be opened twice", async () => {
    const email = uniqueEmail();
    await portalRegister(email);
    const link = portalLinkIn(emailsTo(email)[0]!);
    expect((await portalCall(link)).headers.get("location")).toBe("/portal/login?verified=1");
    expect((await portalCall(link)).headers.get("location")).toBe("/portal/login?verified=1");
    expect((await userRow(email))?.emailVerified).toBe(1);
  });
});

describe("registration on the portal: the contract of docs/cloudflare/auth.md, under the portal's base path", () => {
  test("the same answer for a new address, an address that has an account and a honeypot hit: status, body and headers", async () => {
    const email = uniqueEmail();
    const fresh = await portalRegister(email);
    const again = await portalRegister(email);
    const bot = await portalRegister(uniqueEmail(), { extra: { website: "http://spam.test" } });
    expect([fresh.status, again.status, bot.status]).toEqual([200, 200, 200]);
    const bodies = await Promise.all([fresh, again, bot].map((res) => res.text()));
    expect(new Set(bodies).size).toBe(1);
    expect(fresh.headers.get("content-type")).toBe(again.headers.get("content-type"));
    expect(await userCount()).toBe(1); // the bot created nothing
    // The owner of an existing address finds out by email, with a link to the page the form asked for.
    const exists = emailsTo(email).find((message) => message.purpose !== "verify-email");
    expect(exists).toBeDefined();
    expect(portalLinkIn(exists!)).toBe(VERIFIED_CALLBACK);
  });

  test("the role is always student: a role in the body changes nothing", async () => {
    const email = uniqueEmail();
    await portalRegister(email, { extra: { role: "super_admin", deactivatedAt: null, emailVerified: true } });
    expect(await userRow(email)).toMatchObject({ role: "student", emailVerified: 0 });
  });

  test("the legacy rules and wording, as 400 invalid with fieldErrors", async () => {
    const res = await portalRegister("not-an-email", { name: "x", password: "short" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string; fieldErrors: Record<string, string[]> };
    expect(body).toMatchObject({ error: "invalid", message: "Periksa kembali isian formulir." });
    expect(body.fieldErrors).toEqual({ name: ["Nama minimal 2 karakter"], email: ["Format email belum benar"], password: ["Password minimal 8 karakter"] });
    expect(await userCount()).toBe(0);
  });

  test("a callbackURL on another origin is refused (the verification link must not be an open redirect)", async () => {
    const res = await portalRegister(uniqueEmail(), { extra: { callbackURL: "https://evil.test/steal" } });
    expect(res.status).toBe(403);
  });

  test("a confirmPassword that differs is refused", async () => {
    const res = await portalRegister(uniqueEmail(), { extra: { confirmPassword: "something else" } });
    expect(res.status).toBe(400);
  });
});

describe("forgot password, on the portal's paths", () => {
  test("request, open the emailed link, choose a password, sign in with it; the old one stops working", async () => {
    const email = uniqueEmail();
    await createVerifiedStudent(email);
    const oldCookie = cookieHeaderOf(await portalSignIn(email));

    const asked = await portalCall(`${BASE}/request-password-reset`, { method: "POST", json: { email, redirectTo: "/portal/reset-password" } });
    expect(asked.status).toBe(200);
    const reset = emailsTo(email).find((message) => message.purpose === "reset-password")!;
    expect(reset).toBeDefined();
    const link = portalLinkIn(reset);
    expect(link.startsWith(`${BASE}/reset-password/`)).toBe(true);
    const token = portalResetTokenIn(reset);

    // The emailed link redirects to the SPA with the token; the SPA posts it back.
    const opened = await portalCall(link);
    expect(opened.status).toBe(302);
    expect(opened.headers.get("location")).toBe(`${PORTAL_ORIGIN}/portal/reset-password?token=${token}`);
    const done = await portalCall(`${BASE}/reset-password`, { method: "POST", json: { token, newPassword: "a brand new password" } });
    expect(done.status).toBe(200);

    expect((await portalSignIn(email, PASSWORD)).status).toBe(401);
    expect((await portalSignIn(email, "a brand new password")).status).toBe(200);
    // Every session of that user ended with the reset.
    expect((await portalCall("/portal/api/me", { cookie: oldCookie })).status).toBe(401);
  });

  test("the same answer for every address, and no email for an address nobody has", async () => {
    const known = uniqueEmail();
    await createVerifiedStudent(known);
    const answers = [];
    for (const email of [known, uniqueEmail("ghost")]) {
      const res = await portalCall(`${BASE}/request-password-reset`, { method: "POST", json: { email, redirectTo: "/portal/reset-password" } });
      answers.push([res.status, await res.text()]);
    }
    expect(answers[0]).toEqual(answers[1]);
    expect(emails().filter((message) => message.purpose === "reset-password")).toHaveLength(1);
  });

  test("a redirectTo on another origin is refused", async () => {
    const email = uniqueEmail();
    await createVerifiedStudent(email);
    const res = await portalCall(`${BASE}/request-password-reset`, { method: "POST", json: { email, redirectTo: "https://evil.test/reset" } });
    expect(res.status).toBe(403);
  });
});

describe("cookies", () => {
  test("development and tests: sakem-student.session_token, HttpOnly, SameSite=Lax, Path=/, not Secure, no Domain", async () => {
    const email = uniqueEmail();
    await createVerifiedStudent(email);
    const res = await portalSignIn(email);
    const setCookie = res.headers.getSetCookie().join("\n");
    expect(setCookie).toMatch(/^sakem-student\.session_token=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).not.toMatch(/Secure/i);
    expect(setCookie).not.toMatch(/Domain=/i);
  });

  test("production: __Host-sakem-student.session_token, Secure, Path=/, no Domain, HttpOnly, SameSite=Lax (host-only)", async () => {
    fakeNetwork();
    const email = uniqueEmail();
    await createVerifiedStudent(email);
    const res = await portalSignIn(email, PASSWORD, { env: productionLike, captcha: CAPTCHA });
    expect(res.status).toBe(200);
    expect(cookieNames(res)).toEqual(["__Host-sakem-student.session_token"]);
    const setCookie = res.headers.getSetCookie().join("\n");
    for (const attribute of [/Secure/i, /HttpOnly/i, /SameSite=Lax/i, /Path=\//]) expect(setCookie).toMatch(attribute);
    expect(setCookie).not.toMatch(/Domain=/i);
    // The admin's production cookie keeps its own name (docs/cloudflare/auth.md#cookies-and-csrf).
    const admin = await call("/api/auth/sign-in/email", { method: "POST", json: { email, password: PASSWORD }, env: productionLike, captcha: CAPTCHA });
    expect(cookieNames(admin)).toEqual(["__Host-better-auth.session_token"]);
  });

  test("COOKIE_DOMAIN, if someone sets it, keeps the audience in the name (__Secure- and the Domain, the opt-in of docs/cloudflare/auth.md)", async () => {
    fakeNetwork();
    const email = uniqueEmail();
    await createVerifiedStudent(email);
    const res = await portalSignIn(email, PASSWORD, { env: { ...productionLike, COOKIE_DOMAIN: ".sakola.test" }, captcha: CAPTCHA });
    expect(cookieNames(res)).toEqual(["__Secure-sakem-student.session_token"]);
    expect(res.headers.getSetCookie().join("\n")).toMatch(/Domain=\.?sakola\.test/i);
  });
});

describe("the two audiences cannot use each other's sessions", () => {
  test("a student cookie is nobody on the admin, and an admin cookie is nobody on the portal", async () => {
    const studentCookie = await portalSignedIn(uniqueEmail("siswa"));
    const adminCookie = await signedInCookie(uniqueEmail("admin"), "super_admin");
    expect(studentCookie).toContain("sakem-student.session_token=");
    expect(adminCookie).toContain("better-auth.session_token=");

    expect((await call("/api/me", { cookie: studentCookie })).status).toBe(401);
    expect((await call("/api/dashboard", { cookie: studentCookie })).status).toBe(401);
    expect((await call("/api/auth/get-session", { cookie: studentCookie })).status).toBe(200);
    expect(await (await call("/api/auth/get-session", { cookie: studentCookie })).json()).toBeNull();

    expect((await portalCall("/portal/api/me", { cookie: adminCookie })).status).toBe(401);
    expect(await (await portalCall(`${BASE}/get-session`, { cookie: adminCookie })).json()).toBeNull();
    // Both together: each Worker reads only its own.
    const both = `${studentCookie}; ${adminCookie}`;
    expect(((await (await portalCall("/portal/api/me", { cookie: both })).json()) as { user: { role: string } }).user.role).toBe("student");
    expect(((await (await call("/api/me", { cookie: both })).json()) as { user: { role: string } }).user.role).toBe("super_admin");
  });

  test("with a secret of its own per Worker, a cookie renamed to the other audience's name is refused too", async () => {
    const studentCookie = await portalSignedIn(uniqueEmail("siswa"));
    const adminCookie = await signedInCookie(uniqueEmail("admin"), "editor");
    const asAdminName = studentCookie.replace("sakem-student.session_token", "better-auth.session_token");
    const asStudentName = adminCookie.replace("better-auth.session_token", "sakem-student.session_token");
    expect(asAdminName).not.toBe(studentCookie);
    expect((await call("/api/me", { cookie: asAdminName })).status).toBe(401);
    expect((await portalCall("/portal/api/me", { cookie: asStudentName })).status).toBe(401);
  });

  test("WHY the secrets must differ: with one shared secret the renamed cookie would cross (so the deploy sets two, and the runbook says so)", async () => {
    // Misconfiguration on purpose: the portal signs with the admin's secret. The token is a row of the shared
    // `session` table and the cookie's name is not part of its signature, so only the secret keeps the audiences apart.
    const email = uniqueEmail();
    await createVerifiedStudent(email);
    const shared = await portalSignIn(email, PASSWORD, { env: { BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET } });
    const crossed = cookieHeaderOf(shared).replace("sakem-student.session_token", "better-auth.session_token");
    const res = await call("/api/me", { cookie: crossed });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: { role: string } }).user.role).toBe("student"); // a student, in the admin: only the role stops it from there
    expect((await call("/api/admin/applications", { cookie: crossed })).status).toBe(403);
  });

  test("a verification token minted by the portal does not verify anything on the admin", async () => {
    const email = uniqueEmail();
    await portalRegister(email);
    const link = portalLinkIn(emailsTo(email)[0]!);
    expect(link.startsWith("/portal/api/auth/verify-email?")).toBe(true);
    const onAdmin = await call(link.replace("/portal/api/auth", "/api/auth"));
    expect(onAdmin.status).toBe(302);
    expect(onAdmin.headers.get("location")).toContain("error=INVALID_TOKEN");
    expect((await userRow(email))?.emailVerified).toBe(0);
  });

  test("an admin account may sign in on the portal (it gets the 'not a student' screen from `me`), with the portal's cookie", async () => {
    const email = uniqueEmail("editor");
    await createVerifiedStudent(email, "editor");
    const res = await portalSignIn(email);
    expect(res.status).toBe(200);
    expect(cookieNames(res)).toEqual(["sakem-student.session_token"]);
    const me = await portalCall("/portal/api/me", { cookie: cookieHeaderOf(res) });
    expect(((await me.json()) as { user: { role: string } }).user.role).toBe("editor");
    // And that cookie is no use on the admin.
    expect((await call("/api/me", { cookie: cookieHeaderOf(res) })).status).toBe(401);
  });

  test("an admin signing in on the admin host gets the admin's cookie, as before", async () => {
    const email = uniqueEmail();
    await createVerifiedStudent(email, "viewer");
    const res = await signIn(email);
    expect(res.status).toBe(200);
    expect(cookiesOf(res)).toContain("better-auth.session_token=");
    expect(cookiesOf(res)).not.toContain("sakem-student");
  });
});

// ─── The whole route table, under the portal's base path ───────────────

describe("the route table under /portal/api/auth", () => {
  test("the same table, found below the portal's mount point and not below the admin's", () => {
    for (const policy of AUTH_POLICIES) {
      const concrete = policy.path.endsWith("/") ? `${policy.path}token` : policy.path;
      expect(findPolicy(policy.method, `${BASE}${concrete}`, BASE), `${policy.method} ${concrete}`).toBe(policy);
      expect(findPolicy(policy.method, `/api/auth${concrete}`, BASE), `admin path on the portal: ${concrete}`).toBeUndefined();
      expect(findPolicy(policy.method, `/api/auth${concrete}`), `admin path, default base: ${concrete}`).toBe(policy);
      expect(findPolicy(policy.method, `${BASE}${concrete}`), `portal path, admin base: ${concrete}`).toBeUndefined();
    }
  });

  const unlisted: [string, string][] = [
    ["POST", `${BASE}/sign-up/email`],
    ["POST", `${BASE}/update-user`],
    ["POST", `${BASE}/delete-user`],
    ["POST", `${BASE}/change-email`],
    ["POST", `${BASE}/change-password`],
    ["POST", `${BASE}/set-password`],
    ["GET", `${BASE}/list-sessions`],
    ["POST", `${BASE}/revoke-sessions`],
    ["GET", `${BASE}/list-accounts`],
    ["POST", `${BASE}/link-social`],
    ["POST", `${BASE}/unlink-account`],
    ["POST", `${BASE}/get-access-token`],
    ["GET", `${BASE}/ok`],
    ["GET", `${BASE}/error`],
    ["GET", `${BASE}/sign-in/email`], // right path, wrong method
    ["POST", `${BASE}/get-session`],
    ["POST", `${BASE}/reset-password/sometoken`],
    ["GET", `${BASE}/reset-password`], // the prefix needs a token after it
    ["GET", `${BASE}/`],
    ["GET", BASE],
    // The admin's mount point does not exist on this Worker at all.
    ["POST", "/api/auth/sign-in/email"],
    ["POST", "/api/auth/register"],
    ["GET", "/api/auth/get-session"],
  ];
  for (const [method, path] of unlisted) {
    test(`${method} ${path} does not exist`, async () => {
      const res = await portalCall(path, { method, ...(method === "POST" ? { json: {} } : {}) });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    });
  }

  describe("JSON only, and a small body", () => {
    test("a form-encoded body, text/plain or no content type on a POST route is a 415", async () => {
      for (const path of [SIGN_IN_PATH, REGISTER_PATH, `${BASE}/request-password-reset`, `${BASE}/send-verification-email`, `${BASE}/reset-password`, `${BASE}/sign-in/social`, `${BASE}/sign-out`]) {
        const form = await portalCall(path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `email=${encodeURIComponent("a@example.test")}&password=${PASSWORD}` });
        expect(form.status, path).toBe(415);
        expect(await form.json(), path).toEqual({ error: "json_required" });
        expect((await portalCall(path, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" })).status, path).toBe(415);
        expect((await portalCall(path, { method: "POST" })).status, path).toBe(415);
      }
    });

    test("a body over 8 KiB is a 413 before anything reads it further; just under is read", async () => {
      const big = JSON.stringify({ email: "a@example.test", password: "x".repeat(9000) });
      expect((await portalCall(SIGN_IN_PATH, { method: "POST", headers: { "content-type": "application/json" }, body: big })).status).toBe(413);
      expect(await userCount()).toBe(0);
      const email = uniqueEmail();
      await createVerifiedStudent(email);
      const padded = JSON.stringify({ email, password: PASSWORD, padding: "x".repeat(7000) });
      expect((await portalCall(SIGN_IN_PATH, { method: "POST", headers: { "content-type": "application/json" }, body: padded })).status).toBe(200);
    });
  });

  describe("Turnstile on the four routes that send email or check a password", () => {
    const routes = [
      { name: "sign-in", path: SIGN_IN_PATH, action: "login", body: () => ({ email: uniqueEmail(), password: PASSWORD }) },
      { name: "register", path: REGISTER_PATH, action: "register", body: () => ({ email: uniqueEmail(), password: PASSWORD, name: "Tester" }) },
      { name: "forgot password", path: `${BASE}/request-password-reset`, action: "forgot-password", body: () => ({ email: uniqueEmail(), redirectTo: "/portal/reset-password" }) },
      { name: "resend verification", path: `${BASE}/send-verification-email`, action: "resend-verification", body: () => ({ email: uniqueEmail() }) },
    ];
    for (const route of routes) {
      describe(route.name, () => {
        test("no token: 403 captcha_failed", async () => {
          fakeNetwork();
          const res = await portalCall(route.path, { method: "POST", json: route.body(), env: productionLike });
          expect(res.status).toBe(403);
          expect(await res.json()).toMatchObject({ error: "captcha_failed" });
        });
        test("a token Cloudflare refuses, or one already used: 403, and nothing is created or sent", async () => {
          const network = fakeNetwork();
          for (const secret of [TURNSTILE_TEST_SECRETS.alwaysFail, TURNSTILE_TEST_SECRETS.spent]) {
            const res = await portalCall(route.path, { method: "POST", json: route.body(), env: { ...productionLike, TURNSTILE_SECRET_KEY: secret }, captcha: CAPTCHA });
            expect(res.status).toBe(403);
          }
          expect(await userCount()).toBe(0);
          expect(network.resend).toHaveLength(0);
        });
        test("Siteverify unreachable, or no secret in production: 503 captcha_unavailable (fails closed)", async () => {
          vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network down"));
          const down = await portalCall(route.path, { method: "POST", json: route.body(), env: productionLike, captcha: CAPTCHA });
          expect([down.status, ((await down.json()) as { error: string }).error]).toEqual([503, "captcha_unavailable"]);
          const none = await portalCall(route.path, { method: "POST", json: route.body(), env: { ...productionLike, TURNSTILE_SECRET_KEY: undefined }, captcha: CAPTCHA });
          expect(none.status).toBe(503);
        });
        test(`a good token passes, and the widget's action is asked for: '${route.action}'`, async () => {
          const network = fakeNetwork();
          const ip = freshIp();
          const res = await portalCall(route.path, { method: "POST", json: route.body(), env: productionLike, captcha: CAPTCHA, ip });
          expect(res.status).not.toBe(403);
          expect(res.status).not.toBe(503);
          expect(network.siteverify).toEqual([{ secret: TURNSTILE_TEST_SECRETS.alwaysPass, response: CAPTCHA, remoteip: ip }]);
          expect(findPolicy("POST", `${BASE}${new URL(route.path, PORTAL_ORIGIN).pathname.slice(BASE.length)}`, BASE)?.turnstile).toBe(route.action);
        });
      });
    }

    test("the routes that carry a token or nothing sensitive need none", async () => {
      fakeNetwork();
      const noCaptcha = { ...productionLike, TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRETS.alwaysFail };
      expect((await portalCall(`${BASE}/get-session`, { env: noCaptcha })).status).toBe(200);
      expect((await portalCall(`${BASE}/sign-out`, { method: "POST", json: {}, env: noCaptcha })).status).not.toBe(403);
      expect((await portalCall(`${BASE}/reset-password`, { method: "POST", json: { token: "nope", newPassword: "long enough" }, env: noCaptcha })).status).toBe(400);
      expect((await portalCall(`${BASE}/verify-email?token=nope`, { env: noCaptcha })).status).not.toBe(403);
    });
  });

  describe("email is required where it is sent", () => {
    const noProvider = { ENVIRONMENT: "production", RESEND_API_KEY: undefined, EMAIL_FROM: undefined, TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRETS.alwaysPass };

    test("register, forgot password and resend: 503 email_unavailable in production without a provider, before an account is created or a token is spent", async () => {
      const network = fakeNetwork();
      const register = await portalRegister(uniqueEmail(), { env: noProvider, captcha: CAPTCHA });
      expect(register.status).toBe(503);
      expect(await register.json()).toMatchObject({ error: "email_unavailable" });
      expect(await userCount()).toBe(0);
      for (const [path, body] of [
        [`${BASE}/request-password-reset`, { email: uniqueEmail(), redirectTo: "/portal/reset-password" }],
        [`${BASE}/send-verification-email`, { email: uniqueEmail() }],
      ] as const) {
        expect((await portalCall(path, { method: "POST", json: body, env: noProvider, captcha: CAPTCHA })).status, path).toBe(503);
      }
      expect(network.siteverify).toHaveLength(0);
    });

    test("outside production without a provider the message is recorded in memory, not printed or sent", async () => {
      const email = uniqueEmail();
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      expect((await portalRegister(email, { env: { RESEND_API_KEY: undefined, EMAIL_FROM: undefined } })).status).toBe(200);
      expect(emailsTo(email)).toHaveLength(1);
      expect(log).not.toHaveBeenCalled();
    });
  });

  describe("rate limits (the table of docs/cloudflare/auth.md, on the portal's own bindings)", () => {
    test("sign-in: 5 a minute for one address and account, the sixth is 429 with Retry-After", async () => {
      const ip = freshIp();
      const email = uniqueEmail();
      const statuses: number[] = [];
      for (let i = 0; i < 7; i++) statuses.push((await portalCall(SIGN_IN_PATH, { method: "POST", json: { email, password: "x" }, ip })).status);
      expect(statuses).toEqual([401, 401, 401, 401, 401, 429, 429]);
      const refused = await portalCall(SIGN_IN_PATH, { method: "POST", json: { email, password: "x" }, ip });
      expect(refused.headers.get("retry-after")).toBe("60");
      expect(await refused.json()).toEqual({
        error: "rate_limited",
        message: "Terlalu banyak percobaan masuk. Silakan tunggu beberapa menit lalu coba lagi.",
        retryAfterSeconds: 60,
      });
    });

    test("registration: 10 a minute per address; and 3 emails a minute to one mailbox", async () => {
      const ip = freshIp();
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) statuses.push((await portalRegister(uniqueEmail(), { ip })).status);
      expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 429, 429]);
      const mailbox = uniqueEmail();
      const perMailbox: number[] = [];
      for (let i = 0; i < 5; i++) perMailbox.push((await portalRegister(mailbox)).status);
      expect(perMailbox).toEqual([200, 200, 200, 429, 429]);
    });

    test("forgot password 5 a minute per address; resend 2 a minute per mailbox", async () => {
      const ip = freshIp();
      const reset: number[] = [];
      for (let i = 0; i < 6; i++) reset.push((await portalCall(`${BASE}/request-password-reset`, { method: "POST", json: { email: uniqueEmail(), redirectTo: "/portal/reset-password" }, ip })).status);
      expect(reset).toEqual([200, 200, 200, 200, 200, 429]);
      const mailbox = uniqueEmail();
      const resend: number[] = [];
      for (let i = 0; i < 3; i++) resend.push((await portalCall(`${BASE}/send-verification-email`, { method: "POST", json: { email: mailbox } })).status);
      expect(resend).toEqual([200, 200, 429]);
    });

    test("tokens and Google start: 20 a minute per address", async () => {
      const ip = freshIp();
      const statuses: number[] = [];
      for (let i = 0; i < 22; i++) statuses.push((await portalCall(`${BASE}/verify-email?token=nope`, { ip })).status);
      expect(statuses.slice(0, 20).every((status) => status === 302 || status === 401 || status === 400)).toBe(true);
      expect(statuses.slice(20)).toEqual([429, 429]);
    });

    test("the address is CF-Connecting-IP and nothing else: rotating X-Forwarded-For does not get a fresh bucket", async () => {
      const ip = freshIp();
      const email = uniqueEmail();
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) statuses.push((await portalCall(SIGN_IN_PATH, { method: "POST", json: { email, password: "x" }, ip, headers: { "x-forwarded-for": `198.51.100.${i}`, "x-real-ip": `198.51.100.${i + 50}` } })).status);
      expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    });

    test("in production a missing binding fails closed: 503 service_unavailable", async () => {
      fakeNetwork();
      vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await portalCall(SIGN_IN_PATH, { method: "POST", json: { email: uniqueEmail(), password: "x" }, env: { ...productionLike, RL_LOGIN: undefined }, captcha: CAPTCHA });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "service_unavailable" });
    });
  });
});

// ─── Google ────────────────────────────────────────────────────────────

describe("Google on the portal", () => {
  test("the redirect URI is the callback of the host that asked: the apex's, under /portal (and the admin's stays on its own)", async () => {
    const apex = await portalGoogleStart(PORTAL_ORIGIN);
    expect(apex.url.origin).toBe("https://accounts.google.com");
    expect(apex.url.searchParams.get("redirect_uri")).toBe("https://sakola.test/portal/api/auth/callback/google");
    expect(apex.url.searchParams.get("client_id")).toBe(google.GOOGLE_CLIENT_ID);
    expect(apex.url.searchParams.get("prompt")).toBe("select_account"); // the account chooser is always shown (shared devices)

    const other = await portalGoogleStart("https://staging.sakola.test");
    expect(other.url.searchParams.get("redirect_uri")).toBe("https://staging.sakola.test/portal/api/auth/callback/google");

    const start = await call("/api/auth/sign-in/social", { method: "POST", json: { provider: "google", callbackURL: "/announcements" }, env: google });
    const admin = new URL(((await start.json()) as { url: string }).url);
    expect(admin.searchParams.get("redirect_uri")).toBe("https://admin.test/api/auth/callback/google");
  });

  test("Google is off until both variables exist", async () => {
    const res = await portalCall(`${BASE}/sign-in/social`, { method: "POST", json: { provider: "google", callbackURL: "/portal/" } });
    expect(res.status).not.toBe(200);
  });

  test("a new Google user becomes a verified student, with the portal's cookie, sent to the page they came from", async () => {
    const email = uniqueEmail("google-new");
    const res = await portalSignInWithGoogle({ email, email_verified: true });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/portal/");
    expect(cookieNames(res)).toContain("sakem-student.session_token");
    expect(cookiesOf(res)).not.toContain("better-auth.session_token");
    expect(await userRow(email)).toMatchObject({ role: "student", emailVerified: 1 });
    const me = await portalCall("/portal/api/me", { cookie: cookieHeaderOf(res) });
    expect(((await me.json()) as { user: { role: string; email: string } }).user).toMatchObject({ role: "student", email });
    const audit = await env.DB.prepare("SELECT metadata FROM audit_log WHERE action = 'student.register'").first<{ metadata: string }>();
    expect(JSON.parse(audit!.metadata)).toEqual({ via: "google" });
  });

  test("Google links to a verified local account; never to an unverified one; never to an address Google does not call verified", async () => {
    const linked = uniqueEmail("link");
    await createVerifiedStudent(linked);
    const ok = await portalSignInWithGoogle({ email: linked, email_verified: true, sub: "google-sub-link" });
    expect(ok.headers.get("location")).toBe("/portal/");
    vi.restoreAllMocks();

    const squatted = uniqueEmail("squatted");
    await portalRegister(squatted, { password: "attacker chosen password" }); // registered, never verified
    const refused = await portalSignInWithGoogle({ email: squatted, email_verified: true, sub: "google-sub-squatted" });
    expect(refused.status).toBe(302);
    expect(refused.headers.get("location")).toMatch(/^\/portal\/auth\/error\?error=/);
    expect(cookiesOf(refused)).not.toContain("session_token");
    vi.restoreAllMocks();

    const liar = uniqueEmail("liar");
    const unverified = await portalSignInWithGoogle({ email: liar, email_verified: false, sub: "google-sub-liar" });
    expect(unverified.headers.get("location")).toMatch(/^\/portal\/auth\/error\?error=/);
    expect(await userRow(liar)).toBeNull();
  });

  test("a deactivated account cannot get a session through Google either", async () => {
    const email = uniqueEmail("off");
    await createVerifiedStudent(email);
    await env.DB.prepare("UPDATE users SET deactivated_at = ? WHERE email = ?").bind(Date.now(), email).run();
    const res = await portalSignInWithGoogle({ email, email_verified: true, sub: "google-sub-off" });
    expect(cookiesOf(res)).not.toContain("session_token");
  });
});
