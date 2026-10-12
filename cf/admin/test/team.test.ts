import { env } from "cloudflare:workers";
import { describe, expect, test, vi } from "vitest";
import type { CrudDeps } from "../src/api/crud";
import { createTeamRoutes } from "../src/api/team";
import type { ContentChange } from "../src/public/purge";
import { appAround, ifMatchOf } from "./crud-app";
import { auditRows, body, count, fakeUploadPath, konten, KONTEN_CASES, mediaCount, objectExists, uploaded } from "./konten-helpers";
import { call, signedInCookie, uniqueEmail } from "./helpers";
import { addTeam, internalFetch, json } from "./public-helpers";

// Tim (area `konten`): the Worker half of docs/cloudflare/admin-konten.md. The generic behaviour is proved by
// test/crud-contract.test.ts; this file proves the team is wired to it correctly and keeps its legacy rules
// (every message below is the legacy form's).

const LIST = "/api/admin/team";

const valid = (over: Record<string, unknown> = {}) => ({
  name: "Ahmad Fadillah",
  role: "Ketua Umum",
  category: "pengurus",
  image: null,
  bio: "Latar belakang singkat.",
  educationHistory: [{ institution: "Universitas Contoh", degree: "S1 Pendidikan", year: "2015" }],
  workHistory: [{ organization: "Organisasi Contoh", role: "Analis", period: "2016 - 2018" }],
  displayOrder: 100,
  ...over,
});

const ifMatch = (id: string) => ifMatchOf("team_members", id);
const fieldsOf = async (res: Response) => (await body<{ fields: Record<string, string> }>(res)).fields;

describe("team: who may do what (the role matrix of the area konten)", () => {
  test("nobody signed in: 401 on every route", async () => {
    const { id } = await addTeam();
    expect((await call(LIST)).status).toBe(401);
    expect((await call(`${LIST}/${id}`)).status).toBe(401);
    expect((await call(LIST, { method: "POST", json: valid() })).status).toBe(401);
    expect((await call(`${LIST}/${id}`, { method: "PUT", json: valid() })).status).toBe(401);
    expect((await call(`${LIST}/${id}`, { method: "DELETE" })).status).toBe(401);
    expect(await count("audit_log")).toBe(0);
  });

  // Negative test (scripts/negative-checks-konten-misc.mjs): drop the area from a route and a refused case turns into a success.
  for (const { label, role, areas, read, write } of KONTEN_CASES) {
    test(`${label}: read ${read}, write ${write === "ok" ? "allowed" : "403"}`, async () => {
      const cookie = await signedInCookie(uniqueEmail(role), role, areas);
      const { id } = await addTeam({ name: "Anggota Awal" });

      expect((await call(LIST, { cookie })).status).toBe(read);
      expect((await call(`${LIST}/${id}`, { cookie })).status).toBe(read);

      const created = await call(LIST, { method: "POST", cookie, json: valid() });
      const updated = await call(`${LIST}/${id}`, { method: "PUT", cookie, headers: await ifMatch(id), json: valid({ name: "Nama Baru" }) });
      const deleted = await call(`${LIST}/${id}`, { method: "DELETE", cookie });

      if (write === "ok") {
        expect([created.status, updated.status, deleted.status]).toEqual([201, 200, 204]);
        expect((await auditRows()).map((row) => row.action)).toEqual(["team.create", "team.update", "team.delete"]);
      } else {
        expect([created.status, updated.status, deleted.status]).toEqual([403, 403, 403]);
        expect(await count("team_members")).toBe(1);
        expect((await env.DB.prepare("SELECT name FROM team_members WHERE id = ?").bind(id).first<{ name: string }>())?.name).toBe("Anggota Awal");
        expect(await count("audit_log")).toBe(0);
      }
    });
  }

  test("a refused read says nothing about what is there", async () => {
    await addTeam({ name: "Rahasia" });
    const cookie = await signedInCookie(uniqueEmail("elsewhere"), "editor", ["pendaftaran"]);
    const res = await call(LIST, { cookie });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });
});

describe("team: the list", () => {
  test("the default order is the public page's (category, display order, creation), and it equals what /tim is given", async () => {
    const t = (n: number) => new Date(Date.UTC(2026, 0, n));
    await addTeam({ name: "P 20 baru", category: "pengurus", displayOrder: 20, createdAt: t(9) });
    await addTeam({ name: "B 5", category: "dewan_pembina", displayOrder: 5, createdAt: t(5) });
    await addTeam({ name: "P 20 lama", category: "pengurus", displayOrder: 20, createdAt: t(2) });
    await addTeam({ name: "W 1", category: "dewan_pengawas", displayOrder: 1, createdAt: t(7) });
    await addTeam({ name: "B 5 lebih lama", category: "dewan_pembina", displayOrder: 5, createdAt: t(1) });
    await addTeam({ name: "P 3", category: "pengurus", displayOrder: 3, createdAt: t(8) });
    await addTeam({ name: "B 100", category: "dewan_pembina", displayOrder: 100, createdAt: t(3) });
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");

    const admin = await body<{ items: { id: string; name: string }[]; total: number }>(await call(LIST, { cookie }));
    expect(admin.items.map((item) => item.name)).toEqual(["B 5 lebih lama", "B 5", "B 100", "W 1", "P 3", "P 20 lama", "P 20 baru"]);

    const pub = await json<{ members: { id: string }[] }>(await internalFetch("/api/public/team"));
    expect(admin.items.map((item) => item.id)).toEqual(pub.members.map((member) => member.id));
  });

  test("the order is two digits wider than the form allows: 0 and 9999 sort numerically, not as text", async () => {
    await addTeam({ name: "Seribu", displayOrder: 1000 });
    await addTeam({ name: "Sembilan", displayOrder: 9 });
    await addTeam({ name: "Nol", displayOrder: 0 });
    await addTeam({ name: "Sembilan ribu", displayOrder: 9999 });
    await addTeam({ name: "Sepuluh", displayOrder: 10 });
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    const names = (await body<{ items: { name: string }[] }>(await call(LIST, { cookie }))).items.map((item) => item.name);
    expect(names).toEqual(["Nol", "Sembilan", "Sepuluh", "Seribu", "Sembilan ribu"]);
  });

  test("the other sorts, the opposite order, and a name outside the whitelist", async () => {
    await addTeam({ name: "Citra", role: "Bendahara", displayOrder: 1 });
    await addTeam({ name: "Adi", role: "Sekretaris", displayOrder: 3 });
    await addTeam({ name: "Budi", role: "Ketua", displayOrder: 2 });
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    const names = async (query: string) => (await body<{ items: { name: string }[] }>(await call(`${LIST}${query}`, { cookie }))).items.map((item) => item.name);

    expect(await names("?sort=name")).toEqual(["Adi", "Budi", "Citra"]);
    expect(await names("?sort=-name")).toEqual(["Citra", "Budi", "Adi"]);
    expect(await names("?sort=-displayOrder")).toEqual(["Adi", "Budi", "Citra"]);
    expect(await names("?sort=-order")).toEqual(["Adi", "Budi", "Citra"]);
    for (const bad of ["?sort=bio", "?sort=-image", "?sort=educationHistory"]) expect((await call(`${LIST}${bad}`, { cookie })).status, bad).toBe(400);
  });

  test("filter by category, search by name and role, and an unknown category is refused", async () => {
    await addTeam({ name: "Rina Pembina", role: "Ketua Pembina", category: "dewan_pembina" });
    await addTeam({ name: "Joko Pengawas", role: "Pengawas Utama", category: "dewan_pengawas" });
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    const names = async (query: string) => (await body<{ items: { name: string }[] }>(await call(`${LIST}${query}`, { cookie }))).items.map((item) => item.name);

    expect(await names("?category=dewan_pengawas")).toEqual(["Joko Pengawas"]);
    expect(await names("?q=RINA")).toEqual(["Rina Pembina"]);
    expect(await names("?q=utama")).toEqual(["Joko Pengawas"]);
    expect((await call(`${LIST}?category=direksi`, { cookie })).status).toBe(400);
  });

  test("a row of the list has no bio and no histories; the item has them, as explicit fields", async () => {
    await addTeam({ name: "Lengkap", bio: "Bio panjang", educationHistory: [{ institution: "UI" }], workHistory: [{ organization: "X", role: "Y" }] });
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    const list = await body<{ items: Record<string, unknown>[] }>(await call(LIST, { cookie }));
    expect(Object.keys(list.items[0]!).sort()).toEqual(["category", "createdAt", "displayOrder", "id", "image", "name", "role", "updatedAt"]);

    const res = await call(`${LIST}/${list.items[0]!.id}`, { cookie });
    const { item } = await body<{ item: Record<string, unknown> }>(res);
    expect(Object.keys(item).sort()).toEqual(["bio", "category", "createdAt", "displayOrder", "educationHistory", "id", "image", "name", "role", "updatedAt", "workHistory"]);
    expect(item).toMatchObject({ bio: "Bio panjang", educationHistory: [{ institution: "UI" }] });
    expect(res.headers.get("etag")).toBe(`"${item.updatedAt}"`);
    expect((await call(`${LIST}/missing`, { cookie })).status).toBe(404);
  });
});

describe("team: creating a member", () => {
  test("create returns the item and writes one audit row of field names and the member's name (public on /tim)", async () => {
    const { email, cookie } = await konten();
    const res = await call(LIST, { method: "POST", cookie, json: valid() });
    expect(res.status).toBe(201);
    const { item } = await body<{ item: Record<string, unknown> }>(res);
    expect(item).toMatchObject({ name: "Ahmad Fadillah", role: "Ketua Umum", category: "pengurus", image: null, displayOrder: 100 });
    expect(res.headers.get("etag")).toBe(`"${item.updatedAt}"`);

    const audit = await auditRows();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_email: email, action: "team.create", resource_type: "team_member", resource_id: item.id });
    expect(JSON.parse(audit[0]!.metadata!)).toEqual({
      fields: ["name", "role", "category", "image", "bio", "educationHistory", "workHistory", "displayOrder"],
      label: "Ahmad Fadillah",
    });
    // Names of columns, never what is in them: the bio and the histories are not in the row.
    expect(audit[0]!.metadata).not.toContain("Latar belakang");
    expect(audit[0]!.metadata).not.toContain("Universitas");
  });

  test("the member is on the public team page at once, in the form the page reads", async () => {
    const { cookie } = await konten();
    await call(LIST, { method: "POST", cookie, json: valid() });
    const pub = await json<{ members: Record<string, unknown>[] }>(await internalFetch("/api/public/team"));
    expect(pub.members).toMatchObject([
      {
        name: "Ahmad Fadillah",
        role: "Ketua Umum",
        category: "pengurus",
        bio: "Latar belakang singkat.",
        educationHistory: [{ institution: "Universitas Contoh", degree: "S1 Pendidikan", year: "2015" }],
        workHistory: [{ organization: "Organisasi Contoh", role: "Analis", period: "2016 - 2018" }],
      },
    ]);
  });

  test("text is trimmed, blank optional parts are null, an entry's optional parts too", async () => {
    const { cookie } = await konten();
    const res = await call(LIST, {
      method: "POST",
      cookie,
      json: valid({
        name: "  Siti Aminah  ",
        bio: "   ",
        image: "",
        educationHistory: [{ institution: "  UI  ", degree: "", year: "  " }],
        workHistory: [{ organization: "  Yayasan  ", role: "  Staf ", period: "" }],
      }),
    });
    expect(await body(res)).toMatchObject({
      item: { name: "Siti Aminah", bio: null, image: null, educationHistory: [{ institution: "UI", degree: null, year: null }], workHistory: [{ organization: "Yayasan", role: "Staf", period: null }] },
    });
  });

  test("the histories may be empty or missing", async () => {
    const { cookie } = await konten();
    const { educationHistory: _e, workHistory: _w, ...without } = valid();
    expect(await body(await call(LIST, { method: "POST", cookie, json: without }))).toMatchObject({ item: { educationHistory: [], workHistory: [] } });
    expect(await body(await call(LIST, { method: "POST", cookie, json: valid({ educationHistory: [], workHistory: [] }) }))).toMatchObject({ item: { educationHistory: [] } });
  });

  test("validation keeps the legacy rules and messages, in the one 400 shape", async () => {
    const { cookie } = await konten();
    const post = (over: Record<string, unknown>) => call(LIST, { method: "POST", cookie, json: valid(over) });

    const short = await post({ name: "A", role: "B" });
    expect(short.status).toBe(400);
    expect(await short.json()).toMatchObject({ error: "invalid", message: "Periksa kembali isian formulir.", fields: { name: "Nama minimal 2 karakter", role: "Peran minimal 2 karakter" } });
    expect(await fieldsOf(await post({ name: "x".repeat(121) }))).toEqual({ name: "Nama maksimal 120 karakter" });
    expect(await fieldsOf(await post({ role: "x".repeat(121) }))).toEqual({ role: "Peran maksimal 120 karakter" });
    expect(await fieldsOf(await post({ category: "direksi" }))).toEqual({ category: "Kategori tidak dikenal" });
    expect(await fieldsOf(await post({ bio: "x".repeat(4001) }))).toEqual({ bio: "Bio maksimal 4000 karakter" });
    const { name: _name, ...noName } = valid();
    expect(await fieldsOf(await call(LIST, { method: "POST", cookie, json: noName }))).toEqual({ name: "Nama wajib diisi" });
    expect(await count("team_members")).toBe(0);
    expect(await count("audit_log")).toBe(0);
  });

  test("the display order is a whole number from 0 to 9999", async () => {
    const { cookie } = await konten();
    const post = (displayOrder: unknown) => call(LIST, { method: "POST", cookie, json: valid({ displayOrder }) });
    expect((await post(0)).status).toBe(201);
    expect((await post(9999)).status).toBe(201);
    expect(await fieldsOf(await post(-1))).toEqual({ displayOrder: "Tidak boleh negatif" });
    expect(await fieldsOf(await post(10000))).toEqual({ displayOrder: "Maksimal 9999" });
    expect(await fieldsOf(await post(1.5))).toEqual({ displayOrder: "Harus bilangan bulat" });
    for (const bad of ["10", null, undefined, true]) expect(await fieldsOf(await post(bad)), String(bad)).toEqual({ displayOrder: "Wajib diisi" });
  });

  test("the histories: at most 20 entries each, an entry needs its institution (or organization and role), the messages name the entry", async () => {
    const { cookie } = await konten();
    const post = (over: Record<string, unknown>) => call(LIST, { method: "POST", cookie, json: valid(over) });
    const twenty = Array.from({ length: 20 }, (_, n) => ({ institution: `Sekolah ${n}` }));

    expect((await post({ educationHistory: twenty })).status).toBe(201);
    expect(await fieldsOf(await post({ educationHistory: [...twenty, { institution: "Satu lagi" }] }))).toEqual({ educationHistory: "Maksimal 20 entri" });
    const works = Array.from({ length: 21 }, (_, n) => ({ organization: `Org ${n}`, role: "Staf" }));
    expect(await fieldsOf(await post({ workHistory: works }))).toEqual({ workHistory: "Maksimal 20 entri" });

    expect(await fieldsOf(await post({ educationHistory: [{ institution: "UI" }, { institution: "  ", degree: "S1" }] }))).toEqual({ "educationHistory.1.institution": "Institusi wajib diisi" });
    expect(await fieldsOf(await post({ workHistory: [{ organization: "", role: "" }] }))).toEqual({ "workHistory.0.organization": "Organisasi wajib diisi", "workHistory.0.role": "Peran wajib diisi" });
    expect(await fieldsOf(await post({ educationHistory: [{ institution: "x".repeat(201) }] }))).toEqual({ "educationHistory.0.institution": "Institusi maksimal 200 karakter" });
    expect(await fieldsOf(await post({ educationHistory: [{ institution: "UI", year: "x".repeat(51) }] }))).toEqual({ "educationHistory.0.year": "Tahun maksimal 50 karakter" });
    expect(await fieldsOf(await post({ workHistory: [{ organization: "O", role: "R", period: "x".repeat(51) }] }))).toEqual({ "workHistory.0.period": "Periode maksimal 50 karakter" });
    expect((await post({ educationHistory: "UI" })).status).toBe(400);
    expect((await post({ workHistory: { organization: "O" } })).status).toBe(400);
  });

  test("the photo: an upload of the team-photo kind, a legacy static path, or none; another kind's file is refused", async () => {
    const { cookie } = await konten();
    const post = (image: unknown) => call(LIST, { method: "POST", cookie, json: valid({ image }) });
    const imageOf = async (res: Response) => (await body<{ item: { image: string | null } }>(res)).item.image;

    const path = fakeUploadPath("team-photo", "foto");
    expect(await imageOf(await post(path))).toBe(path);
    expect(await imageOf(await post("/images/team/lama-ab12cd.jpg"))).toBe("/images/team/lama-ab12cd.jpg");
    expect(await imageOf(await post(null))).toBeNull();
    expect(await imageOf(await post(""))).toBeNull();
    const { image: _image, ...noImage } = valid();
    expect(await imageOf(await call(LIST, { method: "POST", cookie, json: noImage }))).toBeNull();

    for (const bad of [fakeUploadPath("report"), fakeUploadPath("blog-image"), "https://example.org/foto.png", "/uploads/team-photo/../../x.png", "javascript:alert(1)"]) {
      expect(await fieldsOf(await post(bad)), String(bad)).toEqual({ image: "Berkas tidak valid. Unggah ulang berkasnya." });
    }
    // Not even a string: a client other than the form. The generic line, never zod's English.
    expect(await fieldsOf(await post(7))).toEqual({ image: "Isian belum benar." });
  });
});

describe("team: editing a member", () => {
  test("an update changes the form's columns, and the audit row lists only the ones that changed", async () => {
    const { cookie } = await konten();
    const row = await addTeam({ name: "Rina", role: "Anggota", bio: "Lama", displayOrder: 50 });
    const res = await call(`${LIST}/${row.id}`, {
      method: "PUT",
      cookie,
      headers: await ifMatch(row.id),
      json: valid({ name: "Rina", role: "Anggota", bio: "Bio baru", displayOrder: 50, educationHistory: [], workHistory: [] }),
    });
    expect(res.status).toBe(200);
    expect(await body(res)).toMatchObject({ item: { id: row.id, bio: "Bio baru", category: "pengurus" } });
    const update = (await auditRows()).at(-1)!;
    expect(update).toMatchObject({ action: "team.update", resource_type: "team_member", resource_id: row.id });
    expect(JSON.parse(update.metadata!)).toEqual({ fields: ["bio"], label: "Rina" });
  });

  test("an update needs If-Match (428), a stale one is refused (409) without a trace", async () => {
    const { cookie } = await konten();
    const row = await addTeam({ name: "Awal" });
    const first = await ifMatch(row.id);
    expect((await call(`${LIST}/${row.id}`, { method: "PUT", cookie, json: valid() })).status).toBe(428);
    expect((await call(`${LIST}/${row.id}`, { method: "PUT", cookie, headers: first, json: valid({ name: "Pertama" }) })).status).toBe(200);
    const late = await call(`${LIST}/${row.id}`, { method: "PUT", cookie, headers: first, json: valid({ name: "Kedua" }) });
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ error: "stale" });
    expect((await env.DB.prepare("SELECT name FROM team_members WHERE id = ?").bind(row.id).first<{ name: string }>())?.name).toBe("Pertama");
    expect((await auditRows()).map((r) => r.action)).toEqual(["team.update"]);
  });

  test("saving a member with a legacy photo path keeps it (the form sends back what it loaded)", async () => {
    const { cookie } = await konten();
    const row = await addTeam({ image: "/images/team/lama-ab12cd.jpg" });
    const res = await call(`${LIST}/${row.id}`, { method: "PUT", cookie, headers: await ifMatch(row.id), json: valid({ image: "/images/team/lama-ab12cd.jpg" }) });
    expect(await body(res)).toMatchObject({ item: { image: "/images/team/lama-ab12cd.jpg" } });
  });
});

describe("team: the photo goes with the row", () => {
  test("replacing the photo deletes the old file, removing it deletes the new one, and nothing else is touched", async () => {
    const { cookie } = await konten();
    const first = await uploaded(cookie, "team-photo", "foto-pertama.png");
    const second = await uploaded(cookie, "team-photo", "foto-kedua.png");
    const created = await call(LIST, { method: "POST", cookie, json: valid({ image: first.path }) });
    const { id } = (await body<{ item: { id: string } }>(created)).item;
    expect(await mediaCount()).toBe(2);

    const replaced = await call(`${LIST}/${id}`, { method: "PUT", cookie, headers: await ifMatch(id), json: valid({ image: second.path }) });
    expect(replaced.status).toBe(200);
    expect(await objectExists(first.path)).toBe(false);
    expect(await objectExists(second.path)).toBe(true);
    expect(await mediaCount()).toBe(1);

    const removed = await call(`${LIST}/${id}`, { method: "PUT", cookie, headers: await ifMatch(id), json: valid({ image: null }) });
    expect(removed.status).toBe(200);
    expect(await objectExists(second.path)).toBe(false);
    expect(await mediaCount()).toBe(0);
  });

  test("deleting the member deletes the photo", async () => {
    const { cookie } = await konten();
    const photo = await uploaded(cookie, "team-photo");
    const created = await call(LIST, { method: "POST", cookie, json: valid({ image: photo.path }) });
    const { id } = (await body<{ item: { id: string } }>(created)).item;
    expect((await call(`${LIST}/${id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect(await count("team_members")).toBe(0);
    expect(await objectExists(photo.path)).toBe(false);
    expect((await auditRows()).map((row) => row.action)).toEqual(["upload.create", "team.create", "team.delete", "upload.delete"]);
  });

  test("a photo another member also uses stays, and the delete still succeeds", async () => {
    const { cookie } = await konten();
    const photo = await uploaded(cookie, "team-photo");
    const created = await call(LIST, { method: "POST", cookie, json: valid({ image: photo.path }) });
    await addTeam({ image: photo.path });
    expect((await call(`${LIST}/${(await body<{ item: { id: string } }>(created)).item.id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect(await objectExists(photo.path)).toBe(true);
  });

  test("while a member uses it, the photo cannot be deleted from the uploads API (Tim is named)", async () => {
    const { cookie } = await konten();
    const photo = await uploaded(cookie, "team-photo");
    await call(LIST, { method: "POST", cookie, json: valid({ image: photo.path }) });
    const refused = await call(`/api/admin/uploads/${photo.id}`, { method: "DELETE", cookie });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: "in_use", usedBy: ["Tim"] });
  });

  test("deleting a missing member is a 404 without an audit row", async () => {
    const { cookie } = await konten();
    expect((await call(`${LIST}/missing`, { method: "DELETE", cookie })).status).toBe(404);
    expect(await count("audit_log")).toBe(0);
  });
});

describe("team: the public team page is told when they change", () => {
  test("create, update and delete each ask for a purge of the team, and replacing the photo asks for the old file to go", async () => {
    const notify = vi.fn<(change: ContentChange) => void>();
    const deleteUpload = vi.fn<CrudDeps["deleteUpload"]>(async () => ({ status: "deleted" }));
    const app = appAround({ "/api/admin/team": createTeamRoutes({ notify: (change) => notify(change), deleteUpload }) });
    const { cookie } = await konten();
    const one = fakeUploadPath("team-photo", "satu");
    const two = fakeUploadPath("team-photo", "dua");

    const created = await call(LIST, { method: "POST", cookie, json: valid({ image: one }), via: app });
    const id = (await body<{ item: { id: string } }>(created)).item.id;
    await call(`${LIST}/${id}`, { method: "PUT", cookie, headers: await ifMatch(id), json: valid({ image: two }), via: app });
    await call(`${LIST}/${id}`, { method: "PUT", cookie, headers: await ifMatch(id), json: valid({ image: two }), via: app }); // nothing changed
    await call(`${LIST}/${id}`, { method: "DELETE", cookie, via: app });

    expect(notify.mock.calls.map(([change]) => change)).toEqual([{ area: "team" }, { area: "team" }, { area: "team" }]);
    expect(deleteUpload.mock.calls.map(([, , path]) => path)).toEqual([one, two]);
  });
});
