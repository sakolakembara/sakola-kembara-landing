import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { UserRole } from "../src/auth/roles";
import {
  call,
  CAPTCHA,
  cookiesOf,
  createVerifiedUser,
  emails,
  emailsTo,
  ensureAnotherSuperAdmin,
  fakeNetwork,
  linkIn,
  ORIGIN,
  PASSWORD,
  productionLike,
  resetTokenIn,
  signedInCookie,
  signIn,
  signInWithGoogle,
  uniqueEmail,
} from "./helpers";

// src/api/admin-users.ts: Pengaturan (area `sistem`, super_admin only).

afterEach(() => {
  vi.restoreAllMocks();
});

interface ApiUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  areas: string[];
  status: "active" | "invited" | "deactivated";
  emailVerified: boolean;
  deactivatedAt: string | null;
  createdAt: string;
}

async function superAdmin() {
  const email = uniqueEmail("boss");
  const cookie = await signedInCookie(email, "super_admin");
  const id = (await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>())!.id;
  return { email, cookie, id };
}

/** A session made in production mode: its cookie has the __Host- name, which a development-mode worker would not read. Needs fakeNetwork() first (Siteverify). */
async function productionCookie(email: string) {
  const res = await call("/api/auth/sign-in/email", { method: "POST", json: { email, password: PASSWORD }, env: productionLike, captcha: CAPTCHA });
  if (res.status !== 200) throw new Error(`production sign-in failed: ${res.status}`);
  return cookiesOf(res);
}

const post = (cookie: string, path: string, json: unknown = {}) => call(path, { method: "POST", cookie, json });
const patch = (cookie: string, id: string, json: unknown) => call(`/api/admin/users/${id}`, { method: "PATCH", cookie, json });

async function invite(cookie: string, role: UserRole = "editor", email = uniqueEmail("invitee"), extra: Record<string, unknown> = {}) {
  const res = await post(cookie, "/api/admin/users", { email, name: "Guru Baru", role, ...extra });
  return { res, email, body: (await res.clone().json().catch(() => ({}))) as { user?: ApiUser; email?: { sent: boolean; kind: string }; error?: string } };
}

async function audit(action?: string) {
  const { results } = await env.DB.prepare(
    action
      ? "SELECT actor_id, actor_email, action, resource_type, resource_id, metadata FROM audit_log WHERE action = ? ORDER BY created_at, rowid"
      : "SELECT actor_id, actor_email, action, resource_type, resource_id, metadata FROM audit_log ORDER BY created_at, rowid",
  )
    .bind(...(action ? [action] : []))
    .all<{ actor_id: string; actor_email: string; action: string; resource_type: string; resource_id: string; metadata: string | null }>();
  return results.map((row) => ({ ...row, metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null }));
}

async function userRow(email: string) {
  return env.DB.prepare("SELECT id, role, email_verified AS verified, deactivated_at AS deactivatedAt FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string; role: string; verified: number; deactivatedAt: number | null }>();
}

async function count(table: string): Promise<number> {
  return (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
}

describe("only a super_admin may use these routes", () => {
  const roles: { label: string; role?: UserRole; areas?: ("pendaftaran" | "komunikasi" | "konten")[] }[] = [
    { label: "a student", role: "student" },
    { label: "a viewer", role: "viewer" },
    { label: "an editor with every area", role: "editor", areas: ["pendaftaran", "komunikasi", "konten"] },
  ];

  for (const { label, role, areas } of roles) {
    test(`${label}: 403 on every route, and nothing changes`, async () => {
      const target = await superAdmin();
      const victim = (await invite(target.cookie, "editor")).body.user!;
      const cookie = await signedInCookie(uniqueEmail(role), role, areas);
      const before = await count("audit_log");
      emails().length = 0;

      const calls = [
        call("/api/admin/users", { cookie }),
        post(cookie, "/api/admin/users", { email: uniqueEmail(), role: "viewer" }),
        patch(cookie, victim.id, { role: "super_admin" }),
        post(cookie, `/api/admin/users/${victim.id}/deactivate`),
        post(cookie, `/api/admin/users/${victim.id}/reactivate`),
        post(cookie, `/api/admin/users/${victim.id}/resend-invite`),
      ];
      expect((await Promise.all(calls)).map((res) => res.status)).toEqual([403, 403, 403, 403, 403, 403]);
      expect(await count("audit_log")).toBe(before);
      expect(emails()).toHaveLength(0);
      expect((await userRow(victim.email))?.role).toBe("editor");
    });
  }

  test("nobody signed in: 401", async () => {
    for (const res of [
      await call("/api/admin/users"),
      await call("/api/admin/users", { method: "POST", json: { email: uniqueEmail(), role: "viewer" } }),
      await call("/api/admin/users/x", { method: "PATCH", json: { role: "viewer" } }),
      await call("/api/admin/users/x/deactivate", { method: "POST", json: {} }),
    ]) {
      expect(res.status).toBe(401);
    }
  });
});

describe("creating an admin by invitation", () => {
  test("201: the account exists unverified and without a password, an invite email goes out, and the audit row names the actor", async () => {
    const boss = await superAdmin();
    const { res, email, body } = await invite(boss.cookie, "editor", uniqueEmail("Guru"), { name: "  Guru Baru  " });

    expect(res.status).toBe(201);
    expect(body.email).toEqual({ sent: true, kind: "invite" });
    expect(body.user).toMatchObject({ email: email.toLowerCase(), name: "Guru Baru", role: "editor", areas: [], status: "invited", emailVerified: false, deactivatedAt: null });
    expect(body.user!.id).toBeTruthy();
    const row = await userRow(email.toLowerCase());
    expect(row).toMatchObject({ role: "editor", verified: 0, deactivatedAt: null });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM account WHERE user_id = ?").bind(row!.id).first<{ n: number }>()).toEqual({ n: 0 });

    const sent = emailsTo(email.toLowerCase());
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ purpose: "admin-invite", subject: "Undangan admin Sakola Kembara" });
    expect(sent[0]!.text).toContain("menjadi Editor");
    expect(sent[0]!.text).toContain("berlaku selama 7 hari");

    const rows = await audit("admin.create");
    expect(rows).toEqual([
      {
        actor_id: boss.id,
        actor_email: boss.email,
        action: "admin.create",
        resource_type: "admin_user",
        resource_id: body.user!.id,
        metadata: { email: email.toLowerCase(), role: "editor", mode: "invite" },
      },
    ]);
  });

  test("the invitee follows the link, chooses a password, and signs in as the role they were invited with", async () => {
    const boss = await superAdmin();
    const { email } = await invite(boss.cookie, "viewer");
    const message = emailsTo(email)[0]!;

    const landing = await call(linkIn(message));
    expect(landing.status).toBe(302);
    const target = new URL(landing.headers.get("location")!, ORIGIN);
    expect(target.pathname).toBe("/reset-password");
    expect(target.searchParams.get("invite")).toBe("1");
    const token = target.searchParams.get("token")!;
    expect(token).toBe(resetTokenIn(message));

    expect((await signIn(email, "the password they chose")).status).toBe(401); // nothing to sign in with yet
    expect((await call("/api/auth/reset-password", { method: "POST", json: { token, newPassword: "the password they chose" } })).status).toBe(200);

    expect((await userRow(email))?.verified).toBe(1); // the link proved the mailbox
    const res = await signIn(email, "the password they chose");
    expect(res.status).toBe(200);
    const me = (await (await call("/api/me", { cookie: cookiesOf(res) })).json()) as { user: { role: string }; areas: { writable: string[]; visible: string[] } };
    expect(me.user.role).toBe("viewer");
    expect(me.areas.writable).toEqual([]);
    expect(me.areas.visible).toEqual(["pendaftaran", "komunikasi", "konten"]);

    // Single use.
    expect((await call("/api/auth/reset-password", { method: "POST", json: { token, newPassword: "another password" } })).status).toBe(400);
    // Now the list shows an active admin.
    const list = (await (await call("/api/admin/users", { cookie: boss.cookie })).json()) as { users: ApiUser[] };
    expect(list.users.find((user) => user.email === email)).toMatchObject({ status: "active", emailVerified: true });
  });

  test("the link lives 7 days (not the 30 minutes of a reset), and is stored hashed", async () => {
    const boss = await superAdmin();
    const { email } = await invite(boss.cookie);
    const token = resetTokenIn(emailsTo(email)[0]!);
    const row = await env.DB.prepare("SELECT identifier, expires_at AS expiresAt FROM verification").first<{ identifier: string; expiresAt: number }>();
    const days = (row!.expiresAt - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7);
    expect(row!.identifier).not.toContain(token);
  });

  test("an expired invite link does nothing", async () => {
    const boss = await superAdmin();
    const { email } = await invite(boss.cookie);
    const token = resetTokenIn(emailsTo(email)[0]!);
    await env.DB.prepare("UPDATE verification SET expires_at = ?").bind(Date.now() - 1000).run();
    expect((await call("/api/auth/reset-password", { method: "POST", json: { token, newPassword: "a fine password" } })).status).toBe(400);
    expect((await userRow(email))?.verified).toBe(0);
  });

  test("the role is any admin role; the name defaults to the part before the @; the address is lowercased", async () => {
    const boss = await superAdmin();
    for (const role of ["viewer", "editor", "super_admin"] as const) {
      const email = uniqueEmail("Role");
      const res = await post(boss.cookie, "/api/admin/users", { email: email.toUpperCase(), role });
      expect(res.status, role).toBe(201);
      const { user } = (await res.json()) as { user: ApiUser };
      expect(user).toMatchObject({ role, email: email.toLowerCase(), name: email.split("@")[0]!.toLowerCase(), areas: [] });
    }
  });

  test("an address that already has an account (any role) is a 409 and nothing is sent", async () => {
    const boss = await superAdmin();
    const student = uniqueEmail("student");
    await createVerifiedUser(student, "student");
    emails().length = 0;
    const before = await count("audit_log");

    for (const email of [student, student.toUpperCase(), boss.email]) {
      const res = await post(boss.cookie, "/api/admin/users", { email, role: "editor" });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: "email_taken", message: "Email ini sudah terdaftar.", fieldErrors: { email: ["Email sudah digunakan"] } });
    }
    expect(emails()).toHaveLength(0);
    expect(await count("audit_log")).toBe(before);
    expect((await userRow(student))?.role).toBe("student"); // not promoted
  });

  test("validation: legacy rules and messages, and nothing is created", async () => {
    const boss = await superAdmin();
    const before = await count("users");
    const bad = async (json: Record<string, unknown>) => {
      const res = await post(boss.cookie, "/api/admin/users", { email: uniqueEmail(), role: "viewer", ...json });
      expect(res.status).toBe(400);
      return ((await res.json()) as { fieldErrors: Record<string, string[]> }).fieldErrors;
    };
    expect((await bad({ role: "student" })).role).toBeDefined(); // students are not admins
    expect((await bad({ role: "owner" })).role).toBeDefined();
    expect((await bad({ role: undefined })).role).toBeDefined();
    expect((await bad({ email: "nope" })).email).toContain("Format email tidak valid");
    expect((await bad({ email: "a@b" })).email).toBeDefined();
    expect((await bad({ email: `${"a".repeat(200)}@example.test` })).email).toEqual(["Email terlalu panjang"]);
    expect((await bad({ name: "x".repeat(121) })).name).toEqual(["Maksimal 120 karakter"]);
    expect((await bad({ password: "short" })).password).toEqual(["Password minimal 8 karakter"]);
    expect(await count("users")).toBe(before);
    expect((await call("/api/admin/users", { method: "POST", cookie: boss.cookie, headers: { "content-type": "text/plain" }, body: "{}" })).status).toBe(415);
  });

  test("a fifth invite to nobody in particular is fine; the same mailbox cannot be mailed more than 3 times a minute", async () => {
    const boss = await superAdmin();
    const first = await invite(boss.cookie);
    const id = first.body.user!.id;
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await post(boss.cookie, `/api/admin/users/${id}/resend-invite`)).status);
    // 1 (the invite) + 2 resends = 3 allowed; the 3rd and 4th resend are refused.
    expect(statuses).toEqual([200, 200, 429, 429]);
  });
});

describe("creating an admin with a first password", () => {
  test("the account can sign in once the verification email is confirmed; the password is never in the audit row", async () => {
    const boss = await superAdmin();
    const { res, email, body } = await invite(boss.cookie, "editor", uniqueEmail("pw"), { password: "first password 123" });
    expect(res.status).toBe(201);
    expect(body.email).toEqual({ sent: true, kind: "verification" });
    expect(body.user).toMatchObject({ status: "active", emailVerified: false });

    const account = await env.DB.prepare("SELECT a.password FROM account a JOIN users u ON u.id = a.user_id WHERE u.email = ?").bind(email).first<{ password: string }>();
    expect(account?.password).toMatch(/^pbkdf2-sha256\$100000\$/);
    expect(JSON.stringify(await audit("admin.create"))).not.toContain("first password 123");
    expect((await audit("admin.create"))[0]!.metadata).toEqual({ email, role: "editor", mode: "password" });

    // Not verified on the super_admin's word: a typo in the address must not give someone an admin account.
    expect((await signIn(email, "first password 123")).status).toBe(403);
    const message = emailsTo(email).find((m) => m.purpose === "verify-email")!;
    expect(message).toBeDefined();
    expect((await call(linkIn(message))).headers.get("location")).toBe("/login?verified=1");
    expect((await signIn(email, "first password 123")).status).toBe(200);
  });
});

describe("when the email cannot be sent", () => {
  const noProvider = { ENVIRONMENT: "production", RESEND_API_KEY: undefined, EMAIL_FROM: undefined };

  // Negative check: make the invite ignore the result of sendEmail in src/api/admin-users.ts.
  test("production without a provider: 503 and nothing is created", async () => {
    fakeNetwork();
    const boss = await superAdmin();
    const cookie = await productionCookie(boss.email);
    const res = await call("/api/admin/users", { method: "POST", cookie, json: { email: uniqueEmail(), role: "editor" }, env: noProvider });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "email_unavailable" });
    expect(await count("users")).toBe(1); // just the boss
  });

  test("a provider that answers an error: 502 with the created user, never a plain success; resending later works", async () => {
    const network = fakeNetwork();
    const boss = await superAdmin();
    const cookie = await productionCookie(boss.email);
    network.resendStatus = 500;
    const email = uniqueEmail();
    const res = await call("/api/admin/users", { method: "POST", cookie, json: { email, role: "editor" }, env: productionLike });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; reason: string; user: ApiUser; message: string };
    expect(body).toMatchObject({ error: "email_failed", reason: "provider_error", user: { email, status: "invited" } });
    expect(body.message).toContain("Akun sudah dibuat");
    expect((await userRow(email))?.role).toBe("editor"); // the account exists

    network.resendStatus = 200;
    const again = await call(`/api/admin/users/${body.user.id}/resend-invite`, { method: "POST", cookie, json: {}, env: productionLike });
    expect(again.status).toBe(200);
    expect(network.resend.at(-1)!.to).toBe(email);
  });

  test("Resend's quota (429) is reported as such", async () => {
    const network = fakeNetwork();
    const boss = await superAdmin();
    const cookie = await productionCookie(boss.email);
    network.resendStatus = 429;
    const res = await call("/api/admin/users", { method: "POST", cookie, json: { email: uniqueEmail(), role: "viewer" }, env: productionLike });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "email_rate_limited", message: expect.stringContaining("Batas pengiriman email") });
  });

  test("a failed resend is a 502 too", async () => {
    const network = fakeNetwork();
    const boss = await superAdmin();
    const { body } = await invite(boss.cookie);
    const cookie = await productionCookie(boss.email);
    network.resendStatus = 503;
    const res = await call(`/api/admin/users/${body.user!.id}/resend-invite`, { method: "POST", cookie, json: {}, env: productionLike });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "email_failed" });
  });

  test("production without a provider: resend is a 503", async () => {
    fakeNetwork();
    const boss = await superAdmin();
    const { body } = await invite(boss.cookie);
    const cookie = await productionCookie(boss.email);
    const res = await call(`/api/admin/users/${body.user!.id}/resend-invite`, { method: "POST", cookie, json: {}, env: noProvider });
    expect(res.status).toBe(503);
  });
});

describe("the list", () => {
  test("admins only, with their state, areas for editors, sorted by email", async () => {
    const boss = await superAdmin();
    const editor = await invite(boss.cookie, "editor", `b-${uniqueEmail("e")}`);
    const viewer = await invite(boss.cookie, "viewer", `a-${uniqueEmail("v")}`);
    await createVerifiedUser(uniqueEmail("student"), "student");
    await call(`/api/admin/users/${editor.body.user!.id}/areas`, { method: "PUT", cookie: boss.cookie, json: { areas: ["konten", "pendaftaran"] } });
    await post(boss.cookie, `/api/admin/users/${viewer.body.user!.id}/deactivate`);

    const { users } = (await (await call("/api/admin/users", { cookie: boss.cookie })).json()) as { users: ApiUser[] };
    expect(users.map((user) => user.email)).toEqual([...users.map((user) => user.email)].sort());
    expect(users.every((user) => ["viewer", "editor", "super_admin"].includes(user.role))).toBe(true);
    expect(users.find((user) => user.id === editor.body.user!.id)).toMatchObject({ role: "editor", areas: ["pendaftaran", "konten"], status: "invited" });
    expect(users.find((user) => user.id === viewer.body.user!.id)).toMatchObject({ status: "deactivated", deactivatedAt: expect.any(String) });
    expect(users.find((user) => user.id === boss.id)).toMatchObject({ role: "super_admin", status: "active", emailVerified: true });
    const text = JSON.stringify(users);
    expect(text).not.toContain("password");
    expect(text).not.toContain("pbkdf2");
  });
});

describe("changing a role", () => {
  test("viewer, editor and super_admin in turn, each change audited with before and after", async () => {
    const boss = await superAdmin();
    const { body } = await invite(boss.cookie, "viewer");
    const id = body.user!.id;

    for (const role of ["editor", "super_admin", "viewer"] as const) {
      const res = await patch(boss.cookie, id, { role });
      expect(res.status, role).toBe(200);
      expect(((await res.json()) as { user: ApiUser }).user.role).toBe(role);
    }
    const rows = await audit("admin.update");
    expect(rows.map((row) => row.metadata)).toEqual([
      { email: body.user!.email, roleFrom: "viewer", roleTo: "editor" },
      { email: body.user!.email, roleFrom: "editor", roleTo: "super_admin" },
      { email: body.user!.email, roleFrom: "super_admin", roleTo: "viewer" },
    ]);
    expect(rows.every((row) => row.actor_id === boss.id && row.actor_email === boss.email && row.resource_id === id)).toBe(true);
  });

  test("the change applies on the very next request of the person affected", async () => {
    const boss = await superAdmin();
    const email = uniqueEmail("promoted");
    const cookie = await signedInCookie(email, "editor", ["komunikasi"]);
    const id = (await userRow(email))!.id;
    const announce = () => call("/api/announcements", { method: "POST", cookie, json: { title: "Pengumuman uji", body: "Isi pengumuman uji.", severity: "info", active: false } });

    expect((await announce()).status).toBe(201);
    expect((await patch(boss.cookie, id, { role: "viewer" })).status).toBe(200);
    expect((await announce()).status).toBe(403);
  });

  test("moving away from editor removes the area grants in the same change, so they cannot come back by surprise", async () => {
    const boss = await superAdmin();
    const { body } = await invite(boss.cookie, "editor");
    const id = body.user!.id;
    await call(`/api/admin/users/${id}/areas`, { method: "PUT", cookie: boss.cookie, json: { areas: ["konten", "komunikasi"] } });

    expect((await patch(boss.cookie, id, { role: "viewer" })).status).toBe(200);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM admin_area_grants WHERE user_id = ?").bind(id).first<{ n: number }>()).toEqual({ n: 0 });
    expect((await audit("admin.update")).at(-1)!.metadata).toMatchObject({ roleFrom: "editor", roleTo: "viewer", areasRemoved: ["komunikasi", "konten"] });

    const back = (await (await patch(boss.cookie, id, { role: "editor" })).json()) as { user: ApiUser };
    expect(back.user.areas).toEqual([]);
  });

  test("a name change alone is allowed and audited without a role", async () => {
    const boss = await superAdmin();
    const { body } = await invite(boss.cookie, "viewer");
    const res = await patch(boss.cookie, body.user!.id, { name: "  Nama Baru  " });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: ApiUser }).user.name).toBe("Nama Baru");
    expect((await audit("admin.update")).at(-1)!.metadata).toEqual({ email: body.user!.email, nameChanged: true });
  });

  test("asking for what is already true changes nothing and writes no audit row", async () => {
    const boss = await superAdmin();
    const { body } = await invite(boss.cookie, "editor");
    const before = await count("audit_log");
    const res = await patch(boss.cookie, body.user!.id, { role: "editor" });
    expect(res.status).toBe(200);
    expect(await count("audit_log")).toBe(before);
  });

  test("bad input: a student role, an unknown role, an empty body, an empty name", async () => {
    const boss = await superAdmin();
    const { body } = await invite(boss.cookie, "viewer");
    for (const json of [{ role: "student" }, { role: "owner" }, {}, { name: "" }, { name: "x".repeat(121) }]) {
      expect((await patch(boss.cookie, body.user!.id, json)).status, JSON.stringify(json)).toBe(400);
    }
    expect((await userRow(body.user!.email))?.role).toBe("viewer");
  });

  test("unknown ids and students are a 404: this API manages admins", async () => {
    const boss = await superAdmin();
    const student = uniqueEmail("student");
    await createVerifiedUser(student, "student");
    expect((await patch(boss.cookie, "no-such-id", { role: "viewer" })).status).toBe(404);
    expect((await patch(boss.cookie, (await userRow(student))!.id, { role: "editor" })).status).toBe(404);
    expect((await post(boss.cookie, `/api/admin/users/${(await userRow(student))!.id}/deactivate`)).status).toBe(404);
    expect((await userRow(student))?.role).toBe("student");
  });

  describe("the last super_admin", () => {
    const LEGACY = "Tidak dapat menurunkan peran super admin terakhir. Tambah super admin lain terlebih dahulu.";

    // Negative check: remove the guard (the pre-check and the trigger) for demotion.
    test("cannot be demoted: 409 with the legacy message, the role stays, no audit row", async () => {
      const boss = await superAdmin();
      const before = await count("audit_log");
      const res = await patch(boss.cookie, boss.id, { role: "viewer" });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "last_super_admin", message: LEGACY });
      expect((await userRow(boss.email))?.role).toBe("super_admin");
      expect(await count("audit_log")).toBe(before);
    });

    test("with a second super_admin one of them can step down, and then the other is the last", async () => {
      const boss = await superAdmin();
      const second = await invite(boss.cookie, "super_admin");
      expect((await patch(boss.cookie, second.body.user!.id, { role: "viewer" })).status).toBe(200); // not the last
      // Now `boss` is alone again.
      expect((await patch(boss.cookie, boss.id, { role: "editor" })).status).toBe(409);
    });

    test("a super_admin who is deactivated does not count as 'another'", async () => {
      const boss = await superAdmin();
      const second = await invite(boss.cookie, "super_admin");
      expect((await post(boss.cookie, `/api/admin/users/${second.body.user!.id}/deactivate`)).status).toBe(200);
      expect((await patch(boss.cookie, boss.id, { role: "viewer" })).status).toBe(409);
    });

    test("the database holds the line too: a plain UPDATE of the only super_admin is refused by the trigger", async () => {
      const boss = await superAdmin();
      await expect(env.DB.prepare("UPDATE users SET role = 'viewer' WHERE id = ?").bind(boss.id).run()).rejects.toThrow(/last_super_admin/);
      await expect(env.DB.prepare("UPDATE users SET deactivated_at = ? WHERE id = ?").bind(Date.now(), boss.id).run()).rejects.toThrow(/last_super_admin/);
      expect((await userRow(boss.email))?.role).toBe("super_admin");
      // With another active super_admin the same statement is allowed.
      await ensureAnotherSuperAdmin(boss.id);
      await env.DB.prepare("UPDATE users SET role = 'viewer' WHERE id = ?").bind(boss.id).run();
      expect((await userRow(boss.email))?.role).toBe("viewer");
    });

    // Negative check: remove the `mentions(error, "last_super_admin")` mapping, or the trigger in migration 0006.
    test("two super_admins stepping down at the same moment: one wins, the other gets a 409 from the trigger, one stays", async () => {
      const first = await superAdmin();
      const secondEmail = uniqueEmail("boss2");
      const secondCookie = await signedInCookie(secondEmail, "super_admin");
      const secondId = (await userRow(secondEmail))!.id;

      // Both pass the friendly pre-check (each sees the other as active); only the trigger can tell.
      const results = await Promise.all([patch(first.cookie, secondId, { role: "viewer" }), patch(secondCookie, first.id, { role: "viewer" })]);
      expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
      const remaining = await env.DB.prepare("SELECT count(*) AS n FROM users WHERE role = 'super_admin' AND deactivated_at IS NULL").first<{ n: number }>();
      expect(remaining!.n).toBe(1);
    });
  });
});

describe("deactivating and reactivating", () => {
  test("a deactivated admin's sessions end now, sign-in is refused with the right password, and the audit says who", async () => {
    const boss = await superAdmin();
    const email = uniqueEmail("leaving");
    const cookie = await signedInCookie(email, "editor", ["konten"]);
    const phone = cookiesOf(await signIn(email));
    const id = (await userRow(email))!.id;
    expect((await call("/api/me", { cookie })).status).toBe(200);

    const res = await post(boss.cookie, `/api/admin/users/${id}/deactivate`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: ApiUser }).user).toMatchObject({ status: "deactivated", role: "editor" });

    expect((await call("/api/me", { cookie })).status).toBe(401);
    expect((await call("/api/me", { cookie: phone })).status).toBe(401);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM session WHERE user_id = ?").bind(id).first<{ n: number }>()).toEqual({ n: 0 });

    const refused = await signIn(email);
    expect(refused.status).toBe(403);
    expect(refused.headers.getSetCookie()).toEqual([]);
    expect(await refused.json()).toMatchObject({ code: "ACCOUNT_DEACTIVATED", message: "Akun ini dinonaktifkan. Hubungi super admin." });
    expect((await signIn(email, "wrong")).status).toBe(401); // a wrong password still says nothing about the state

    expect(await audit("admin.deactivate")).toEqual([
      { actor_id: boss.id, actor_email: boss.email, action: "admin.deactivate", resource_type: "admin_user", resource_id: id, metadata: { email, role: "editor" } },
    ]);
  });

  // Negative check: remove the session hook in src/auth/factory.ts, or the sessions delete.
  test("Google sign-in is refused for a deactivated account too, and no session is created", async () => {
    const boss = await superAdmin();
    const email = uniqueEmail("google-admin");
    await createVerifiedUser(email, "editor");
    const id = (await userRow(email))!.id;
    await post(boss.cookie, `/api/admin/users/${id}/deactivate`);

    const res = await signInWithGoogle({ email, email_verified: true });
    expect(cookiesOf(res)).not.toContain("session_token");
    expect(await env.DB.prepare("SELECT count(*) AS n FROM session WHERE user_id = ?").bind(id).first<{ n: number }>()).toEqual({ n: 0 });
    vi.restoreAllMocks();

    // Reactivated: Google works again.
    await post(boss.cookie, `/api/admin/users/${id}/reactivate`);
    const again = await signInWithGoogle({ email, email_verified: true });
    expect(cookiesOf(again)).toContain("session_token=");
  });

  test("a session that survived (a sign-in that raced the deactivation) is still refused", async () => {
    const email = uniqueEmail("raced");
    const cookie = await signedInCookie(email, "viewer");
    await ensureAnotherSuperAdmin("none");
    // Set the flag without going through the API, which would have deleted the session.
    await env.DB.prepare("UPDATE users SET deactivated_at = ? WHERE email = ?").bind(Date.now(), email).run();
    expect((await call("/api/me", { cookie })).status).toBe(401);
    expect((await call("/api/announcements", { cookie })).status).toBe(401);
  });

  test("outstanding reset and invite links die with the account, and no reset email is sent to it", async () => {
    const boss = await superAdmin();
    const email = uniqueEmail("leaving");
    await createVerifiedUser(email, "editor");
    const id = (await userRow(email))!.id;
    await call("/api/auth/request-password-reset", { method: "POST", json: { email, redirectTo: "/reset-password" } });
    const token = resetTokenIn(emailsTo(email).find((m) => m.purpose === "reset-password")!);
    emails().length = 0;

    await post(boss.cookie, `/api/admin/users/${id}/deactivate`);
    expect((await call("/api/auth/reset-password", { method: "POST", json: { token, newPassword: "a fine new password" } })).status).toBe(400);
    const request = await call("/api/auth/request-password-reset", { method: "POST", json: { email, redirectTo: "/reset-password" } });
    expect(request.status).toBe(200); // the same answer as for anyone
    expect(emailsTo(email)).toHaveLength(0);
    expect((await signIn(email, PASSWORD)).status).toBe(403);
  });

  test("a deactivated invitee's link is dead, and they cannot be re-invited until reactivated", async () => {
    const boss = await superAdmin();
    const { body, email } = await invite(boss.cookie, "viewer");
    const token = resetTokenIn(emailsTo(email)[0]!);
    await post(boss.cookie, `/api/admin/users/${body.user!.id}/deactivate`);
    expect((await call("/api/auth/reset-password", { method: "POST", json: { token, newPassword: "a fine new password" } })).status).toBe(400);
    expect((await post(boss.cookie, `/api/admin/users/${body.user!.id}/resend-invite`)).status).toBe(409);
  });

  test("reactivating lets them sign in again; the audit says who; sessions were not restored", async () => {
    const boss = await superAdmin();
    const email = uniqueEmail("back");
    const oldCookie = await signedInCookie(email, "viewer");
    const id = (await userRow(email))!.id;
    await post(boss.cookie, `/api/admin/users/${id}/deactivate`);

    const res = await post(boss.cookie, `/api/admin/users/${id}/reactivate`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: ApiUser }).user).toMatchObject({ status: "active", deactivatedAt: null });
    expect((await call("/api/me", { cookie: oldCookie })).status).toBe(401);
    expect((await signIn(email)).status).toBe(200);
    expect((await audit("admin.reactivate"))[0]).toMatchObject({ actor_id: boss.id, resource_id: id, metadata: { email, role: "viewer" } });
  });

  test("both are idempotent: the second call changes nothing and writes no audit row", async () => {
    const boss = await superAdmin();
    const { body } = await invite(boss.cookie, "viewer");
    const id = body.user!.id;

    expect((await post(boss.cookie, `/api/admin/users/${id}/reactivate`)).status).toBe(200); // not deactivated: nothing to do
    expect(await audit("admin.reactivate")).toHaveLength(0);
    await post(boss.cookie, `/api/admin/users/${id}/deactivate`);
    const stamp = (await userRow(body.user!.email))!.deactivatedAt;
    expect((await post(boss.cookie, `/api/admin/users/${id}/deactivate`)).status).toBe(200);
    expect(await audit("admin.deactivate")).toHaveLength(1);
    expect((await userRow(body.user!.email))!.deactivatedAt).toBe(stamp);
  });

  test("nobody can deactivate themselves", async () => {
    const boss = await superAdmin();
    await invite(boss.cookie, "super_admin"); // so it is not also "the last one"
    const res = await post(boss.cookie, `/api/admin/users/${boss.id}/deactivate`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "cannot_deactivate_self", message: "Tidak dapat menonaktifkan akun sendiri." });
    expect((await userRow(boss.email))?.deactivatedAt).toBeNull();
  });

  // Through the API the only way to hit "the last active super_admin" is a race: the actor is itself an
  // active super_admin, so there is always another one at the time of the check. The trigger decides.
  test("two super_admins deactivating each other at the same moment: one wins, the other gets a 409, one stays active", async () => {
    const first = await superAdmin();
    const secondEmail = uniqueEmail("boss2");
    const secondCookie = await signedInCookie(secondEmail, "super_admin");
    const secondId = (await userRow(secondEmail))!.id;

    const results = await Promise.all([post(first.cookie, `/api/admin/users/${secondId}/deactivate`), post(secondCookie, `/api/admin/users/${first.id}/deactivate`)]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    const loser = results.find((res) => res.status === 409)!;
    expect(await loser.json()).toMatchObject({ error: "last_super_admin" });
    const active = await env.DB.prepare("SELECT count(*) AS n FROM users WHERE role = 'super_admin' AND deactivated_at IS NULL").first<{ n: number }>();
    expect(active!.n).toBe(1);
    expect(await audit("admin.deactivate")).toHaveLength(1); // the refused one left no audit row
  });

  test("the stand-alone check: with every other super_admin deactivated, the one left cannot be deactivated or demoted", async () => {
    const boss = await superAdmin();
    const second = await invite(boss.cookie, "super_admin");
    await post(boss.cookie, `/api/admin/users/${second.body.user!.id}/deactivate`);
    // `boss` is the only active super_admin: a second admin who is only an editor cannot touch that, and boss cannot step down.
    expect((await patch(boss.cookie, boss.id, { role: "editor" })).status).toBe(409);
    expect((await userRow(boss.email))?.role).toBe("super_admin");
  });
});

describe("resending an invitation", () => {
  test("sends a new link; the old one stops working; audited", async () => {
    const boss = await superAdmin();
    const { body, email } = await invite(boss.cookie, "editor");
    const oldToken = resetTokenIn(emailsTo(email)[0]!);

    const res = await post(boss.cookie, `/api/admin/users/${body.user!.id}/resend-invite`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ user: { status: "invited" }, email: { sent: true, kind: "invite" } });
    const sent = emailsTo(email).filter((m) => m.purpose === "admin-invite");
    expect(sent).toHaveLength(2);
    const newToken = resetTokenIn(sent[1]!);
    expect(newToken).not.toBe(oldToken);

    expect((await call("/api/auth/reset-password", { method: "POST", json: { token: oldToken, newPassword: "a fine password" } })).status).toBe(400);
    expect((await call("/api/auth/reset-password", { method: "POST", json: { token: newToken, newPassword: "a fine password" } })).status).toBe(200);
    expect((await audit("admin.invite_resend"))[0]).toMatchObject({ actor_id: boss.id, resource_id: body.user!.id, metadata: { email, role: "editor" } });
  });

  test("only while the invitation is pending: an admin who can already sign in is a 409, an unknown id a 404", async () => {
    const boss = await superAdmin();
    const { body, email } = await invite(boss.cookie, "viewer");
    await call("/api/auth/reset-password", { method: "POST", json: { token: resetTokenIn(emailsTo(email)[0]!), newPassword: "a fine password" } });

    const done = await post(boss.cookie, `/api/admin/users/${body.user!.id}/resend-invite`);
    expect(done.status).toBe(409);
    expect(await done.json()).toMatchObject({ error: "not_pending_invite" });
    expect((await post(boss.cookie, `/api/admin/users/${boss.id}/resend-invite`)).status).toBe(409);
    expect((await post(boss.cookie, "/api/admin/users/nobody/resend-invite")).status).toBe(404);
  });
});

describe("every mutation is audited with the actor, and the log never holds a secret", () => {
  test("a whole life cycle", async () => {
    const boss = await superAdmin();
    const { body, email } = await invite(boss.cookie, "viewer", uniqueEmail("life"), { password: "initial password 99" });
    const id = body.user!.id;
    await patch(boss.cookie, id, { role: "editor" });
    await call(`/api/admin/users/${id}/areas`, { method: "PUT", cookie: boss.cookie, json: { areas: ["konten"] } });
    await post(boss.cookie, `/api/admin/users/${id}/deactivate`);
    await post(boss.cookie, `/api/admin/users/${id}/reactivate`);

    const rows = (await audit()).filter((row) => row.resource_id === id);
    expect(rows.map((row) => row.action)).toEqual(["admin.create", "admin.update", "admin.update", "admin.deactivate", "admin.reactivate"]);
    expect(rows.every((row) => row.actor_id === boss.id && row.actor_email === boss.email && row.resource_type === "admin_user")).toBe(true);
    const text = JSON.stringify(rows);
    for (const secret of ["initial password 99", "pbkdf2", "token", email.split("@")[0]! + "XXX"]) expect(text).not.toContain(secret);
  });

  test("a failed change leaves no audit row (the change and its row commit together)", async () => {
    const boss = await superAdmin();
    const { body } = await invite(boss.cookie, "viewer");
    const before = await count("audit_log");
    await env.DB.exec("ALTER TABLE audit_log RENAME TO audit_log_gone");
    try {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await patch(boss.cookie, body.user!.id, { role: "editor" });
      expect(res.status).toBe(500);
    } finally {
      await env.DB.exec("ALTER TABLE audit_log_gone RENAME TO audit_log");
    }
    expect((await userRow(body.user!.email))?.role).toBe("viewer"); // rolled back with it
    expect(await count("audit_log")).toBe(before);
    void CAPTCHA;
  });
});
