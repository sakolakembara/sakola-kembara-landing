import { env } from "cloudflare:workers";
import { describe, expect, test, vi } from "vitest";
import { createAnnouncementRoutes } from "../src/api/announcements";
import type { CrudDeps } from "../src/api/crud";
import type { ContentChange } from "../src/public/purge";
import { appAround, ifMatchOf } from "./crud-app";
import { call, cookiesOf, createVerifiedUser, grantArea, revokeArea, setRole, signedInCookie, signIn, uniqueEmail } from "./helpers";

// The reference screen of the admin CRUD convention (docs/cloudflare/admin-crud.md).
// What is generic (envelopes, the 409s, the audit transaction, clamping) is proved by
// test/crud-contract.test.ts on a throwaway resource; this file proves that the
// announcements are wired to it correctly and keep their legacy rules.

const LIST = "/api/admin/announcements";

const valid = {
  title: "Pendaftaran Angkatan 2026 Dibuka",
  body: "Daftar sekarang melalui halaman Gabung Siswa.",
  severity: "info",
  active: true,
};

async function seedAnnouncement(createdBy: string | null = null) {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO announcements (id, title, body, severity, active, created_by) VALUES (?, 'Seed', 'Isi seed', 'info', 0, ?)")
    .bind(id, createdBy)
    .run();
  return id;
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

async function count(table: string) {
  return (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
}

const ifMatch = (id: string) => ifMatchOf("announcements", id);

describe("announcements: who may do what (role guard matrix)", () => {
  test("nobody signed in: 401 on every route", async () => {
    const id = await seedAnnouncement();
    expect((await call(LIST)).status).toBe(401);
    expect((await call(`${LIST}/${id}`)).status).toBe(401);
    expect((await call(LIST, { method: "POST", json: valid })).status).toBe(401);
    expect((await call(`${LIST}/${id}`, { method: "PUT", json: valid })).status).toBe(401);
    expect((await call(`${LIST}/${id}`, { method: "DELETE" })).status).toBe(401);
    expect(await count("audit_log")).toBe(0);
  });

  // Announcements are the `komunikasi` area. An editor reads and writes them only when
  // granted `komunikasi`: an editor of other areas gets 403 on the read too (SAKEM-082).
  // Negative test (scripts/negative-checks.mjs): make the viewer rule or the area check
  // in src/auth/permissions.ts permissive, or give editors the old "read everywhere" rule,
  // and the viewer, stray-grant and wrong-area cases below fail.
  const cases = [
    { label: "student", role: "student", areas: [], read: 403, write: 403 },
    { label: "viewer", role: "viewer", areas: [], read: 200, write: 403 },
    // A grant row on a viewer is inert: viewer is read-only by role.
    { label: "viewer with a stray komunikasi grant", role: "viewer", areas: ["komunikasi"], read: 200, write: 403 },
    { label: "editor with no grants", role: "editor", areas: [], read: 403, write: 403 },
    { label: "editor granted other areas only", role: "editor", areas: ["pendaftaran", "konten"], read: 403, write: 403 },
    { label: "editor granted komunikasi", role: "editor", areas: ["komunikasi"], read: 200, write: "ok" },
    { label: "editor granted every area", role: "editor", areas: ["pendaftaran", "komunikasi", "konten"], read: 200, write: "ok" },
    { label: "super_admin", role: "super_admin", areas: [], read: 200, write: "ok" },
  ] as const;

  for (const { label, role, areas, read, write } of cases) {
    test(`${label}: read ${read}, write ${write === "ok" ? "allowed" : "403"}`, async () => {
      const email = uniqueEmail(role);
      const cookie = await signedInCookie(email, role, areas);
      const id = await seedAnnouncement();

      expect((await call(LIST, { cookie })).status).toBe(read);

      const created = await call(LIST, { method: "POST", cookie, json: valid });
      const updated = await call(`${LIST}/${id}`, { method: "PUT", cookie, headers: await ifMatch(id), json: { ...valid, title: "Judul baru" } });
      const deleted = await call(`${LIST}/${id}`, { method: "DELETE", cookie });

      if (write === "ok") {
        expect([created.status, updated.status, deleted.status]).toEqual([201, 200, 204]);
        expect((await auditRows()).map((r) => r.action)).toEqual(["announcement.create", "announcement.update", "announcement.delete"]);
      } else {
        expect([created.status, updated.status, deleted.status]).toEqual([403, 403, 403]);
        // A refused write changes nothing and leaves no audit row.
        expect(await count("announcements")).toBe(1);
        expect((await env.DB.prepare("SELECT title FROM announcements WHERE id = ?").bind(id).first<{ title: string }>())?.title).toBe("Seed");
        expect(await count("audit_log")).toBe(0);
      }
    });
  }

  test("a role changed in the database applies to the very next request", async () => {
    const email = uniqueEmail("demoted");
    const cookie = await signedInCookie(email, "editor", ["komunikasi"]);
    expect((await call(LIST, { method: "POST", cookie, json: valid })).status).toBe(201);

    await setRole(email, "viewer");
    expect((await call(LIST, { method: "POST", cookie, json: valid })).status).toBe(403);
    expect((await call(LIST, { cookie })).status).toBe(200);

    await setRole(email, "student");
    expect((await call(LIST, { cookie })).status).toBe(403);
  });

  test("a grant revoked or added applies to the very next request", async () => {
    const email = uniqueEmail("regranted");
    const userId = await createVerifiedUser(email, "editor", ["komunikasi"]);
    const cookie = cookiesOf(await signIn(email));
    expect((await call(LIST, { method: "POST", cookie, json: valid })).status).toBe(201);

    await revokeArea(userId, "komunikasi");
    expect((await call(LIST, { method: "POST", cookie, json: valid })).status).toBe(403);
    expect((await call(LIST, { cookie })).status).toBe(403); // the read goes with the grant

    await grantArea(userId, "komunikasi");
    expect((await call(LIST, { method: "POST", cookie, json: valid })).status).toBe(201);
    expect((await call(LIST, { cookie })).status).toBe(200);
  });

  test("a refused read says nothing about what is there", async () => {
    await seedAnnouncement();
    const cookie = await signedInCookie(uniqueEmail("elsewhere"), "editor", ["konten"]);
    const res = await call(LIST, { cookie });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });
});

describe("announcements: behaviour for an editor", () => {
  test("create returns the item, records who made it, and writes one audit row of field names", async () => {
    const email = uniqueEmail("editor");
    const cookie = await signedInCookie(email, "editor", ["komunikasi"]);

    const res = await call(LIST, {
      method: "POST",
      cookie,
      json: { ...valid, ctaLabel: "Daftar", ctaUrl: "/gabung-siswa", startsAt: "2026-11-01T00:00", endsAt: "2026-11-30T23:59" },
    });
    expect(res.status).toBe(201);
    const { item } = (await res.json()) as { item: Record<string, unknown> };
    expect(item).toMatchObject({ title: valid.title, severity: "info", active: true, ctaLabel: "Daftar", ctaUrl: "/gabung-siswa" });
    // An explicit field list: the author's id is not part of the answer.
    expect(Object.keys(item).sort()).toEqual(["active", "body", "createdAt", "ctaLabel", "ctaUrl", "endsAt", "id", "severity", "startsAt", "title", "updatedAt"]);
    expect(res.headers.get("etag")).toBe(`"${item.updatedAt}"`);

    const row = await env.DB.prepare("SELECT created_by, starts_at FROM announcements WHERE id = ?").bind(item.id).first<{ created_by: string; starts_at: number }>();
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
    expect(row?.created_by).toBe(user?.id);

    const audit = await auditRows();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_email: email, action: "announcement.create", resource_type: "announcement", resource_id: item.id });
    // Names only, plus the title as the non-personal label; never the body.
    expect(JSON.parse(audit[0]!.metadata)).toEqual({
      fields: ["title", "body", "severity", "ctaLabel", "ctaUrl", "active", "startsAt", "endsAt"],
      label: valid.title,
    });
    expect(audit[0]!.metadata).not.toContain(valid.body);
  });

  test("the list is newest first, as an envelope", async () => {
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    await env.DB.prepare("INSERT INTO announcements (id, title, body, created_at) VALUES ('a', 'Lama', 'Isi lama', 1000), ('b', 'Baru', 'Isi baru', 2000)").run();
    const body = (await (await call(LIST, { cookie })).json()) as { items: { title: string }[]; page: number; pageSize: number; total: number };
    expect(body.items.map((a) => a.title)).toEqual(["Baru", "Lama"]);
    expect(body).toMatchObject({ page: 1, pageSize: 20, total: 2 });
  });

  test("the list filters by severity and active, searches title and body, and sorts by a whitelist", async () => {
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    await env.DB.prepare(
      "INSERT INTO announcements (id, title, body, severity, active, created_at) VALUES ('a', 'Alpha', 'Isi satu', 'info', 1, 1000), ('b', 'Beta', 'cari-aku di sini', 'urgent', 0, 2000), ('c', 'Gamma', 'Isi tiga', 'urgent', 1, 3000)",
    ).run();
    const titles = async (query: string) => ((await (await call(`${LIST}${query}`, { cookie })).json()) as { items: { title: string }[] }).items.map((a) => a.title);

    expect(await titles("?severity=urgent")).toEqual(["Gamma", "Beta"]);
    expect(await titles("?severity=urgent&active=true")).toEqual(["Gamma"]);
    expect(await titles("?active=false")).toEqual(["Beta"]);
    expect(await titles("?q=cari-aku")).toEqual(["Beta"]);
    expect(await titles("?q=ALPHA")).toEqual(["Alpha"]); // case-insensitive
    expect(await titles("?sort=title")).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(await titles("?sort=-title&pageSize=2")).toEqual(["Gamma", "Beta"]);

    for (const bad of ["?severity=loud", "?active=maybe", "?sort=body", "?sort=-createdBy"]) {
      expect((await call(`${LIST}${bad}`, { cookie })).status, bad).toBe(400);
    }
  });

  test("one item by id, with its ETag, and 404 for a missing one", async () => {
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    const id = await seedAnnouncement();
    const res = await call(`${LIST}/${id}`, { cookie });
    expect(res.status).toBe(200);
    const { item } = (await res.json()) as { item: { id: string; updatedAt: string } };
    expect(item.id).toBe(id);
    expect(res.headers.get("etag")).toBe(`"${item.updatedAt}"`);
    expect((await call(`${LIST}/missing`, { cookie })).status).toBe(404);
  });

  test("update and delete work on an existing row, 404 on a missing one, each with an audit row", async () => {
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["komunikasi"]);
    const id = await seedAnnouncement();

    const updated = await call(`${LIST}/${id}`, { method: "PUT", cookie, headers: await ifMatch(id), json: { ...valid, title: "Judul baru", severity: "urgent" } });
    expect(updated.status).toBe(200);
    expect((await updated.json()) as object).toMatchObject({ item: { id, title: "Judul baru", severity: "urgent" } });

    expect((await call(`${LIST}/missing`, { method: "PUT", cookie, headers: { "if-match": '"2026-01-01T00:00:00.000Z"' }, json: valid })).status).toBe(404);
    expect((await call(`${LIST}/missing`, { method: "DELETE", cookie })).status).toBe(404);

    expect((await call(`${LIST}/${id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect(await count("announcements")).toBe(0);
    expect((await auditRows()).map((r) => r.action)).toEqual(["announcement.update", "announcement.delete"]); // none for the 404s
    const update = (await auditRows())[0]!;
    expect(JSON.parse(update.metadata)).toEqual({ fields: ["title", "body", "severity", "active"], label: "Judul baru" });
  });

  test("an update needs If-Match (428) and a stale one is refused (409) without a trace", async () => {
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["komunikasi"]);
    const id = await seedAnnouncement();
    const first = await ifMatch(id);

    expect((await call(`${LIST}/${id}`, { method: "PUT", cookie, json: valid })).status).toBe(428);

    // Someone else saves first ...
    expect((await call(`${LIST}/${id}`, { method: "PUT", cookie, headers: first, json: { ...valid, title: "Versi pertama" } })).status).toBe(200);
    // ... so the version this editor loaded is stale.
    const late = await call(`${LIST}/${id}`, { method: "PUT", cookie, headers: first, json: { ...valid, title: "Versi kedua" } });
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ error: "stale", message: expect.stringContaining("diubah orang lain") });
    expect((await env.DB.prepare("SELECT title FROM announcements WHERE id = ?").bind(id).first<{ title: string }>())?.title).toBe("Versi pertama");
    expect((await auditRows()).map((r) => r.action)).toEqual(["announcement.update"]); // the refused save wrote nothing
  });

  test("validation keeps the legacy rules and messages, in the one 400 shape", async () => {
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["komunikasi"]);
    const post = (json: unknown) => call(LIST, { method: "POST", cookie, json });
    const fields = async (res: Response) => ((await res.json()) as { fields: Record<string, string> }).fields;

    const short = await post({ ...valid, title: "ab", body: "abc" });
    expect(short.status).toBe(400);
    expect(await short.json()).toMatchObject({ error: "invalid", message: "Periksa kembali isian formulir.", fields: { title: "Judul minimal 3 karakter", body: "Isi minimal 5 karakter" } });

    expect(await fields(await post({ ...valid, ctaLabel: "Daftar" }))).toMatchObject({ ctaLabel: "Label dan URL CTA harus diisi keduanya" });
    expect(await fields(await post({ ...valid, startsAt: "2026-12-01T00:00", endsAt: "2026-11-01T00:00" }))).toMatchObject({
      endsAt: "Tanggal selesai harus setelah tanggal mulai",
    });
    expect(await fields(await post({ ...valid, startsAt: "not a date" }))).toMatchObject({ startsAt: "Format tanggal tidak valid" });
    expect(await fields(await post({ ...valid, severity: "loud" }))).toMatchObject({ severity: "Tingkat tidak dikenal" });
    expect(await fields(await post({ ...valid, body: "x".repeat(501) }))).toMatchObject({ body: "Isi maksimal 500 karakter" });
    // A missing field is one of ours, never zod's English.
    expect(await fields(await post({ body: valid.body, severity: "info" }))).toEqual({ title: "Wajib diisi." });
    expect(await count("announcements")).toBe(0);
    expect(await count("audit_log")).toBe(0);
  });

  test("a body that is not JSON is refused (this is what stops a cross-site form post)", async () => {
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["komunikasi"]);
    const form = await call(LIST, {
      method: "POST",
      cookie,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "title=Halo&body=Isi+pengumuman&severity=info",
    });
    const plain = await call(LIST, { method: "POST", cookie, headers: { "content-type": "text/plain" }, body: JSON.stringify(valid) });
    const broken = await call(LIST, { method: "POST", cookie, headers: { "content-type": "application/json" }, body: "{nope" });
    expect([form.status, plain.status, broken.status]).toEqual([415, 415, 400]);
    expect(await form.json()).toMatchObject({ error: "json_required" });
    expect(await broken.json()).toMatchObject({ error: "invalid_json" });
    expect(await count("announcements")).toBe(0);
  });

  test("a mutation and its audit row commit together or not at all", async () => {
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["komunikasi"]);
    // Make the audit insert fail (the table it writes to is gone).
    await env.DB.exec("ALTER TABLE audit_log RENAME TO audit_log_gone");
    try {
      const res = await call(LIST, { method: "POST", cookie, json: valid });
      expect(res.status).toBe(500);
      expect(await count("announcements")).toBe(0);
    } finally {
      await env.DB.exec("ALTER TABLE audit_log_gone RENAME TO audit_log");
    }
  });
});

describe("announcements: the public strip is told when they change", () => {
  test("create, update and delete each ask for a purge of the announcement", async () => {
    const notify = vi.fn<(change: ContentChange) => void>();
    const deps: CrudDeps = { notify: (change) => notify(change), deleteUpload: async () => ({ status: "not_found" }) };
    const app = appAround({ "/api/admin/announcements": createAnnouncementRoutes(deps) });
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["komunikasi"]);

    const created = await call(LIST, { method: "POST", cookie, json: valid, via: app });
    const id = ((await created.json()) as { item: { id: string } }).item.id;
    await call(`${LIST}/${id}`, { method: "PUT", cookie, headers: await ifMatch(id), json: { ...valid, title: "Baru lagi" }, via: app });
    await call(`${LIST}/${id}`, { method: "DELETE", cookie, via: app });

    expect(notify.mock.calls.map(([change]) => change)).toEqual([{ area: "announcement" }, { area: "announcement" }, { area: "announcement" }]);
  });
});

describe("/api/me", () => {
  test("401 without a session, the user with one", async () => {
    expect((await call("/api/me")).status).toBe(401);
    const email = uniqueEmail("me");
    const cookie = await signedInCookie(email, "viewer");
    const res = await call("/api/me", { cookie });
    expect(await res.json()).toMatchObject({ user: { email, role: "viewer", emailVerified: true } });
  });

  test("unknown API paths answer JSON 404", async () => {
    const res = await call("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  test("the old sample path no longer exists", async () => {
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    expect((await call("/api/announcements", { cookie })).status).toBe(404);
  });
});
