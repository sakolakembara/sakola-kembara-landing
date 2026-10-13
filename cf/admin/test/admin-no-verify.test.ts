import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vitest";
import migration from "../migrations/0011_admin_signin_without_verification.sql?raw";
import { adminRoles } from "../src/auth/roles";
import {
  call,
  CAPTCHA,
  cookiesOf,
  emailsTo,
  fakeNetwork,
  insertSuperAdmin,
  linkIn,
  PASSWORD,
  productionLike,
  resetTokenIn,
  signedInCookie,
  signIn,
  signInWithGoogle,
  signUp,
  uniqueEmail,
} from "./helpers";

// An admin never has to verify an email address (SAKEM-089): the super_admin who created or invited them is the
// trust. Everything here goes through the real routes (Pengaturan's create, the sign-in route, the invitation link,
// forgot password, resend verification, Google), because that is where "can sign in" is decided. Students are the
// other half: they still verify, and nothing a super_admin does here changes that.

afterEach(() => {
  vi.restoreAllMocks();
});

const USERS = "/api/admin/users";
const EVERY_AREA = ["pendaftaran", "komunikasi", "konten"] as const;

async function boss() {
  const email = uniqueEmail("boss");
  const cookie = await signedInCookie(email, "super_admin");
  return { email, cookie };
}

const create = (cookie: string, json: Record<string, unknown>) => call(USERS, { method: "POST", cookie, json });

async function row(email: string) {
  return env.DB.prepare("SELECT id, role, email_verified AS verified FROM users WHERE email = ?").bind(email).first<{ id: string; role: string; verified: number }>();
}

const accountsOf = async (email: string) =>
  (await env.DB.prepare("SELECT a.provider_id AS provider FROM account a JOIN users u ON u.id = a.user_id WHERE u.email = ? ORDER BY a.provider_id").bind(email).all<{ provider: string }>()).results.map((r) => r.provider);

const sessionsOf = async (email: string) =>
  (await env.DB.prepare("SELECT count(*) AS n FROM session s JOIN users u ON u.id = s.user_id WHERE u.email = ?").bind(email).first<{ n: number }>())!.n;

/** The body and status of the sign-in route, the one place "can sign in" is decided. */
async function attempt(email: string, password: string) {
  const res = await signIn(email, password);
  return { res, status: res.status, body: (await res.clone().json().catch(() => null)) as { code?: string } | null };
}

describe("an admin created with a password", () => {
  test.each(adminRoles)("%s: created verified, signs in at once, and opens the API with the role they were given", async (role) => {
    const { cookie } = await boss();
    const email = uniqueEmail(role);
    const created = await create(cookie, { email, name: "Admin Baru", role, password: "first password 123" });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ item: { role, status: "active", emailVerified: true } });
    expect((await row(email))?.verified).toBe(1);

    const signedIn = await signIn(email, "first password 123");
    expect(signedIn.status).toBe(200);
    const me = (await (await call("/api/me", { cookie: cookiesOf(signedIn) })).json()) as { user: { role: string; emailVerified: boolean } };
    expect(me.user).toMatchObject({ role, emailVerified: true });
    // Nothing was mailed: no verification link to wait for, and none that could be used instead of the password.
    expect(emailsTo(email)).toEqual([]);
  });

  test("it does not need the email provider (an invitation does, and still fails closed)", async () => {
    fakeNetwork();
    const bossEmail = uniqueEmail("boss");
    await signedInCookie(bossEmail, "super_admin");
    const production = await call("/api/auth/sign-in/email", { method: "POST", json: { email: bossEmail, password: PASSWORD }, env: productionLike, captcha: CAPTCHA });
    expect(production.status).toBe(200);
    const cookie = cookiesOf(production);
    const noProvider = { ENVIRONMENT: "production", RESEND_API_KEY: undefined, EMAIL_FROM: undefined };

    const invited = uniqueEmail("invitee");
    const refused = await call(USERS, { method: "POST", cookie, json: { email: invited, role: "editor" }, env: noProvider });
    expect(refused.status).toBe(503);
    expect(await row(invited)).toBeNull(); // nothing created, as before

    const withPassword = uniqueEmail("withpw");
    const made = await call(USERS, { method: "POST", cookie, json: { email: withPassword, role: "editor", password: "first password 123" }, env: noProvider });
    expect(made.status).toBe(201);
    expect((await row(withPassword))?.verified).toBe(1);
  });

  test("deactivating it still works: the account cannot sign in by password, and no session is made", async () => {
    const { cookie } = await boss();
    const email = uniqueEmail("gone");
    const id = ((await (await create(cookie, { email, role: "editor", password: "first password 123" })).json()) as { item: { id: string } }).item.id;
    expect((await call(`${USERS}/${id}/deactivate`, { method: "POST", cookie, json: {} })).status).toBe(200);

    const refused = await attempt(email, "first password 123");
    expect(refused.status).toBe(403);
    expect(refused.body?.code).toBe("ACCOUNT_DEACTIVATED");
    expect(await sessionsOf(email)).toBe(0);
  });

  test("a wrong password is 401 as for anyone: nothing about verification leaks", async () => {
    const { cookie } = await boss();
    const email = uniqueEmail("pw");
    await create(cookie, { email, role: "viewer", password: "first password 123" });
    const wrong = await attempt(email, "not the password");
    expect(wrong.status).toBe(401);
    expect(wrong.body?.code).toBe("INVALID_EMAIL_OR_PASSWORD");
  });
});

describe("an admin who was invited", () => {
  async function invite(cookie: string, role = "editor") {
    const email = uniqueEmail("invitee");
    const res = await create(cookie, { email, name: "Calon Admin", role });
    expect(res.status).toBe(201);
    return email;
  }

  test("before opening the link: nothing to sign in with (401, the answer of a wrong password), unverified, no session", async () => {
    const { cookie } = await boss();
    const email = await invite(cookie);
    const refused = await attempt(email, PASSWORD);
    expect(refused.status).toBe(401);
    expect(refused.body?.code).toBe("INVALID_EMAIL_OR_PASSWORD");
    expect(await row(email)).toMatchObject({ verified: 0 });
    expect(await accountsOf(email)).toEqual([]);
    expect(await sessionsOf(email)).toBe(0);
  });

  test("opening the link and choosing a password verifies the address, makes the credential account, and they sign in (200)", async () => {
    const { cookie } = await boss();
    const email = await invite(cookie, "viewer");
    const token = resetTokenIn(emailsTo(email).find((m) => m.purpose === "admin-invite")!);
    expect((await call("/api/auth/reset-password", { method: "POST", json: { token, newPassword: "the password they chose" } })).status).toBe(200);

    expect((await row(email))?.verified).toBe(1);
    expect(await accountsOf(email)).toEqual(["credential"]);
    expect((await attempt(email, "the password they chose")).status).toBe(200);
    expect((await (await call(USERS, { cookie })).json()) as { items: { email: string; status: string }[] }).toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ email, status: "active" })]) });
  });

  test("so does asking for a new password instead of using the invitation: the mailbox is the proof either way", async () => {
    const { cookie } = await boss();
    const email = await invite(cookie);
    const asked = await call("/api/auth/request-password-reset", { method: "POST", json: { email, redirectTo: "/reset-password" } });
    expect(asked.status).toBe(200);
    const token = resetTokenIn(emailsTo(email).find((m) => m.purpose === "reset-password")!);
    expect((await call("/api/auth/reset-password", { method: "POST", json: { token, newPassword: "the password they chose" } })).status).toBe(200);
    expect((await row(email))?.verified).toBe(1);
    expect((await attempt(email, "the password they chose")).status).toBe(200);
  });

  test("an expired link accepts nothing: still unverified, still nothing to sign in with", async () => {
    const { cookie } = await boss();
    const email = await invite(cookie);
    const token = resetTokenIn(emailsTo(email).find((m) => m.purpose === "admin-invite")!);
    await env.DB.prepare("UPDATE verification SET expires_at = ?").bind(Date.now() - 1000).run();
    expect((await call("/api/auth/reset-password", { method: "POST", json: { token, newPassword: "the password they chose" } })).status).toBe(400);
    expect(await row(email)).toMatchObject({ verified: 0 });
    expect((await attempt(email, "the password they chose")).status).toBe(401);
  });
});

describe("students still verify", () => {
  // Negative check: requireEmailVerification off (test/auth.test.ts also fails), or the create path verifying a student.
  test("an unverified student is refused at sign-in (403 EMAIL_NOT_VERIFIED) with a fresh link, and gets in once the link is opened", async () => {
    const email = uniqueEmail("siswa");
    expect((await signUp(email)).status).toBe(200);
    const before = emailsTo(email).length;

    const refused = await attempt(email, PASSWORD);
    expect(refused.status).toBe(403);
    expect(refused.body?.code).toBe("EMAIL_NOT_VERIFIED");
    expect(await sessionsOf(email)).toBe(0);
    expect(emailsTo(email).length).toBe(before + 1); // a fresh verification link

    await call(linkIn(emailsTo(email).filter((m) => m.purpose === "verify-email").at(-1)!));
    expect((await attempt(email, PASSWORD)).status).toBe(200);
  });

  test("a super_admin cannot verify a student by creating an admin on their address: 409, and the student is untouched", async () => {
    const { cookie } = await boss();
    const email = uniqueEmail("siswa");
    await signUp(email, "the student's own password");
    const refused = await create(cookie, { email, role: "editor", password: "first password 123" });
    expect(refused.status).toBe(409);
    expect(await row(email)).toMatchObject({ role: "student", verified: 0 });
    expect((await attempt(email, "the student's own password")).status).toBe(403);
    expect((await attempt(email, "first password 123")).status).toBe(401);
  });

  test("the role of the row is fixed by the route: it makes admins, never a student, and 'student' is refused", async () => {
    const { cookie } = await boss();
    const email = uniqueEmail("bukan-admin");
    const res = await create(cookie, { email, role: "student", password: "first password 123" });
    expect(res.status).toBe(400);
    expect(await row(email)).toBeNull();
  });

  test("only a super_admin can make an admin at all: an editor of every area, a viewer and a student are refused", async () => {
    for (const role of ["student", "viewer", "editor"] as const) {
      const cookie = await signedInCookie(uniqueEmail(role), role, role === "editor" ? EVERY_AREA : []);
      const email = uniqueEmail("nope");
      expect((await create(cookie, { email, role: "super_admin", password: "first password 123" })).status).toBe(403);
      expect(await row(email)).toBeNull();
    }
  });
});

describe("the other flows keep their answers for admins", () => {
  async function neutral(email: string, path: string, json: Record<string, unknown>) {
    const res = await call(path, { method: "POST", json: { email, ...json } });
    return { status: res.status, body: await res.json() };
  }

  test("asking to resend the verification email: a verified admin gets the same answer as an address nobody has, and nothing is mailed", async () => {
    const { cookie } = await boss();
    const email = uniqueEmail("pw");
    await create(cookie, { email, role: "editor", password: "first password 123" });
    const unknown = uniqueEmail("nobody");

    const known = await neutral(email, "/api/auth/send-verification-email", {});
    const none = await neutral(unknown, "/api/auth/send-verification-email", {});
    expect(known).toEqual(none);
    expect(known.status).toBe(200);
    expect(emailsTo(email)).toEqual([]);
    expect(emailsTo(unknown)).toEqual([]);
  });

  test("forgot password: the same answer for an admin and for an address nobody has; only the real admin gets the email, and the new password works", async () => {
    const { cookie } = await boss();
    const email = uniqueEmail("pw");
    await create(cookie, { email, role: "editor", password: "first password 123" });
    const unknown = uniqueEmail("nobody");

    const known = await neutral(email, "/api/auth/request-password-reset", { redirectTo: "/reset-password" });
    const none = await neutral(unknown, "/api/auth/request-password-reset", { redirectTo: "/reset-password" });
    expect(known).toEqual(none);
    expect(emailsTo(unknown)).toEqual([]);
    const token = resetTokenIn(emailsTo(email).find((m) => m.purpose === "reset-password")!);
    expect((await call("/api/auth/reset-password", { method: "POST", json: { token, newPassword: "a brand new passphrase 42" } })).status).toBe(200);
    expect((await attempt(email, "first password 123")).status).toBe(401);
    expect((await attempt(email, "a brand new passphrase 42")).status).toBe(200);
    expect((await row(email))?.verified).toBe(1);
  });

  describe("Google sign-in (the policy is unchanged: it links only to a local account whose address is verified)", () => {
    test("an admin made with a password is verified, so Google links to it, and the role is not touched", async () => {
      const { cookie } = await boss();
      const email = uniqueEmail("pw");
      await create(cookie, { email, role: "editor", password: "first password 123" });
      const res = await signInWithGoogle({ email, email_verified: true });
      expect(res.status).toBe(302);
      expect(cookiesOf(res)).toContain("session_token=");
      expect(await accountsOf(email)).toEqual(["credential", "google"]);
      expect(await row(email)).toMatchObject({ role: "editor", verified: 1 });
    });

    test("an address Google does not call verified is still refused for an admin", async () => {
      const { cookie } = await boss();
      const email = uniqueEmail("pw");
      await create(cookie, { email, role: "editor", password: "first password 123" });
      const res = await signInWithGoogle({ email, email_verified: false });
      expect(res.headers.get("location")).toMatch(/^\/auth\/error\?error=/);
      expect(cookiesOf(res)).not.toContain("session_token");
      expect(await accountsOf(email)).toEqual(["credential"]);
    });

    test("an invitation nobody has opened is not an account Google can link to: the invitee accepts first", async () => {
      const { cookie } = await boss();
      const email = uniqueEmail("invitee");
      await create(cookie, { email, role: "super_admin" });
      const res = await signInWithGoogle({ email, email_verified: true });
      expect(res.headers.get("location")).toMatch(/^\/auth\/error\?error=/);
      expect(cookiesOf(res)).not.toContain("session_token");
      expect(await accountsOf(email)).toEqual([]);
      expect(await row(email)).toMatchObject({ role: "super_admin", verified: 0 });
    });
  });
});

describe("migration 0011 on rows made before it", () => {
  // The Worker never leaves an admin with an account and an unverified address any more, but rows made under the old
  // rule (created with a password, link never opened) can exist in a database that was migrated up to 0010.
  // Negative check: remove the migration's last statement.
  test("an admin who has a way in is verified, and nobody else is: an invitation, a student, someone already verified", async () => {
    const legacy = {
      editor: await insertSuperAdmin({ role: "editor", verified: false, email: uniqueEmail("old-editor") }),
      superAdmin: await insertSuperAdmin({ verified: false, email: uniqueEmail("old-super") }),
      google: await insertSuperAdmin({ role: "viewer", verified: false, account: "google", email: uniqueEmail("old-google") }),
      deactivated: await insertSuperAdmin({ role: "viewer", verified: false, deactivated: true, email: uniqueEmail("old-off") }),
      invitation: await insertSuperAdmin({ role: "viewer", verified: false, account: false, email: uniqueEmail("old-invite") }),
      student: await insertSuperAdmin({ role: "student", verified: false, email: uniqueEmail("old-student") }),
      fine: await insertSuperAdmin({ role: "editor", email: uniqueEmail("old-fine") }),
    };
    const verified = async (id: string) => (await env.DB.prepare("SELECT email_verified AS v FROM users WHERE id = ?").bind(id).first<{ v: number }>())!.v;

    // What `wrangler d1 migrations apply` does with the file, statement by statement (the view is dropped and made again).
    for (const statement of migration.split("--> statement-breakpoint")) await env.DB.prepare(statement.trim()).run();

    expect(await verified(legacy.editor)).toBe(1);
    expect(await verified(legacy.superAdmin)).toBe(1);
    expect(await verified(legacy.google)).toBe(1);
    expect(await verified(legacy.deactivated)).toBe(1); // reactivated, they would be refused otherwise
    expect(await verified(legacy.invitation)).toBe(0); // an invitation is verified by opening its link, not by a migration
    expect(await verified(legacy.student)).toBe(0); // students verify
    expect(await verified(legacy.fine)).toBe(1);
    // The view is the one the migration made: the old super_admin counts, the invitation does not.
    const signable = (await env.DB.prepare("SELECT id FROM signable_super_admins").all<{ id: string }>()).results.map((r) => r.id);
    expect(signable).toEqual([legacy.superAdmin]);
  });

  test("the view is replaced, not added to: its text does not ask for the address, and the trigger still reads it by name", async () => {
    const view = await env.DB.prepare("SELECT sql FROM sqlite_master WHERE type = 'view' AND name = 'signable_super_admins'").first<{ sql: string }>();
    expect(view?.sql).not.toMatch(/email_verified/i);
    const trigger = await env.DB.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'users_keep_one_super_admin'").first<{ sql: string }>();
    expect(trigger?.sql).toContain("signable_super_admins");
  });
});
