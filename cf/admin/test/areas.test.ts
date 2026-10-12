import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import type { GrantableArea } from "../src/auth/permissions";
import { call, cookiesOf, createVerifiedUser, grantArea, setRole, signedInCookie, signIn, uniqueEmail } from "./helpers";

const announcement = { title: "Pendaftaran Dibuka", body: "Daftar sekarang melalui halaman Gabung Siswa.", severity: "info", active: true };

async function grantsOf(userId: string): Promise<{ area: string; granted_by: string | null; granted_at: number }[]> {
  const { results } = await env.DB.prepare("SELECT area, granted_by, granted_at FROM admin_area_grants WHERE user_id = ? ORDER BY area")
    .bind(userId)
    .all<{ area: string; granted_by: string | null; granted_at: number }>();
  return results;
}

async function auditRows() {
  const { results } = await env.DB.prepare("SELECT actor_email, action, resource_type, resource_id, metadata FROM audit_log ORDER BY created_at").all<{
    actor_email: string;
    action: string;
    resource_type: string;
    resource_id: string;
    metadata: string;
  }>();
  return results;
}

const putAreas = (id: string, cookie: string, json: unknown) => call(`/api/admin/users/${id}/areas`, { method: "PUT", cookie, json });

describe("/api/me: role and areas, computed by the same rules as the guards", () => {
  test("401 without a session", async () => {
    expect((await call("/api/me")).status).toBe(401);
  });

  const cases: { label: string; role: "student" | "viewer" | "editor" | "super_admin"; grants: GrantableArea[]; granted: string[]; visible: string[]; writable: string[] }[] = [
    { label: "student", role: "student", grants: [], granted: [], visible: [], writable: [] },
    { label: "viewer", role: "viewer", grants: [], granted: [], visible: ["pendaftaran", "komunikasi", "konten"], writable: [] },
    // A stray grant row on a viewer is not reported as a right.
    { label: "viewer with a stray grant", role: "viewer", grants: ["konten"], granted: [], visible: ["pendaftaran", "komunikasi", "konten"], writable: [] },
    // An editor sees only what they were granted: visible equals granted equals writable.
    { label: "editor with no grants sees no area at all", role: "editor", grants: [], granted: [], visible: [], writable: [] },
    { label: "editor granted pendaftaran", role: "editor", grants: ["pendaftaran"], granted: ["pendaftaran"], visible: ["pendaftaran"], writable: ["pendaftaran"] },
    { label: "editor granted komunikasi", role: "editor", grants: ["komunikasi"], granted: ["komunikasi"], visible: ["komunikasi"], writable: ["komunikasi"] },
    { label: "editor granted konten", role: "editor", grants: ["konten"], granted: ["konten"], visible: ["konten"], writable: ["konten"] },
    {
      label: "editor granted pendaftaran and konten",
      role: "editor",
      grants: ["konten", "pendaftaran"],
      granted: ["konten", "pendaftaran"].sort(),
      visible: ["pendaftaran", "konten"],
      writable: ["pendaftaran", "konten"],
    },
    { label: "super_admin", role: "super_admin", grants: [], granted: [], visible: ["pendaftaran", "komunikasi", "konten", "sistem"], writable: ["pendaftaran", "komunikasi", "konten", "sistem"] },
  ];

  for (const { label, role, grants, granted, visible, writable } of cases) {
    test(label, async () => {
      const email = uniqueEmail(role);
      const cookie = await signedInCookie(email, role, grants);
      const body = (await (await call("/api/me", { cookie })).json()) as { user: { email: string; role: string }; areas: { granted: string[]; visible: string[]; writable: string[] } };
      expect(body.user).toMatchObject({ email, role });
      expect([...body.areas.granted].sort()).toEqual([...granted].sort());
      expect(body.areas.visible).toEqual(visible);
      expect(body.areas.writable).toEqual(writable);
      // For an editor the visible areas are exactly the granted ones: nothing is shown that cannot be used.
      if (role === "editor") expect([...body.areas.visible].sort()).toEqual([...body.areas.granted].sort());
    });
  }

  test("a change of role or grants shows on the very next call", async () => {
    const email = uniqueEmail("live");
    const userId = await createVerifiedUser(email, "editor");
    const cookie = cookiesOf(await signIn(email));
    const areas = async () => {
      const { visible, writable } = ((await (await call("/api/me", { cookie })).json()) as { areas: { visible: string[]; writable: string[] } }).areas;
      return { visible, writable };
    };

    expect(await areas()).toEqual({ visible: [], writable: [] });
    await grantArea(userId, "komunikasi");
    expect(await areas()).toEqual({ visible: ["komunikasi"], writable: ["komunikasi"] });
    await setRole(email, "super_admin");
    expect(await areas()).toEqual({ visible: ["pendaftaran", "komunikasi", "konten", "sistem"], writable: ["pendaftaran", "komunikasi", "konten", "sistem"] });
    await setRole(email, "viewer");
    expect(await areas()).toEqual({ visible: ["pendaftaran", "komunikasi", "konten"], writable: [] });
  });
});

describe("unknown roles", () => {
  test("the database refuses a role that does not exist (users_role_check)", async () => {
    const email = uniqueEmail("odd");
    await createVerifiedUser(email);
    await expect(env.DB.prepare("UPDATE users SET role = 'owner' WHERE email = ?").bind(email).run()).rejects.toThrow(/CHECK constraint failed/);
  });

  test("defence in depth: if such a row ever got in, it is a student with no areas", async () => {
    const email = uniqueEmail("odd");
    const userId = await createVerifiedUser(email);
    const cookie = cookiesOf(await signIn(email));
    await grantArea(userId, "konten"); // even a grant does not help a role that does not exist
    // The CHECK is switched off for this one statement only, to simulate a row from a newer or hand-edited schema.
    await env.DB.batch([
      env.DB.prepare("PRAGMA ignore_check_constraints = ON"),
      env.DB.prepare("UPDATE users SET role = 'owner' WHERE email = ?").bind(email),
      env.DB.prepare("PRAGMA ignore_check_constraints = OFF"),
    ]);
    expect((await call("/api/admin/announcements", { cookie })).status).toBe(403);
    expect((await call("/api/admin/users", { cookie })).status).toBe(403);
    const me = (await (await call("/api/me", { cookie })).json()) as { user: { role: string }; areas: { visible: string[] } };
    expect(me.user.role).toBe("student");
    expect(me.areas.visible).toEqual([]);
  });
});

describe("Sistem area: only super_admin reaches the admin users routes", () => {
  test("nobody signed in: 401", async () => {
    expect((await call("/api/admin/users")).status).toBe(401);
    expect((await call("/api/admin/users/x/areas", { method: "PUT", json: { areas: [] } })).status).toBe(401);
  });

  const denied = [
    { label: "student", role: "student", grants: [] },
    { label: "viewer", role: "viewer", grants: [] },
    { label: "viewer with every grant", role: "viewer", grants: ["pendaftaran", "komunikasi", "konten"] },
    { label: "editor with no grants", role: "editor", grants: [] },
    { label: "editor with every grant", role: "editor", grants: ["pendaftaran", "komunikasi", "konten"] },
  ] as const;

  for (const { label, role, grants } of denied) {
    test(`${label}: 403 on read and on write, nothing changes`, async () => {
      const email = uniqueEmail(role);
      const cookie = await signedInCookie(email, role, grants);
      const target = await createVerifiedUser(uniqueEmail("target"), "editor");

      expect((await call("/api/admin/users", { cookie })).status).toBe(403);
      expect((await putAreas(target, cookie, { areas: ["konten"] })).status).toBe(403);
      expect(await grantsOf(target)).toEqual([]);
      expect(await auditRows()).toEqual([]);
    });
  }

  test("an editor cannot give themselves areas", async () => {
    const email = uniqueEmail("greedy");
    const cookie = await signedInCookie(email, "editor");
    const self = (await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>())!.id;
    expect((await putAreas(self, cookie, { areas: ["pendaftaran", "komunikasi", "konten"] })).status).toBe(403);
    expect(await grantsOf(self)).toEqual([]);
  });

  test("a super_admin demoted in the database loses Sistem on the next request", async () => {
    const email = uniqueEmail("boss");
    const cookie = await signedInCookie(email, "super_admin");
    expect((await call("/api/admin/users", { cookie })).status).toBe(200);
    await setRole(email, "editor");
    expect((await call("/api/admin/users", { cookie })).status).toBe(403);
  });

  test("GET lists admin accounts with their areas, never students, never a stray grant as a right", async () => {
    const cookie = await signedInCookie(uniqueEmail("boss"), "super_admin");
    const editorEmail = uniqueEmail("editor");
    const editorId = await createVerifiedUser(editorEmail, "editor", ["konten", "pendaftaran"]);
    const viewerEmail = uniqueEmail("viewer");
    await createVerifiedUser(viewerEmail, "viewer", ["konten"]); // stray row
    const studentEmail = uniqueEmail("student");
    await createVerifiedUser(studentEmail, "student");

    const res = await call("/api/admin/users", { cookie });
    expect(res.status).toBe(200);
    const { users } = (await res.json()) as { users: { id: string; email: string; role: string; areas: string[] }[] };
    const byEmail = new Map(users.map((u) => [u.email, u]));
    expect(byEmail.has(studentEmail)).toBe(false);
    expect(byEmail.get(editorEmail)).toMatchObject({ id: editorId, role: "editor", areas: ["pendaftaran", "konten"] });
    expect(byEmail.get(viewerEmail)).toMatchObject({ role: "viewer", areas: [] });
    expect(users.map((u) => u.email)).toEqual([...users.map((u) => u.email)].sort());
    // Nothing secret leaves with the list.
    expect(JSON.stringify(users)).not.toMatch(/password|token|hash/i);
  });
});

describe("PUT /api/admin/users/:id/areas (grant and revoke)", () => {
  test("sets the areas, records who granted them, and writes one audit row", async () => {
    const adminEmail = uniqueEmail("boss");
    const cookie = await signedInCookie(adminEmail, "super_admin");
    const adminId = (await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(adminEmail).first<{ id: string }>())!.id;
    const target = await createVerifiedUser(uniqueEmail("editor"), "editor");

    const res = await putAreas(target, cookie, { areas: ["konten", "pendaftaran"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: { id: target, role: "editor", areas: ["pendaftaran", "konten"] } });

    const rows = await grantsOf(target);
    expect(rows.map((r) => r.area)).toEqual(["konten", "pendaftaran"]);
    expect(rows.every((r) => r.granted_by === adminId)).toBe(true);

    const audit = await auditRows();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_email: adminEmail, action: "admin.update", resource_type: "admin_user", resource_id: target });
    expect(JSON.parse(audit[0]!.metadata)).toEqual({ field: "areas", before: [], after: ["pendaftaran", "konten"] });
  });

  test("a grant takes effect on the editor's very next request, and so does a revocation", async () => {
    const boss = await signedInCookie(uniqueEmail("boss"), "super_admin");
    const editorEmail = uniqueEmail("editor");
    const editorId = await createVerifiedUser(editorEmail, "editor");
    const editor = cookiesOf(await signIn(editorEmail));
    const post = () => call("/api/admin/announcements", { method: "POST", cookie: editor, json: announcement });

    expect((await post()).status).toBe(403);
    expect((await putAreas(editorId, boss, { areas: ["komunikasi"] })).status).toBe(200);
    expect((await post()).status).toBe(201);
    expect((await putAreas(editorId, boss, { areas: ["konten"] })).status).toBe(200); // komunikasi replaced by konten
    expect((await post()).status).toBe(403);
    expect((await call("/api/admin/announcements", { cookie: editor })).status).toBe(403); // and the area's reads go with it
    expect((await putAreas(editorId, boss, { areas: ["komunikasi", "konten"] })).status).toBe(200);
    expect((await post()).status).toBe(201);
    expect((await call("/api/admin/announcements", { cookie: editor })).status).toBe(200);
    expect((await putAreas(editorId, boss, { areas: [] })).status).toBe(200);
    expect((await post()).status).toBe(403);
    expect((await call("/api/admin/announcements", { cookie: editor })).status).toBe(403);
  });

  test("is idempotent: the same set again changes nothing and writes no audit row; untouched grants keep their history", async () => {
    const boss = await signedInCookie(uniqueEmail("boss"), "super_admin");
    const editor = await createVerifiedUser(uniqueEmail("editor"), "editor");
    await putAreas(editor, boss, { areas: ["konten", "komunikasi"] });
    const first = await grantsOf(editor);
    expect(await auditRows()).toHaveLength(1);

    expect((await putAreas(editor, boss, { areas: ["komunikasi", "konten"] })).status).toBe(200);
    expect(await grantsOf(editor)).toEqual(first);
    expect(await auditRows()).toHaveLength(1);

    // Swap one area: the area that stays keeps its granted_at and granted_by.
    expect((await putAreas(editor, boss, { areas: ["komunikasi", "pendaftaran"] })).status).toBe(200);
    const after = await grantsOf(editor);
    expect(after.map((r) => r.area)).toEqual(["komunikasi", "pendaftaran"]);
    expect(after[0]).toEqual(first.find((r) => r.area === "komunikasi"));
    const audit = await auditRows();
    expect(audit).toHaveLength(2);
    expect(JSON.parse(audit[1]!.metadata)).toEqual({ field: "areas", before: ["komunikasi", "konten"], after: ["pendaftaran", "komunikasi"] });
  });

  test("duplicates in the request are folded", async () => {
    const boss = await signedInCookie(uniqueEmail("boss"), "super_admin");
    const editor = await createVerifiedUser(uniqueEmail("editor"), "editor");
    const res = await putAreas(editor, boss, { areas: ["konten", "konten"] });
    expect(res.status).toBe(200);
    expect((await grantsOf(editor)).map((r) => r.area)).toEqual(["konten"]);
  });

  test("Sistem cannot be granted, nor any unknown area; a bad body writes nothing", async () => {
    const boss = await signedInCookie(uniqueEmail("boss"), "super_admin");
    const editor = await createVerifiedUser(uniqueEmail("editor"), "editor");
    for (const body of [
      { areas: ["sistem"] },
      { areas: ["konten", "sistem"] },
      { areas: ["keuangan"] },
      { areas: ["Konten"] },
      { areas: "konten" },
      { areas: [null] },
      { areas: ["konten", "konten", "konten", "konten"] }, // more than there are areas
      {},
      [],
      "konten",
    ]) {
      const res = await putAreas(editor, boss, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid" });
    }
    expect(await grantsOf(editor)).toEqual([]);
    expect(await auditRows()).toEqual([]);
  });

  test("a body that is not JSON is refused (this is what stops a cross-site form post)", async () => {
    const boss = await signedInCookie(uniqueEmail("boss"), "super_admin");
    const editor = await createVerifiedUser(uniqueEmail("editor"), "editor");
    const path = `/api/admin/users/${editor}/areas`;
    const form = await call(path, { method: "PUT", cookie: boss, headers: { "content-type": "application/x-www-form-urlencoded" }, body: "areas=konten" });
    const plain = await call(path, { method: "PUT", cookie: boss, headers: { "content-type": "text/plain" }, body: JSON.stringify({ areas: ["konten"] }) });
    const broken = await call(path, { method: "PUT", cookie: boss, headers: { "content-type": "application/json" }, body: "{nope" });
    expect([form.status, plain.status, broken.status]).toEqual([415, 415, 415]);
    expect(await grantsOf(editor)).toEqual([]);
  });

  test("only an existing editor can hold grants: 404 for nobody, 409 for a viewer, a student or a super_admin", async () => {
    const boss = await signedInCookie(uniqueEmail("boss"), "super_admin");
    expect((await putAreas(crypto.randomUUID(), boss, { areas: ["konten"] })).status).toBe(404);
    for (const role of ["viewer", "student", "super_admin"] as const) {
      const id = await createVerifiedUser(uniqueEmail(role), role);
      const res = await putAreas(id, boss, { areas: ["konten"] });
      expect(res.status, role).toBe(409);
      expect(await res.json()).toEqual({ error: "not_editor" });
      expect(await grantsOf(id)).toEqual([]);
    }
    expect(await auditRows()).toEqual([]);
  });

  test("a grant and its audit row commit together or not at all", async () => {
    const boss = await signedInCookie(uniqueEmail("boss"), "super_admin");
    const editor = await createVerifiedUser(uniqueEmail("editor"), "editor");
    await env.DB.exec("ALTER TABLE audit_log RENAME TO audit_log_gone");
    try {
      const res = await putAreas(editor, boss, { areas: ["konten"] });
      expect(res.status).toBe(500);
      expect(await grantsOf(editor)).toEqual([]);
    } finally {
      await env.DB.exec("ALTER TABLE audit_log_gone RENAME TO audit_log");
    }
  });

  test("demoting an editor leaves their grants in place but inert; promoting back restores them", async () => {
    const boss = await signedInCookie(uniqueEmail("boss"), "super_admin");
    const email = uniqueEmail("editor");
    const id = await createVerifiedUser(email, "editor");
    const cookie = cookiesOf(await signIn(email));
    await putAreas(id, boss, { areas: ["komunikasi"] });
    const post = () => call("/api/admin/announcements", { method: "POST", cookie, json: announcement });

    expect((await post()).status).toBe(201);
    await setRole(email, "viewer");
    expect((await post()).status).toBe(403); // inert: a viewer is read-only whatever rows exist
    expect((await grantsOf(id)).map((r) => r.area)).toEqual(["komunikasi"]);
    await setRole(email, "editor");
    expect((await post()).status).toBe(201);
  });
});
