import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, test } from "vitest";
import type { GrantableArea } from "../src/auth/permissions";
import type { UserRole } from "../src/auth/roles";
import { uploadKinds, type UploadKind } from "../src/uploads/kinds";
import { nameOfKey } from "../src/uploads/key";
import { updateAltText } from "../src/uploads/store";
import { call, signedInCookie, uniqueEmail } from "./helpers";
import { auditRows, clearBucket, mediaRows, pdf, png, upload, type Uploaded } from "./uploads-helpers";

// The Media library's API (SAKEM-117, docs/cloudflare/uploads.md, "The Media library"): the list without a kind, its search and
// filters, the detail with the menus that use a file, and the text alternative. The upload, the picker's `?kind=` list and the
// delete are in test/uploads.test.ts; this file is what the library added on top of them.

beforeEach(clearBucket);

type Page = { items: Item[]; page: number; pageSize: number; total: number; totalPages: number };
interface Item {
  id: string;
  path: string;
  name: string;
  kind: string | null;
  contentType: string;
  size: number;
  width: number | null;
  height: number | null;
  altText: string | null;
  uploadedByName: string | null;
  createdAt: string;
}

const editor = (areas: GrantableArea[] = ["konten", "pendaftaran"]) => signedInCookie(uniqueEmail("editor"), "editor", areas);

async function ok(response: Response): Promise<Uploaded> {
  expect(response.status).toBe(201);
  return (await response.json()) as Uploaded;
}

/** One small valid file per kind (a report is a PDF, the rest take a PNG). */
function sample(kind: UploadKind) {
  return kind === "report" ? { bytes: pdf(), filename: "laporan.pdf" } : { bytes: png(20, 10), filename: "foto.png" };
}

async function list(query: string, cookie: string): Promise<{ status: number; body: Page & { error?: string; param?: string } }> {
  const response = await call(`/api/admin/uploads${query}`, { cookie });
  return { status: response.status, body: (await response.json()) as Page & { error?: string; param?: string } };
}

const names = (page: Page) => page.items.map((item) => item.name);

describe("the library: the list without a kind", () => {
  const callers: { label: string; role: UserRole; areas: GrantableArea[]; sees: number | null }[] = [
    { label: "a student", role: "student", areas: [], sees: null },
    { label: "an editor with no grants", role: "editor", areas: [], sees: null },
    { label: "an editor of konten", role: "editor", areas: ["konten"], sees: 3 },
    { label: "an editor of pendaftaran", role: "editor", areas: ["pendaftaran"], sees: 2 },
    { label: "an editor of both", role: "editor", areas: ["konten", "pendaftaran"], sees: 5 },
    { label: "a viewer", role: "viewer", areas: [], sees: 5 },
    { label: "a super admin", role: "super_admin", areas: [], sees: 5 },
  ];

  // Negative check (scripts/negative-checks-uploads.mjs): list every purpose whatever the caller may read, or drop the refusal
  // for someone who may read none, and these fail.
  for (const caller of callers) {
    test(`${caller.label}: ${caller.sees === null ? "403 and nothing said about what is there" : `the files of the areas they may read (${caller.sees} of 5)`}`, async () => {
      const uploader = await editor();
      for (const kind of uploadKinds) await ok(await upload({ kind, cookie: uploader, ...sample(kind) }));

      const cookie = await signedInCookie(uniqueEmail(caller.role), caller.role, caller.areas);
      const { status, body } = await list("", cookie);
      if (caller.sees === null) {
        expect(status).toBe(403);
        expect(body).toEqual({ error: "forbidden" });
      } else {
        expect(status).toBe(200);
        expect(body.total).toBe(caller.sees);
        expect(body.items).toHaveLength(caller.sees);
      }
    });
  }

  test("nobody signed in: 401", async () => {
    expect((await call("/api/admin/uploads")).status).toBe(401);
    expect((await call("/api/admin/uploads?q=a")).status).toBe(401);
  });

  test("it holds every kind in one list, newest first, and ?kind= still narrows it to one", async () => {
    const cookie = await editor();
    const paths: string[] = [];
    for (const kind of ["blog-image", "team-photo", "report"] as const) {
      paths.push((await ok(await upload({ kind, cookie, ...sample(kind) }))).path);
      await new Promise((resolve) => setTimeout(resolve, 3)); // distinct created_at
    }
    const all = await list("", cookie);
    expect(all.body.items.map((item) => item.path)).toEqual([...paths].reverse());
    expect(all.body.items.map((item) => item.kind)).toEqual(["report", "team-photo", "blog-image"]);
    expect((await list("?kind=team-photo", cookie)).body.items.map((item) => item.path)).toEqual([paths[1]]);
  });

  test("a page is bounded like a picker's: 50 at most, junk falls back to the defaults", async () => {
    const cookie = await editor();
    expect((await list("?pageSize=9999&page=-3", cookie)).body).toMatchObject({ page: 1, pageSize: 50 });
    expect((await list("?pageSize=abc&page=x", cookie)).body).toMatchObject({ page: 1, pageSize: 20 });
  });

  test("a file is shown by its name, its kind, its text alternative and who uploaded it by name, and by nothing else about them", async () => {
    const email = uniqueEmail("editor");
    const cookie = await signedInCookie(email, "editor", ["konten"]);
    const mine = await env.DB.prepare("SELECT id, name FROM users WHERE email = ?").bind(email).first<{ id: string; name: string }>();
    const uploaded = await ok(await upload({ kind: "blog-image", cookie, bytes: png(14, 20), filename: "Hero Kelas.PNG" }));

    const response = await call("/api/admin/uploads", { cookie });
    const text = await response.text();
    const item = (JSON.parse(text) as Page).items[0]!;
    expect(Object.keys(item).sort()).toEqual(["altText", "contentType", "createdAt", "height", "id", "kind", "name", "path", "size", "uploadedByName", "width"]);
    expect(item).toMatchObject({ id: uploaded.id, path: uploaded.path, name: "hero-kelas.png", kind: "blog-image", contentType: "image/png", width: 14, height: 20, altText: null, uploadedByName: mine!.name });
    expect(new Date(item.createdAt).toISOString()).toBe(item.createdAt);
    // Not the key, the uploader's id or their e-mail address.
    expect(text).not.toContain(mine!.id);
    expect(text).not.toContain(email);
    expect(text).not.toContain('"key"');
  });

  test("nameOfKey drops the media id and keeps the slug and the extension", () => {
    expect(nameOfKey("uploads/blog-image/2026/0b8d1f5e-2b6f-4d2a-9d53-9a6f2d3c8f10-hero-kelas.webp")).toBe("hero-kelas.webp");
    expect(nameOfKey("uploads/report/2026/0b8d1f5e-2b6f-4d2a-9d53-9a6f2d3c8f10-laporan-2025.pdf")).toBe("laporan-2025.pdf");
    expect(nameOfKey("no-folder.png")).toBe("no-folder.png");
  });
});

describe("the library: search and filters", () => {
  /** A hero, a report and a photo, with the dates `from` and `to` are tried on. */
  async function seed() {
    const cookie = await editor();
    const hero = await ok(await upload({ kind: "blog-image", cookie, bytes: png(10, 10), filename: "Hero Kelas.png" }));
    const report = await ok(await upload({ kind: "report", cookie, bytes: pdf(), filename: "Laporan 2025.pdf" }));
    const photo = await ok(await upload({ kind: "team-photo", cookie, bytes: png(12, 12), filename: "foto_ibu.png" }));
    const at = (iso: string, id: string) => env.DB.prepare("UPDATE media SET created_at = ? WHERE id = ?").bind(Date.parse(iso), id).run();
    await at("2026-10-01T00:00:00.000Z", hero.id);
    await at("2026-10-02T00:00:00.000Z", report.id);
    await at("2026-10-03T12:00:00.000Z", photo.id);
    return { cookie, hero, report, photo };
  }

  // Negative check (scripts/negative-checks-uploads.mjs): search the whole key and "blog" finds every blog image, a folder name.
  test("q looks at the file's name, without case, and not at the folders of its key", async () => {
    const { cookie } = await seed();
    expect(names((await list("?q=hero", cookie)).body)).toEqual(["hero-kelas.png"]);
    expect(names((await list("?q=HERO", cookie)).body)).toEqual(["hero-kelas.png"]);
    expect(names((await list("?q=.pdf", cookie)).body)).toEqual(["laporan-2025.pdf"]);
    for (const folder of ["blog", "uploads", "team-photo", "2026"]) expect((await list(`?q=${folder}`, cookie)).body.total, folder).toBe(0);
  });

  test("q also looks at the text alternative, once someone has written one", async () => {
    const { cookie, photo } = await seed();
    expect((await list("?q=membaca", cookie)).body.total).toBe(0);
    expect((await call(`/api/admin/uploads/${photo.id}`, { method: "PATCH", cookie, json: { altText: "Anak membaca di Perpustakaan" } })).status).toBe(200);
    expect(names((await list("?q=membaca", cookie)).body)).toEqual(["foto-ibu.png"]);
    expect(names((await list("?q=PERPUSTAKAAN", cookie)).body)).toEqual(["foto-ibu.png"]);
  });

  // Negative check: turn instr into LIKE and "%" finds everything.
  test("q is plain text: a % or an _ matches only itself", async () => {
    const { cookie } = await seed();
    for (const q of ["%", "_", "%25", "%25%25"]) expect((await list(`?q=${q}`, cookie)).body.total, q).toBe(0);
  });

  test("q: blank is no search, 100 characters is the longest, 101 is refused", async () => {
    const { cookie } = await seed();
    expect((await list("?q=%20%20", cookie)).body.total).toBe(3);
    expect((await list(`?q=${"a".repeat(100)}`, cookie)).status).toBe(200);
    const refused = await list(`?q=${"a".repeat(101)}`, cookie);
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ error: "invalid_query", param: "q" });
  });

  test("type: image, pdf, or nothing; any other value is refused", async () => {
    const { cookie } = await seed();
    expect(names((await list("?type=image", cookie)).body).sort()).toEqual(["foto-ibu.png", "hero-kelas.png"]);
    expect(names((await list("?type=pdf", cookie)).body)).toEqual(["laporan-2025.pdf"]);
    expect((await list("?type=", cookie)).body.total).toBe(3);
    const refused = await list("?type=gif", cookie);
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ error: "invalid_query", param: "type" });
  });

  test("from is the start of a day and to is where the next begins: [from, to)", async () => {
    const { cookie } = await seed();
    expect(names((await list("?from=2026-10-02", cookie)).body)).toEqual(["foto-ibu.png", "laporan-2025.pdf"]);
    expect(names((await list("?to=2026-10-02", cookie)).body)).toEqual(["hero-kelas.png"]);
    expect(names((await list("?from=2026-10-02&to=2026-10-03", cookie)).body)).toEqual(["laporan-2025.pdf"]);
    // A full instant, with its own zone: 2026-10-02 00:00 in WIB is the evening before in UTC.
    expect(names((await list("?from=2026-10-02T00:00:00%2B07:00", cookie)).body)).toEqual(["foto-ibu.png", "laporan-2025.pdf"]);
    expect(names((await list("?from=2026-10-02T00:00:01Z", cookie)).body)).toEqual(["foto-ibu.png"]);
  });

  test("a date that is not a date is refused, with the name of the parameter: a bare number is not a year", async () => {
    const { cookie } = await seed();
    for (const [param, value] of [["from", "1"], ["from", "besok"], ["to", "2026-13-45"], ["to", "2026-10-02T25:00:00Z"], ["from", "2026-10-02 10:00"]] as const) {
      const refused = await list(`?${param}=${encodeURIComponent(value)}`, cookie);
      expect(refused.status, `${param}=${value}`).toBe(400);
      expect(refused.body, `${param}=${value}`).toMatchObject({ error: "invalid_query", param });
    }
  });

  test("the search and the filters work together, and the count follows them", async () => {
    const { cookie } = await seed();
    const page = (await list("?type=image&from=2026-10-03&pageSize=1", cookie)).body;
    expect(names(page)).toEqual(["foto-ibu.png"]);
    expect(page).toMatchObject({ total: 1, totalPages: 1 });
    const two = (await list("?type=image&pageSize=1", cookie)).body;
    expect(two).toMatchObject({ total: 2, totalPages: 2 });
  });

  test("an editor's search stays inside the areas they may read: a pendaftaran editor never finds a blog image", async () => {
    const { cookie: uploader } = await seed();
    const pendaftaran = await editor(["pendaftaran"]);
    expect((await list("?q=hero", uploader)).body.total).toBe(1);
    expect((await list("?q=hero", pendaftaran)).body.total).toBe(0);
    expect((await list("?q=", pendaftaran)).body.total).toBe(0); // the only pendaftaran kinds have no file here
  });
});

describe("GET /api/admin/uploads/:id: one file and where it is used", () => {
  test("the file, and the menus that point at it, once each", async () => {
    const cookie = await editor();
    const uploaded = await ok(await upload({ kind: "report", cookie, ...sample("report") }));
    const first = (await (await call(`/api/admin/uploads/${uploaded.id}`, { cookie })).json()) as { item: Item; usedBy: string[] };
    expect(first.item).toMatchObject({ id: uploaded.id, path: uploaded.path, kind: "report", contentType: "application/pdf", altText: null });
    expect(first.usedBy).toEqual([]);

    await env.DB.prepare("INSERT INTO reports (id, title, category, year, file_path, file_size) VALUES (?, 'Laporan', 'yearly', '2025', ?, 10)").bind(crypto.randomUUID(), uploaded.path).run();
    await env.DB.prepare("INSERT INTO shortlinks (id, slug, target_url) VALUES (?, 's-unduh', ?)").bind(crypto.randomUUID(), uploaded.path).run();
    const used = (await (await call(`/api/admin/uploads/${uploaded.id}`, { cookie })).json()) as { usedBy: string[] };
    expect([...used.usedBy].sort()).toEqual(["Laporan", "Shortlink"]);
  });

  test("401 for nobody, 404 for an id that is not one or not there, 403 outside the caller's areas, 200 for a viewer", async () => {
    const cookie = await editor();
    const uploaded = await ok(await upload({ kind: "blog-image", cookie, bytes: png(5, 5) }));
    expect((await call(`/api/admin/uploads/${uploaded.id}`)).status).toBe(401);
    for (const id of ["abc", "..%2Fetc", crypto.randomUUID()]) expect((await call(`/api/admin/uploads/${id}`, { cookie })).status, id).toBe(404);
    const pendaftaran = await editor(["pendaftaran"]);
    const refused = await call(`/api/admin/uploads/${uploaded.id}`, { cookie: pendaftaran });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "forbidden" });
    const viewer = await signedInCookie(uniqueEmail("viewer"), "viewer");
    expect((await call(`/api/admin/uploads/${uploaded.id}`, { cookie: viewer })).status).toBe(200);
    const student = await signedInCookie(uniqueEmail("student"), "student");
    expect((await call(`/api/admin/uploads/${uploaded.id}`, { cookie: student })).status).toBe(403);
  });
});

describe("PATCH /api/admin/uploads/:id: the text alternative", () => {
  const patch = (id: string, cookie: string, json: unknown) => call(`/api/admin/uploads/${id}`, { method: "PATCH", cookie, json });
  const altOf = async (id: string) => (await env.DB.prepare("SELECT alt_text FROM media WHERE id = ?").bind(id).first<{ alt_text: string | null }>())!.alt_text;

  test("it is saved trimmed, answered with the file, and an empty text or null clears it", async () => {
    const cookie = await editor();
    const uploaded = await ok(await upload({ kind: "blog-image", cookie, bytes: png(5, 5) }));

    const saved = await patch(uploaded.id, cookie, { altText: "  Anak membaca buku di perpustakaan.  " });
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as { item: Item }).item).toMatchObject({ id: uploaded.id, altText: "Anak membaca buku di perpustakaan." });
    expect(await altOf(uploaded.id)).toBe("Anak membaca buku di perpustakaan.");

    expect(((await (await patch(uploaded.id, cookie, { altText: "   " })).json()) as { item: Item }).item.altText).toBeNull();
    expect(await altOf(uploaded.id)).toBeNull();
    await patch(uploaded.id, cookie, { altText: "Lagi" });
    expect(((await (await patch(uploaded.id, cookie, { altText: null })).json()) as { item: Item }).item.altText).toBeNull();
  });

  test("300 characters is the longest; 301, a number or a missing field is refused with the field named, and nothing changes", async () => {
    const cookie = await editor();
    const uploaded = await ok(await upload({ kind: "blog-image", cookie, bytes: png(5, 5) }));
    expect((await patch(uploaded.id, cookie, { altText: "a".repeat(300) })).status).toBe(200);

    for (const json of [{ altText: "a".repeat(301) }, { altText: 5 }, {}, { teks: "x" }]) {
      const refused = await patch(uploaded.id, cookie, json);
      expect(refused.status, JSON.stringify(json).slice(0, 30)).toBe(400);
      expect(await refused.json()).toMatchObject({ error: "invalid", fields: { altText: expect.any(String) } });
    }
    expect(await altOf(uploaded.id)).toBe("a".repeat(300));
  });

  test("the change is audited by who and which field, never with the text; a refusal writes nothing", async () => {
    const email = uniqueEmail("editor");
    const cookie = await signedInCookie(email, "editor", ["konten"]);
    const uploaded = await ok(await upload({ kind: "blog-image", cookie, bytes: png(5, 5) }));
    await patch(uploaded.id, cookie, { altText: "a".repeat(301) });
    await patch(uploaded.id, cookie, { altText: "Teks rahasia untuk gambar" });

    const audit = await auditRows();
    expect(audit.map((row) => row.action)).toEqual(["upload.create", "upload.update"]);
    expect(audit[1]).toMatchObject({ actor_email: email, resource_type: "media", resource_id: uploaded.id });
    expect(JSON.parse(audit[1]!.metadata)).toEqual({ fields: ["altText"] });
    expect(audit[1]!.metadata).not.toContain("rahasia");
  });

  test("only the text alternative changes: the key, the type, the size and the dimensions stay", async () => {
    const cookie = await editor();
    const uploaded = await ok(await upload({ kind: "team-photo", cookie, bytes: png(7, 9) }));
    const before = (await mediaRows())[0]!;
    await patch(uploaded.id, cookie, { altText: "Foto" });
    expect((await mediaRows())[0]).toEqual(before);
  });

  // Negative check (scripts/negative-checks-uploads.mjs): drop the area check and a viewer, or an editor of another area, writes.
  test("who may: the area that owns the file may write; a viewer, an editor of another area and a student may not; nobody gets 401", async () => {
    const cookie = await editor();
    const uploaded = await ok(await upload({ kind: "blog-image", cookie, bytes: png(5, 5) }));
    expect((await call(`/api/admin/uploads/${uploaded.id}`, { method: "PATCH", json: { altText: "x" } })).status).toBe(401);
    const others = [
      ["a viewer", await signedInCookie(uniqueEmail("viewer"), "viewer")],
      ["an editor of pendaftaran", await editor(["pendaftaran"])],
      ["a student", await signedInCookie(uniqueEmail("student"), "student")],
    ] as const;
    for (const [label, other] of others) {
      const refused = await patch(uploaded.id, other, { altText: "x" });
      expect(refused.status, label).toBe(403);
      expect(await refused.json(), label).toEqual({ error: "forbidden" });
    }
    expect(await altOf(uploaded.id)).toBeNull();
    expect((await patch(uploaded.id, await editor(["konten"]), { altText: "ok" })).status).toBe(200);
    expect((await patch(uploaded.id, await signedInCookie(uniqueEmail("admin"), "super_admin"), { altText: "admin" })).status).toBe(200);
  });

  test("404 for an id that is not one or not there, with no audit row; not JSON is 415", async () => {
    const cookie = await editor();
    for (const id of ["abc", crypto.randomUUID()]) expect((await patch(id, cookie, { altText: "x" })).status, id).toBe(404);
    expect(await auditRows()).toEqual([]);

    const uploaded = await ok(await upload({ kind: "blog-image", cookie, bytes: png(5, 5) }));
    const form = await call(`/api/admin/uploads/${uploaded.id}`, { method: "PATCH", cookie, body: "altText=x", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(form.status).toBe(415);
    expect(await altOf(uploaded.id)).toBeNull();
  });

  // The audit row is conditional on the row being there (the same shape as a delete's), so a media row that vanished between the
  // check of the route and the write leaves no audit entry for a change that did not happen.
  test("updateAltText on a row that is not there changes nothing and writes no audit row", async () => {
    const email = uniqueEmail("editor");
    await signedInCookie(email, "editor", ["konten"]);
    const actor = (await env.DB.prepare("SELECT id, email FROM users WHERE email = ?").bind(email).first<{ id: string; email: string }>())!;
    expect(await updateAltText(env, actor, crypto.randomUUID(), "Tidak ada")).toBe(false);
    expect(await auditRows()).toEqual([]);
  });
});
