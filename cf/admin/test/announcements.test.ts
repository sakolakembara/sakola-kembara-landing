import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { call, cookiesOf, createVerifiedUser, grantArea, revokeArea, setRole, signedInCookie, signIn, uniqueEmail } from "./helpers";

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

describe("announcements: who may do what (role guard matrix)", () => {
  test("nobody signed in: 401 on every route", async () => {
    const id = await seedAnnouncement();
    expect((await call("/api/announcements")).status).toBe(401);
    expect((await call("/api/announcements", { method: "POST", json: valid })).status).toBe(401);
    expect((await call(`/api/announcements/${id}`, { method: "PUT", json: valid })).status).toBe(401);
    expect((await call(`/api/announcements/${id}`, { method: "DELETE" })).status).toBe(401);
    expect(await count("audit_log")).toBe(0);
  });

  // Announcements are the `komunikasi` area. Negative test (scripts/negative-checks.mjs):
  // make the viewer rule or the area check in src/auth/permissions.ts permissive and the
  // viewer, stray-grant and wrong-area cases below fail.
  const cases = [
    { label: "student", role: "student", areas: [], read: 403, write: 403 },
    { label: "viewer", role: "viewer", areas: [], read: 200, write: 403 },
    // A grant row on a viewer is inert: viewer is read-only by role.
    { label: "viewer with a stray komunikasi grant", role: "viewer", areas: ["komunikasi"], read: 200, write: 403 },
    { label: "editor with no grants", role: "editor", areas: [], read: 200, write: 403 },
    { label: "editor granted other areas only", role: "editor", areas: ["pendaftaran", "konten"], read: 200, write: 403 },
    { label: "editor granted komunikasi", role: "editor", areas: ["komunikasi"], read: 200, write: "ok" },
    { label: "editor granted every area", role: "editor", areas: ["pendaftaran", "komunikasi", "konten"], read: 200, write: "ok" },
    { label: "super_admin", role: "super_admin", areas: [], read: 200, write: "ok" },
  ] as const;

  for (const { label, role, areas, read, write } of cases) {
    test(`${label}: read ${read}, write ${write === "ok" ? "allowed" : "403"}`, async () => {
      const email = uniqueEmail(role);
      const cookie = await signedInCookie(email, role, areas);
      const id = await seedAnnouncement();

      expect((await call("/api/announcements", { cookie })).status).toBe(read);

      const created = await call("/api/announcements", { method: "POST", cookie, json: valid });
      const updated = await call(`/api/announcements/${id}`, { method: "PUT", cookie, json: { ...valid, title: "Judul baru" } });
      const deleted = await call(`/api/announcements/${id}`, { method: "DELETE", cookie });

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
    expect((await call("/api/announcements", { method: "POST", cookie, json: valid })).status).toBe(201);

    await setRole(email, "viewer");
    expect((await call("/api/announcements", { method: "POST", cookie, json: valid })).status).toBe(403);
    expect((await call("/api/announcements", { cookie })).status).toBe(200);

    await setRole(email, "student");
    expect((await call("/api/announcements", { cookie })).status).toBe(403);
  });

  test("a grant revoked or added applies to the very next request", async () => {
    const email = uniqueEmail("regranted");
    const userId = await createVerifiedUser(email, "editor", ["komunikasi"]);
    const cookie = cookiesOf(await signIn(email));
    expect((await call("/api/announcements", { method: "POST", cookie, json: valid })).status).toBe(201);

    await revokeArea(userId, "komunikasi");
    expect((await call("/api/announcements", { method: "POST", cookie, json: valid })).status).toBe(403);
    expect((await call("/api/announcements", { cookie })).status).toBe(200); // still reads

    await grantArea(userId, "komunikasi");
    expect((await call("/api/announcements", { method: "POST", cookie, json: valid })).status).toBe(201);
  });
});

describe("announcements: behaviour for an editor", () => {
  test("create returns the row, records who made it, and writes one audit row", async () => {
    const email = uniqueEmail("editor");
    const cookie = await signedInCookie(email, "editor", ["komunikasi"]);

    const res = await call("/api/announcements", {
      method: "POST",
      cookie,
      json: { ...valid, ctaLabel: "Daftar", ctaUrl: "/gabung-siswa", startsAt: "2026-11-01T00:00", endsAt: "2026-11-30T23:59" },
    });
    expect(res.status).toBe(201);
    const { announcement } = (await res.json()) as { announcement: Record<string, unknown> };
    expect(announcement).toMatchObject({ title: valid.title, severity: "info", active: true, ctaLabel: "Daftar", ctaUrl: "/gabung-siswa" });

    const row = await env.DB.prepare("SELECT created_by, starts_at FROM announcements WHERE id = ?").bind(announcement.id).first<{ created_by: string; starts_at: number }>();
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
    expect(row?.created_by).toBe(user?.id);

    const audit = await auditRows();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_email: email, action: "announcement.create", resource_type: "announcement", resource_id: announcement.id });
    expect(JSON.parse(audit[0]!.metadata)).toEqual({ title: valid.title, severity: "info", active: true });
  });

  test("list is newest first", async () => {
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    await env.DB.prepare("INSERT INTO announcements (id, title, body, created_at) VALUES ('a', 'Lama', 'Isi lama', 1000), ('b', 'Baru', 'Isi baru', 2000)").run();
    const { announcements } = (await (await call("/api/announcements", { cookie })).json()) as { announcements: { title: string }[] };
    expect(announcements.map((a) => a.title)).toEqual(["Baru", "Lama"]);
  });

  test("update and delete work on an existing row, 404 on a missing one, each with an audit row", async () => {
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["komunikasi"]);
    const id = await seedAnnouncement();

    const updated = await call(`/api/announcements/${id}`, { method: "PUT", cookie, json: { ...valid, title: "Judul baru", severity: "urgent" } });
    expect(updated.status).toBe(200);
    expect((await updated.json()) as object).toMatchObject({ announcement: { id, title: "Judul baru", severity: "urgent" } });

    expect((await call("/api/announcements/missing", { method: "PUT", cookie, json: valid })).status).toBe(404);
    expect((await call("/api/announcements/missing", { method: "DELETE", cookie })).status).toBe(404);

    expect((await call(`/api/announcements/${id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect(await count("announcements")).toBe(0);
    expect((await auditRows()).map((r) => r.action)).toEqual(["announcement.update", "announcement.delete"]); // none for the 404s
  });

  test("validation keeps the legacy rules and messages", async () => {
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["komunikasi"]);
    const post = (json: unknown) => call("/api/announcements", { method: "POST", cookie, json });
    const fieldErrors = async (res: Response) => ((await res.json()) as { fieldErrors: Record<string, string[]> }).fieldErrors;

    const short = await post({ ...valid, title: "ab", body: "abc" });
    expect(short.status).toBe(400);
    expect(await fieldErrors(short)).toMatchObject({ title: ["Judul minimal 3 karakter"], body: ["Isi minimal 5 karakter"] });

    expect(await fieldErrors(await post({ ...valid, ctaLabel: "Daftar" }))).toMatchObject({ ctaLabel: ["Label dan URL CTA harus diisi keduanya"] });
    expect(await fieldErrors(await post({ ...valid, startsAt: "2026-12-01T00:00", endsAt: "2026-11-01T00:00" }))).toMatchObject({
      endsAt: ["Tanggal selesai harus setelah tanggal mulai"],
    });
    expect(await fieldErrors(await post({ ...valid, startsAt: "not a date" }))).toMatchObject({ startsAt: ["Format tanggal tidak valid"] });
    expect((await post({ ...valid, severity: "loud" })).status).toBe(400);
    expect((await post({ ...valid, body: "x".repeat(501) })).status).toBe(400);
    expect(await count("announcements")).toBe(0);
    expect(await count("audit_log")).toBe(0);
  });

  test("a body that is not JSON is refused (this is what stops a cross-site form post)", async () => {
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["komunikasi"]);
    const form = await call("/api/announcements", {
      method: "POST",
      cookie,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "title=Halo&body=Isi+pengumuman&severity=info",
    });
    const plain = await call("/api/announcements", { method: "POST", cookie, headers: { "content-type": "text/plain" }, body: JSON.stringify(valid) });
    const broken = await call("/api/announcements", { method: "POST", cookie, headers: { "content-type": "application/json" }, body: "{nope" });
    expect([form.status, plain.status, broken.status]).toEqual([415, 415, 415]);
    expect(await count("announcements")).toBe(0);
  });

  test("a mutation and its audit row commit together or not at all", async () => {
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["komunikasi"]);
    // Make the audit insert fail (NOT NULL actor_email cannot be satisfied if the table is gone).
    await env.DB.exec("ALTER TABLE audit_log RENAME TO audit_log_gone");
    try {
      const res = await call("/api/announcements", { method: "POST", cookie, json: valid });
      expect(res.status).toBe(500);
      expect(await count("announcements")).toBe(0);
    } finally {
      await env.DB.exec("ALTER TABLE audit_log_gone RENAME TO audit_log");
    }
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
});
