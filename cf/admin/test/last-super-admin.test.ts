import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import type { UserRole } from "../src/auth/roles";
import { call, cookiesOf, createVerifiedUser, emailsTo, insertSuperAdmin, linkIn, PASSWORD, resetTokenIn, signedInCookie, signIn, uniqueEmail } from "./helpers";
import { instrumentD1 } from "./public-helpers";

// "The last super_admin" is the last one who can sign in (SAKEM-087, migration 0010): not deactivated, email
// verified, with an account. An invitation nobody has opened is not one. The definition is the view
// `signable_super_admins`, read by the trigger and by the API alike, so these tests go through both: the HTTP layer
// (the friendly 409 and the race where only the trigger can tell) and the database (a plain UPDATE).

const USERS = "/api/admin/users";
const DEMOTE = "Tidak dapat menurunkan peran super admin terakhir. Tambah super admin lain terlebih dahulu.";
const DEACTIVATE = "Tidak dapat menonaktifkan super admin terakhir. Tambah super admin lain terlebih dahulu.";

/** A super_admin who can sign in, with a session: registered, verified, promoted (the account of a normal sign-up). */
async function boss(label = "boss") {
  const email = uniqueEmail(label);
  const cookie = await signedInCookie(email, "super_admin");
  const id = (await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>())!.id;
  return { email, cookie, id };
}

const post = (cookie: string, path: string, json: unknown = {}) => call(path, { method: "POST", cookie, json });
const patch = (cookie: string, id: string, json: unknown) => call(`${USERS}/${id}`, { method: "PATCH", cookie, json });

/** Invites an admin the way Pengaturan does (no password): the account exists, unverified, with nothing to sign in with. */
async function invite(cookie: string, role: UserRole = "super_admin") {
  const email = uniqueEmail("invitee");
  const res = await post(cookie, USERS, { email, name: "Calon Admin", role });
  expect(res.status).toBe(201);
  const id = ((await res.json()) as { item: { id: string } }).item.id;
  return { email, id };
}

/** The invitee opens the emailed link and chooses a password: what makes an invitation count. Returns their session cookie. */
async function acceptInvite(email: string) {
  const mail = emailsTo(email).find((message) => message.purpose === "admin-invite");
  const reset = await call("/api/auth/reset-password", { method: "POST", json: { token: resetTokenIn(mail!), newPassword: PASSWORD } });
  expect(reset.status).toBe(200);
  const signedIn = await signIn(email);
  expect(signedIn.status).toBe(200);
  return cookiesOf(signedIn);
}

const signable = async () => (await env.DB.prepare("SELECT count(*) AS n FROM signable_super_admins").first<{ n: number }>())!.n;
const roleOf = async (id: string) => (await env.DB.prepare("SELECT role FROM users WHERE id = ?").bind(id).first<{ role: string }>())!.role;
const auditCount = async (action: string) => (await env.DB.prepare("SELECT count(*) AS n FROM audit_log WHERE action = ?").bind(action).first<{ n: number }>())!.n;

describe("who is a super_admin who can sign in", () => {
  // Each way of not being able to sign in, and the ones that can.
  const states: { label: string; make: () => Promise<string>; counts: boolean }[] = [
    { label: "a password and a verified address", make: () => insertSuperAdmin(), counts: true },
    { label: "only a linked Google account, address verified", make: () => insertSuperAdmin({ account: "google" }), counts: true },
    { label: "an invitation nobody opened (not verified, no account)", make: () => insertSuperAdmin({ verified: false, account: false }), counts: false },
    { label: "a verified address and no account", make: () => insertSuperAdmin({ account: false }), counts: false },
    { label: "an account but the address is not verified yet (created with a password)", make: () => insertSuperAdmin({ verified: false }), counts: false },
    { label: "deactivated", make: () => insertSuperAdmin({ deactivated: true }), counts: false },
    { label: "an editor with an account (another role)", make: () => insertSuperAdmin({ role: "editor" }), counts: false },
    { label: "a student with an account (another role)", make: () => insertSuperAdmin({ role: "student" }), counts: false },
  ];

  test.each(states)("the view: $label counts: $counts", async ({ make, counts }) => {
    const id = await make();
    const row = await env.DB.prepare("SELECT 1 AS found FROM signable_super_admins WHERE id = ?").bind(id).first();
    expect(row !== null).toBe(counts);
  });

  // Negative check: the view counts invitations again (any of its three conditions removed), or the trigger ignores it.
  test.each(states)("the database: with $label as the other one, the only signable super_admin can step down: $counts", async ({ make, counts }) => {
    const only = await insertSuperAdmin();
    await make();
    const step = env.DB.prepare("UPDATE users SET role = 'viewer' WHERE id = ?").bind(only).run();
    if (counts) {
      await step;
      expect(await roleOf(only)).toBe("viewer");
    } else {
      await expect(step).rejects.toThrow(/last_super_admin/);
      expect(await roleOf(only)).toBe("super_admin");
    }
  });

  test.each(states)("the API: with $label as the other one, the only signable super_admin steps down (200) or is refused (409): $counts", async ({ make, counts }) => {
    const me = await boss();
    await make();
    const res = await patch(me.cookie, me.id, { role: "viewer" });
    expect(res.status).toBe(counts ? 200 : 409);
    expect(await roleOf(me.id)).toBe(counts ? "viewer" : "super_admin");
  });
});

describe("the only super_admin who can sign in, with an invitation waiting (the bug of SAKEM-087)", () => {
  test("cannot step down through PATCH: 409, the legacy sentence, nothing written, and the API did not even try", async () => {
    const me = await boss();
    await invite(me.cookie);
    const { db, stats } = instrumentD1(env.DB);

    const res = await call(`${USERS}/${me.id}`, { method: "PATCH", cookie: me.cookie, json: { role: "viewer" }, env: { DB: db } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "last_super_admin", message: DEMOTE });
    expect(await roleOf(me.id)).toBe("super_admin");
    expect(await auditCount("admin.update")).toBe(0);
    // Answered from a read: no write was sent to the database (the trigger is the second line, not the first).
    expect(stats.statements.filter((sql) => /update\s+"users"/i.test(sql))).toEqual([]);
  });

  test("cannot step down through the edit form either: 409 with the role field, and the form's other changes are not saved", async () => {
    const me = await boss();
    await invite(me.cookie);
    const one = await call(`${USERS}/${me.id}`, { cookie: me.cookie });
    const etag = one.headers.get("etag")!;
    const { db, stats } = instrumentD1(env.DB);

    const res = await call(`${USERS}/${me.id}`, {
      method: "PUT",
      cookie: me.cookie,
      headers: { "If-Match": etag },
      json: { name: "Nama Baru", role: "editor", areas: ["konten"] },
      env: { DB: db },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "last_super_admin", message: DEMOTE, fields: { role: "Minimal satu super admin harus tersedia" } });
    expect(await roleOf(me.id)).toBe("super_admin");
    expect((await env.DB.prepare("SELECT name FROM users WHERE id = ?").bind(me.id).first<{ name: string }>())!.name).not.toBe("Nama Baru");
    expect(await env.DB.prepare("SELECT count(*) AS n FROM admin_area_grants WHERE user_id = ?").bind(me.id).first<{ n: number }>()).toEqual({ n: 0 });
    expect(stats.statements.filter((sql) => /update\s+"users"/i.test(sql))).toEqual([]);
  });

  test("cannot be deactivated: another super_admin whose own way in is gone is refused, with the legacy sentence", async () => {
    // Through HTTP the actor of a deactivation is itself a super_admin with a session, so there is normally
    // another one who can sign in. To reach the question, the actor loses their way in AFTER signing in (their
    // address un-verified straight in the table; their session stays valid, Better Auth does not look again).
    const actor = await boss("actor");
    const sole = await boss("sole");
    await env.DB.prepare("UPDATE users SET email_verified = 0 WHERE id = ?").bind(actor.id).run();
    await invite(sole.cookie); // an unopened invitation must not make the sole one removable
    expect(await signable()).toBe(1);
    const { db, stats } = instrumentD1(env.DB);

    const res = await call(`${USERS}/${sole.id}/deactivate`, { method: "POST", cookie: actor.cookie, json: {}, env: { DB: db } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "last_super_admin", message: DEACTIVATE });
    expect((await env.DB.prepare("SELECT deactivated_at AS at FROM users WHERE id = ?").bind(sole.id).first<{ at: number | null }>())!.at).toBeNull();
    expect(await env.DB.prepare("SELECT count(*) AS n FROM session WHERE user_id = ?").bind(sole.id).first<{ n: number }>()).toEqual({ n: 1 });
    expect(await auditCount("admin.deactivate")).toBe(0);
    expect(stats.statements.filter((sql) => /update\s+"users"/i.test(sql))).toEqual([]);
  });

  test("the database holds the line when the API is not asked: a plain UPDATE of role or deactivated_at is refused", async () => {
    const me = await boss();
    await invite(me.cookie);
    await expect(env.DB.prepare("UPDATE users SET role = 'viewer' WHERE id = ?").bind(me.id).run()).rejects.toThrow(/last_super_admin/);
    await expect(env.DB.prepare("UPDATE users SET deactivated_at = ? WHERE id = ?").bind(Date.now(), me.id).run()).rejects.toThrow(/last_super_admin/);
    await expect(env.DB.prepare("UPDATE users SET role = 'viewer', deactivated_at = ? WHERE id = ?").bind(Date.now(), me.id).run()).rejects.toThrow(/last_super_admin/);
    expect(await roleOf(me.id)).toBe("super_admin");
  });

  test("an update that does not take them out is allowed: a name, the same role", async () => {
    const me = await boss();
    await invite(me.cookie);
    await env.DB.prepare("UPDATE users SET role = 'super_admin', name = 'Nama Baru' WHERE id = ?").bind(me.id).run();
    expect((await env.DB.prepare("SELECT name FROM users WHERE id = ?").bind(me.id).first<{ name: string }>())!.name).toBe("Nama Baru");
  });

  test("there is no way to delete an admin through the API", async () => {
    const me = await boss();
    const pending = await invite(me.cookie);
    for (const id of [me.id, pending.id]) {
      const res = await call(`${USERS}/${id}`, { method: "DELETE", cookie: me.cookie });
      expect([404, 405]).toContain(res.status);
    }
    expect(await env.DB.prepare("SELECT count(*) AS n FROM users WHERE id IN (?, ?)").bind(me.id, pending.id).first<{ n: number }>()).toEqual({ n: 2 });
  });

  test("the one who cannot sign in anyway can be demoted or deactivated freely: it takes nobody away", async () => {
    const me = await boss();
    const first = await invite(me.cookie);
    const second = await invite(me.cookie);
    expect((await patch(me.cookie, first.id, { role: "viewer" })).status).toBe(200);
    expect(await roleOf(first.id)).toBe("viewer");
    expect((await post(me.cookie, `${USERS}/${second.id}/deactivate`)).status).toBe(200);
    // And the one who can sign in is still the last.
    expect(await signable()).toBe(1);
    expect((await patch(me.cookie, me.id, { role: "viewer" })).status).toBe(409);
  });
});

describe("the rule asks who the target is: someone who cannot sign in anyway takes nobody away", () => {
  // Negative check: the trigger no longer requires the changed row to be one who can sign in (or the API's `self`).
  test("with nobody able to sign in at all, an invitation can still be demoted or deactivated in the table", async () => {
    const a = await insertSuperAdmin({ verified: false, account: false });
    const b = await insertSuperAdmin({ verified: false, account: false });
    await env.DB.prepare("UPDATE users SET role = 'viewer' WHERE id = ?").bind(a).run();
    await env.DB.prepare("UPDATE users SET deactivated_at = ? WHERE id = ?").bind(Date.now(), b).run();
    expect(await roleOf(a)).toBe("viewer");
  });

  test("through the API too, whoever asks: an actor with a session but no way in of their own demotes an invitation (200)", async () => {
    const actor = await boss();
    const pending = await invite(actor.cookie);
    await env.DB.prepare("UPDATE users SET email_verified = 0 WHERE id = ?").bind(actor.id).run(); // nobody can sign in now
    expect(await signable()).toBe(0);
    expect((await patch(actor.cookie, pending.id, { role: "viewer" })).status).toBe(200);
    expect(await roleOf(pending.id)).toBe("viewer");
  });
});

describe("when the other one can sign in, one may step down", () => {
  test("an invitation counts from the moment it is accepted, and not before", async () => {
    const me = await boss();
    const pending = await invite(me.cookie);
    expect((await patch(me.cookie, me.id, { role: "viewer" })).status).toBe(409);

    const theirs = await acceptInvite(pending.email);
    // Opening the link made the address verified and created the account: that is the whole definition.
    expect(await signable()).toBe(2);

    expect((await patch(me.cookie, me.id, { role: "viewer" })).status).toBe(200);
    // Now the one who accepted is alone.
    expect((await patch(theirs, pending.id, { role: "editor" })).status).toBe(409);
    expect(await roleOf(pending.id)).toBe("super_admin");
  });

  test("one created with a password counts once the verification link is opened, not at creation", async () => {
    const me = await boss();
    const email = uniqueEmail("withpw");
    const created = await post(me.cookie, USERS, { email, name: "Dengan Password", role: "super_admin", password: "initial password 99" });
    expect(created.status).toBe(201);
    expect(await signable()).toBe(1); // the account exists, but sign-in is refused until the address is verified
    expect((await signIn(email, "initial password 99")).status).not.toBe(200);
    expect((await patch(me.cookie, me.id, { role: "viewer" })).status).toBe(409);

    await call(linkIn(emailsTo(email).find((message) => message.purpose === "verify-email")!));
    expect(await signable()).toBe(2);
    expect((await signIn(email, "initial password 99")).status).toBe(200);
    expect((await patch(me.cookie, me.id, { role: "viewer" })).status).toBe(200);
  });

  test("one who signs in with Google only counts", async () => {
    const me = await boss();
    await insertSuperAdmin({ account: "google" });
    expect((await patch(me.cookie, me.id, { role: "viewer" })).status).toBe(200);
  });

  test("a deactivated one does not count, and counts again when reactivated", async () => {
    const me = await boss();
    const other = await insertSuperAdmin();
    expect((await post(me.cookie, `${USERS}/${other}/deactivate`)).status).toBe(200); // not the last: me is signable
    expect((await patch(me.cookie, me.id, { role: "viewer" })).status).toBe(409);
    expect((await post(me.cookie, `${USERS}/${other}/reactivate`)).status).toBe(200);
    expect((await patch(me.cookie, me.id, { role: "viewer" })).status).toBe(200);
  });

  test("with two who can sign in either may deactivate the other, then the one left is the last", async () => {
    const me = await boss();
    const other = await insertSuperAdmin();
    expect((await post(me.cookie, `${USERS}/${other}/deactivate`)).status).toBe(200);
    expect(await signable()).toBe(1);
    // Nobody can deactivate themselves, so the last one is protected from the API twice over.
    const self = await post(me.cookie, `${USERS}/${me.id}/deactivate`);
    expect(self.status).toBe(409);
    expect(((await self.json()) as { error: string }).error).toBe("cannot_deactivate_self");
  });
});

describe("two at the same moment, with an invitation waiting as the tempting third", () => {
  // Under the old rule the invitation counted, so both requests passed and both succeeded: nobody could sign in.
  // Both pass the friendly read here too (each sees the other); only the trigger can tell.
  // Negative check: remove the trigger's use of the view, or the mapping of its error.
  test("two stepping down through PATCH: one 200, one 409, one stays", async () => {
    const first = await boss("first");
    const second = await boss("second");
    await invite(first.cookie);
    const results = await Promise.all([patch(first.cookie, second.id, { role: "viewer" }), patch(second.cookie, first.id, { role: "viewer" })]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(await (results.find((res) => res.status === 409)!).json()).toEqual({ error: "last_super_admin", message: DEMOTE });
    expect(await signable()).toBe(1);
    expect(await auditCount("admin.update")).toBe(1); // the refused one left no audit row
  });

  test("two stepping down through the edit form: one 200, one 409 with the role field, one stays", async () => {
    const first = await boss("first");
    const second = await boss("second");
    await invite(first.cookie);
    const a = await call(`${USERS}/${first.id}`, { cookie: first.cookie });
    const b = await call(`${USERS}/${second.id}`, { cookie: first.cookie });
    const form = (etag: string) => ({ "If-Match": etag });
    const results = await Promise.all([
      call(`${USERS}/${first.id}`, { method: "PUT", cookie: first.cookie, headers: form(a.headers.get("etag")!), json: { name: "A", role: "viewer", areas: [] } }),
      call(`${USERS}/${second.id}`, { method: "PUT", cookie: second.cookie, headers: form(b.headers.get("etag")!), json: { name: "B", role: "viewer", areas: [] } }),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(await (results.find((res) => res.status === 409)!).json()).toMatchObject({ error: "last_super_admin", message: DEMOTE, fields: { role: "Minimal satu super admin harus tersedia" } });
    expect(await signable()).toBe(1);
  });

  test("two deactivating each other: one 200, one 409, one stays", async () => {
    const first = await boss("first");
    const second = await boss("second");
    await invite(first.cookie);
    const results = await Promise.all([post(first.cookie, `${USERS}/${second.id}/deactivate`), post(second.cookie, `${USERS}/${first.id}/deactivate`)]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(await (results.find((res) => res.status === 409)!).json()).toEqual({ error: "last_super_admin", message: DEACTIVATE });
    expect(await signable()).toBe(1);
    expect(await auditCount("admin.deactivate")).toBe(1);
  });
});

describe("the people who can sign in are the ones who can open Pengaturan", () => {
  test("after every allowed change there is still a super_admin who can sign in and open it", async () => {
    // The point of the rule, end to end: step down only when the other can sign in, and then they can.
    const me = await boss();
    const pending = await invite(me.cookie);
    await acceptInvite(pending.email);
    expect((await patch(me.cookie, me.id, { role: "viewer" })).status).toBe(200);

    const again = await signIn(pending.email);
    expect(again.status).toBe(200);
    expect((await call(USERS, { cookie: cookiesOf(again) })).status).toBe(200);
    // The one who stepped down reads (a viewer) but Pengaturan is closed to them: the screen has a keeper.
    const demoted = await signIn(me.email);
    expect((await call(USERS, { cookie: cookiesOf(demoted) })).status).toBe(403);
  });

  test("a student who registered and verified is not a super_admin, however verified", async () => {
    await createVerifiedUser(uniqueEmail("student"), "student");
    expect(await signable()).toBe(0);
  });
});
