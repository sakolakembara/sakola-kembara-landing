import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { CLICK_SQL } from "../src/public/shortlink";
import { ifMatchOf } from "./crud-app";
import { auditRows, body, count, fakeUploadPath, konten, KONTEN_CASES, uploaded } from "./konten-helpers";
import { call, signedInCookie, uniqueEmail } from "./helpers";

// Shortlink (area `konten`): the admin half (the redirect is test/shortlinks-redirect.test.ts, the rules are
// test/shortlinks-rules.test.ts). The generic behaviour is proved by test/crud-contract.test.ts; this file proves
// the shortlinks are wired to it correctly and keep their legacy rules and messages.

const LIST = "/api/admin/shortlinks";

const valid = (over: Record<string, unknown> = {}) => ({ slug: "daftar-2026", targetUrl: "https://forms.gle/abc123", note: "Dipakai di bio Instagram", active: true, ...over });
const ifMatch = (id: string) => ifMatchOf("shortlinks", id);
const fieldsOf = async (res: Response) => (await body<{ fields: Record<string, string> }>(res)).fields;

async function addLink(over: { slug?: string; target_url?: string; note?: string | null; active?: number; click_count?: number; last_clicked_at?: number | null; created_at?: number } = {}) {
  const row = { id: crypto.randomUUID(), slug: `rapat-${crypto.randomUUID().slice(0, 8)}`, target_url: "https://example.org/", note: null, active: 1, click_count: 0, last_clicked_at: null, created_at: Date.now(), ...over };
  await env.DB.prepare("INSERT INTO shortlinks (id, slug, target_url, note, active, click_count, last_clicked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(row.id, row.slug, row.target_url, row.note, row.active, row.click_count, row.last_clicked_at, row.created_at)
    .run();
  return row;
}

describe("shortlinks: who may do what (the role matrix of the area konten)", () => {
  test("nobody signed in: 401 on every route", async () => {
    const { id } = await addLink();
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
      const { id } = await addLink({ slug: "awal" });

      expect((await call(LIST, { cookie })).status).toBe(read);
      expect((await call(`${LIST}/${id}`, { cookie })).status).toBe(read);

      const created = await call(LIST, { method: "POST", cookie, json: valid() });
      const updated = await call(`${LIST}/${id}`, { method: "PUT", cookie, headers: await ifMatch(id), json: valid({ slug: "awal", note: "Catatan baru" }) });
      const deleted = await call(`${LIST}/${id}`, { method: "DELETE", cookie });

      if (write === "ok") {
        expect([created.status, updated.status, deleted.status]).toEqual([201, 200, 204]);
        expect((await auditRows()).map((row) => row.action)).toEqual(["shortlink.create", "shortlink.update", "shortlink.delete"]);
      } else {
        expect([created.status, updated.status, deleted.status]).toEqual([403, 403, 403]);
        expect(await count("shortlinks")).toBe(1);
        expect((await env.DB.prepare("SELECT note FROM shortlinks WHERE id = ?").bind(id).first<{ note: string | null }>())?.note).toBeNull();
        expect(await count("audit_log")).toBe(0);
      }
    });
  }

  test("a refused read says nothing about what is there", async () => {
    await addLink({ slug: "rahasia" });
    const cookie = await signedInCookie(uniqueEmail("elsewhere"), "editor", ["komunikasi"]);
    const res = await call(LIST, { cookie });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });
});

describe("shortlinks: creating one", () => {
  test("create returns the item, records who made it, and writes one audit row of field names and the slug", async () => {
    const { email, cookie } = await konten();
    const res = await call(LIST, { method: "POST", cookie, json: valid() });
    expect(res.status).toBe(201);
    const { item } = await body<Record<string, unknown> & { item: Record<string, unknown> }>(res);
    expect(item).toMatchObject({ slug: "daftar-2026", targetUrl: "https://forms.gle/abc123", note: "Dipakai di bio Instagram", active: true, clickCount: 0, lastClickedAt: null });
    // An explicit field list: the author's id is not part of it.
    expect(Object.keys(item).sort()).toEqual(["active", "clickCount", "createdAt", "id", "lastClickedAt", "note", "slug", "targetUrl", "updatedAt"]);
    expect(res.headers.get("etag")).toBe(`"${item.updatedAt}"`);

    const row = await env.DB.prepare("SELECT created_by FROM shortlinks WHERE id = ?").bind(item.id).first<{ created_by: string }>();
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
    expect(row?.created_by).toBe(user?.id);

    const audit = await auditRows();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_email: email, action: "shortlink.create", resource_type: "shortlink", resource_id: item.id });
    expect(JSON.parse(audit[0]!.metadata!)).toEqual({ fields: ["slug", "targetUrl", "note", "active"], label: "daftar-2026" });
    // Names, and the slug as the label; never the target or the note.
    expect(audit[0]!.metadata).not.toContain("forms.gle");
    expect(audit[0]!.metadata).not.toContain("Instagram");
  });

  test("the slug is stored the way the resolver looks it up: trimmed, lower case, no surrounding slashes", async () => {
    const { cookie } = await konten();
    const res = await call(LIST, { method: "POST", cookie, json: valid({ slug: "  /Rapat-Besar/ " }) });
    expect(await body(res)).toMatchObject({ item: { slug: "rapat-besar" } });
  });

  test("a new link is active unless the form says otherwise; the note is trimmed and blank is none", async () => {
    const { cookie } = await konten();
    const { active: _active, note: _note, ...bare } = valid();
    expect(await body(await call(LIST, { method: "POST", cookie, json: bare }))).toMatchObject({ item: { active: true, note: null } });
    expect(await body(await call(LIST, { method: "POST", cookie, json: valid({ slug: "mati", active: false, note: "  " }) }))).toMatchObject({ item: { active: false, note: null } });
    expect(await fieldsOf(await call(LIST, { method: "POST", cookie, json: valid({ slug: "lain", active: "ya" }) }))).toEqual({ active: "Status tidak valid" });
  });

  test("a slug that is taken is a 409 on the slug field, and a different case or slashes do not get around it", async () => {
    const { cookie } = await konten();
    await call(LIST, { method: "POST", cookie, json: valid() });
    for (const slug of ["daftar-2026", "DAFTAR-2026", "/daftar-2026/"]) {
      const res = await call(LIST, { method: "POST", cookie, json: valid({ slug }) });
      expect(res.status, slug).toBe(409);
      expect(await res.json()).toMatchObject({ error: "conflict", fields: { slug: "Slug ini sudah dipakai shortlink lain." } });
    }
    expect(await count("shortlinks")).toBe(1);
    expect((await auditRows()).map((row) => row.action)).toEqual(["shortlink.create"]); // a refused create leaves nothing
  });

  test("the slug rules and their legacy messages, in the one 400 shape", async () => {
    const { cookie } = await konten();
    const post = (over: Record<string, unknown>) => call(LIST, { method: "POST", cookie, json: valid(over) });

    const empty = await post({ slug: "" });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({ error: "invalid", message: "Periksa kembali isian formulir.", fields: { slug: "Slug wajib diisi." } });
    expect(await fieldsOf(await post({ slug: "a".repeat(65) }))).toEqual({ slug: "Slug maksimal 64 karakter." });
    expect(await fieldsOf(await post({ slug: "a".repeat(500) }))).toEqual({ slug: "Slug maksimal 64 karakter." });
    for (const slug of ["daftar_2026", "daftar--2026", "-daftar", "daftar.2026", "daftar 2026", "dästar"]) {
      expect(await fieldsOf(await post({ slug })), slug).toEqual({ slug: "Slug hanya boleh huruf kecil, angka, dan tanda hubung di antaranya (contoh: daftar-2026)." });
    }
    const { slug: _slug, ...noSlug } = valid();
    expect(await fieldsOf(await call(LIST, { method: "POST", cookie, json: noSlug }))).toEqual({ slug: "Slug wajib diisi." });
    expect(await count("shortlinks")).toBe(0);
  });

  test("a slug a page of the site already answers is refused when it is created, not left to fail silently", async () => {
    const { cookie } = await konten();
    for (const slug of ["donasi", "tim", "/Blog/", "gabung-siswa", "kontak", "laporan", "program", "login", "api", "admin", "daftar", "404"]) {
      const res = await call(LIST, { method: "POST", cookie, json: valid({ slug }) });
      expect(res.status, slug).toBe(400);
      const normalised = slug.toLowerCase().replace(/^\/+|\/+$/g, "");
      expect(await fieldsOf(res), slug).toEqual({
        slug: `"${normalised}" sudah dipakai halaman lain di situs ini, jadi shortlink dengan slug tersebut tidak akan pernah terbuka. Pilih slug lain.`,
      });
    }
    expect(await count("shortlinks")).toBe(0);
  });

  test("the target rules: a path of this site or an http(s) URL, with the legacy messages", async () => {
    const { cookie } = await konten();
    const post = (over: Record<string, unknown>) => call(LIST, { method: "POST", cookie, json: valid(over) });

    expect(await fieldsOf(await post({ targetUrl: "" }))).toEqual({ targetUrl: "URL tujuan wajib diisi." });
    expect(await fieldsOf(await post({ targetUrl: "javascript:alert(1)" }))).toEqual({ targetUrl: "Hanya URL http:// atau https:// yang diizinkan." });
    expect(await fieldsOf(await post({ targetUrl: "//evil.example" }))).toEqual({ targetUrl: "Gunakan URL lengkap (https://...) untuk tujuan di luar situs ini." });
    expect(await fieldsOf(await post({ targetUrl: "forms.gle/abc" }))).toEqual({ targetUrl: "Format URL tidak valid. Gunakan https://... atau /path-di-situs-ini." });
    expect(await fieldsOf(await post({ targetUrl: "/daftar-2026" }))).toEqual({ targetUrl: "Tujuan tidak boleh menunjuk ke shortlink itu sendiri." });
    expect(await fieldsOf(await post({ targetUrl: `https://example.org/${"x".repeat(2000)}` }))).toEqual({ targetUrl: "URL tujuan terlalu panjang." });
    const { targetUrl: _target, ...noTarget } = valid();
    expect(await fieldsOf(await call(LIST, { method: "POST", cookie, json: noTarget }))).toEqual({ targetUrl: "URL tujuan wajib diisi." });
    expect(await fieldsOf(await post({ note: "x".repeat(301) }))).toEqual({ note: "Catatan maksimal 300 karakter" });
    expect(await count("shortlinks")).toBe(0);
  });

  test("no open redirect gets through: every way of writing a jump off the site or into code is refused and nothing is stored", async () => {
    const { cookie } = await konten();
    const malicious = [
      "javascript:alert(1)", "JAVASCRIPT:alert(1)", " javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x", "file:///etc/passwd",
      "//evil.example", "///evil.example", "/\\evil.example", "\\\\evil.example", "/\t/evil.example", "/\n/evil.example", "https://exa\tmple.org",
    ];
    for (const [index, targetUrl] of malicious.entries()) {
      const res = await call(LIST, { method: "POST", cookie, json: valid({ slug: `bahaya-${index}`, targetUrl }) });
      expect(res.status, targetUrl).toBe(400);
      expect(Object.keys(await fieldsOf(res)), targetUrl).toEqual(["targetUrl"]);
    }
    expect(await count("shortlinks")).toBe(0);
    expect(await count("audit_log")).toBe(0);
  });

  test("a slug and a target that are both wrong are both reported", async () => {
    const { cookie } = await konten();
    const res = await call(LIST, { method: "POST", cookie, json: valid({ slug: "Salah_Slug", targetUrl: "javascript:alert(1)" }) });
    expect(Object.keys(await fieldsOf(res)).sort()).toEqual(["slug", "targetUrl"]);
  });

  test("the database refuses what the rules refuse, for a write that bypasses them (the CHECK constraints)", async () => {
    const insert = (slug: string, target: string) => env.DB.prepare("INSERT INTO shortlinks (id, slug, target_url) VALUES (?, ?, ?)").bind(crypto.randomUUID(), slug, target).run();
    await expect(insert("Besar", "https://example.org/")).rejects.toThrow(/shortlinks_slug_check/);
    await expect(insert("a--b", "https://example.org/")).rejects.toThrow(/shortlinks_slug_check/);
    await expect(insert("ok", "javascript:alert(1)")).rejects.toThrow(/shortlinks_target_check/);
    await expect(insert("ok", "//evil.example")).rejects.toThrow(/shortlinks_target_check/);
    await expect(insert("ok", "data:text/html,x")).rejects.toThrow(/shortlinks_target_check/);
    await insert("ok", "/gabung-siswa");
    await expect(insert("ok", "https://example.org/")).rejects.toThrow(/UNIQUE/);
  });

  test("a body that is not JSON is refused", async () => {
    const { cookie } = await konten();
    const form = await call(LIST, { method: "POST", cookie, headers: { "content-type": "application/x-www-form-urlencoded" }, body: "slug=daftar&targetUrl=https%3A%2F%2Fexample.org" });
    const broken = await call(LIST, { method: "POST", cookie, headers: { "content-type": "application/json" }, body: "{nope" });
    expect([form.status, broken.status]).toEqual([415, 400]);
    expect(await count("shortlinks")).toBe(0);
  });
});

describe("shortlinks: the list", () => {
  test("newest first by default, with the count and the time of the last click; an envelope", async () => {
    await addLink({ slug: "lama", created_at: 1000 });
    await addLink({ slug: "baru", created_at: 2000, click_count: 7, last_clicked_at: 1_790_000_000_000 });
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    const list = await body<{ items: { slug: string; clickCount: number; lastClickedAt: string | null }[]; page: number; pageSize: number; total: number }>(await call(LIST, { cookie }));
    expect(list.items.map((item) => item.slug)).toEqual(["baru", "lama"]);
    expect(list.items[0]).toMatchObject({ clickCount: 7, lastClickedAt: new Date(1_790_000_000_000).toISOString() });
    expect(list.items[1]).toMatchObject({ clickCount: 0, lastClickedAt: null });
    expect(list).toMatchObject({ page: 1, pageSize: 20, total: 2 });
  });

  test("filter by status, search in the slug, the target and the note, sort by clicks, and a refused name", async () => {
    await addLink({ slug: "satu", active: 1, click_count: 5, target_url: "https://forms.gle/satu", created_at: 1 });
    await addLink({ slug: "dua", active: 0, click_count: 50, note: "kampanye wawancara", created_at: 2 });
    await addLink({ slug: "tiga", active: 1, click_count: 20, target_url: "/gabung-siswa", created_at: 3 });
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    const slugs = async (query: string) => (await body<{ items: { slug: string }[] }>(await call(`${LIST}${query}`, { cookie }))).items.map((item) => item.slug);

    expect(await slugs("?active=true")).toEqual(["tiga", "satu"]);
    expect(await slugs("?active=false")).toEqual(["dua"]);
    expect(await slugs("?q=wawancara")).toEqual(["dua"]);
    expect(await slugs("?q=GABUNG")).toEqual(["tiga"]);
    expect(await slugs("?q=forms.gle")).toEqual(["satu"]);
    expect(await slugs("?sort=-clickCount")).toEqual(["dua", "tiga", "satu"]);
    expect(await slugs("?sort=slug")).toEqual(["dua", "satu", "tiga"]);
    for (const bad of ["?active=maybe", "?sort=targetUrl", "?sort=-createdBy"]) expect((await call(`${LIST}${bad}`, { cookie })).status, bad).toBe(400);
  });
});

describe("shortlinks: editing and deleting", () => {
  test("an update changes the form's columns; the audit row lists the ones that changed and labels the NEW slug", async () => {
    const { cookie } = await konten();
    const row = await addLink({ slug: "lama", target_url: "https://example.org/a" });
    const res = await call(`${LIST}/${row.id}`, { method: "PUT", cookie, headers: await ifMatch(row.id), json: valid({ slug: "baru", targetUrl: "https://example.org/a", note: null, active: true }) });
    expect(res.status).toBe(200);
    expect(await body(res)).toMatchObject({ item: { id: row.id, slug: "baru" } });
    const update = (await auditRows()).at(-1)!;
    expect(update).toMatchObject({ action: "shortlink.update", resource_type: "shortlink", resource_id: row.id });
    expect(JSON.parse(update.metadata!)).toEqual({ fields: ["slug"], label: "baru" });
  });

  test("a link can be switched off and back on, and retargeted", async () => {
    const { cookie } = await konten();
    const row = await addLink({ slug: "kampanye", target_url: "https://example.org/a" });
    const off = await call(`${LIST}/${row.id}`, { method: "PUT", cookie, headers: await ifMatch(row.id), json: valid({ slug: "kampanye", targetUrl: "https://example.org/a", active: false }) });
    expect(await body(off)).toMatchObject({ item: { active: false } });
    const on = await call(`${LIST}/${row.id}`, { method: "PUT", cookie, headers: await ifMatch(row.id), json: valid({ slug: "kampanye", targetUrl: "https://example.org/b", active: true }) });
    expect(await body(on)).toMatchObject({ item: { active: true, targetUrl: "https://example.org/b" } });
    expect((await auditRows()).map((r) => JSON.parse(r.metadata!).fields)).toEqual([["note", "active"], ["targetUrl", "active"]]);
  });

  test("renaming onto a slug that is taken is a 409; keeping one's own slug is not a clash", async () => {
    const { cookie } = await konten();
    await addLink({ slug: "dipakai" });
    const mine = await addLink({ slug: "milikku" });
    const clash = await call(`${LIST}/${mine.id}`, { method: "PUT", cookie, headers: await ifMatch(mine.id), json: valid({ slug: "dipakai" }) });
    expect(clash.status).toBe(409);
    expect(await clash.json()).toMatchObject({ error: "conflict", fields: { slug: "Slug ini sudah dipakai shortlink lain." } });
    const same = await call(`${LIST}/${mine.id}`, { method: "PUT", cookie, headers: await ifMatch(mine.id), json: valid({ slug: "milikku", note: "ubah catatan" }) });
    expect(same.status).toBe(200);
  });

  test("a save keeps the click count and the time of the last click: they belong to the redirect, not to the form", async () => {
    const { cookie } = await konten();
    const row = await addLink({ slug: "ramai", click_count: 41, last_clicked_at: 1_790_000_000_000 });
    await call(`${LIST}/${row.id}`, { method: "PUT", cookie, headers: await ifMatch(row.id), json: valid({ slug: "ramai", note: "diubah" }) });
    expect(await env.DB.prepare("SELECT click_count, last_clicked_at FROM shortlinks WHERE id = ?").bind(row.id).first()).toEqual({ click_count: 41, last_clicked_at: 1_790_000_000_000 });
  });

  test("a click is not an edit: it leaves updated_at alone, so a form opened before it still saves", async () => {
    const { cookie } = await konten();
    const row = await addLink({ slug: "dibuka" });
    const loaded = await ifMatch(row.id); // what the form holds
    const before = await env.DB.prepare("SELECT updated_at FROM shortlinks WHERE id = ?").bind(row.id).first<{ updated_at: number }>();
    for (let n = 0; n < 3; n++) await env.DB.prepare(CLICK_SQL).bind(Date.now(), row.id).run();
    expect((await env.DB.prepare("SELECT updated_at, click_count FROM shortlinks WHERE id = ?").bind(row.id).first())).toEqual({ updated_at: before!.updated_at, click_count: 3 });

    const saved = await call(`${LIST}/${row.id}`, { method: "PUT", cookie, headers: loaded, json: valid({ slug: "dibuka", note: "disimpan setelah klik" }) });
    expect(saved.status).toBe(200);
    expect(await body(saved)).toMatchObject({ item: { note: "disimpan setelah klik", clickCount: 3 } });
  });

  test("an update needs If-Match (428) and a stale one is refused (409) without a trace", async () => {
    const { cookie } = await konten();
    const row = await addLink({ slug: "awal" });
    const first = await ifMatch(row.id);
    expect((await call(`${LIST}/${row.id}`, { method: "PUT", cookie, json: valid({ slug: "awal" }) })).status).toBe(428);
    expect((await call(`${LIST}/${row.id}`, { method: "PUT", cookie, headers: first, json: valid({ slug: "awal", note: "pertama" }) })).status).toBe(200);
    const late = await call(`${LIST}/${row.id}`, { method: "PUT", cookie, headers: first, json: valid({ slug: "awal", note: "kedua" }) });
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ error: "stale" });
    expect((await env.DB.prepare("SELECT note FROM shortlinks WHERE id = ?").bind(row.id).first<{ note: string }>())?.note).toBe("pertama");
    expect((await auditRows()).map((r) => r.action)).toEqual(["shortlink.update"]);
  });

  test("delete removes the row and writes one audit row that keeps the slug; a missing id is a 404 and an old version is stale", async () => {
    const { email, cookie } = await konten();
    const row = await addLink({ slug: "hilang" });
    expect((await call(`${LIST}/missing`, { method: "DELETE", cookie })).status).toBe(404);
    const old = await ifMatch(row.id);
    await call(`${LIST}/${row.id}`, { method: "PUT", cookie, headers: old, json: valid({ slug: "hilang", note: "diubah dulu" }) });
    expect((await call(`${LIST}/${row.id}`, { method: "DELETE", cookie, headers: old })).status).toBe(409);
    expect(await count("shortlinks")).toBe(1);

    expect((await call(`${LIST}/${row.id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect(await count("shortlinks")).toBe(0);
    const deleted = (await auditRows()).at(-1)!;
    expect(deleted).toMatchObject({ actor_email: email, action: "shortlink.delete", resource_type: "shortlink", resource_id: row.id });
    expect(JSON.parse(deleted.metadata!)).toEqual({ label: "hilang" });
  });

  test("a link that points at an uploaded file keeps that file from being deleted (Shortlink is named)", async () => {
    const { cookie } = await konten();
    const file = await uploaded(cookie, "report", "Brosur.pdf");
    const created = await call(LIST, { method: "POST", cookie, json: valid({ slug: "brosur", targetUrl: file.path }) });
    expect(created.status).toBe(201);
    const refused = await call(`/api/admin/uploads/${file.id}`, { method: "DELETE", cookie });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: "in_use", usedBy: ["Shortlink"] });
    // A path that was never uploaded is still just a path.
    expect((await call(LIST, { method: "POST", cookie, json: valid({ slug: "lain", targetUrl: fakeUploadPath("report") }) })).status).toBe(201);
  });
});
