import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { CrudDeps } from "../src/api/crud";
import { createResourceRoutes } from "../src/api/resources";
import { deleteUploadByPath } from "../src/uploads/store";
import type { ContentChange } from "../src/public/purge";
import { appAround } from "./crud-app";
import { call, signedInCookie, uniqueEmail } from "./helpers";
import { addResourceRow, audit, count, etagOfRow, MATRIX, rowOf } from "./pendaftaran-helpers";
import { internalFetch } from "./public-helpers";
import { clearBucket, mediaRows, objectKeys, pdf, png, upload, type Uploaded } from "./uploads-helpers";

// Pusat Dokumen (SAKEM-082, area `pendaftaran`): a port of app/(admin)/admin/resources/*. The form and its rules,
// the three shapes of a row, the list in the public page's order, the cleanup of the files a row held, the purge
// of the public page, and that the public payload follows what the admin does.

const LIST = "/api/admin/resources";

const editor = () => signedInCookie(uniqueEmail("editor"), "editor", ["pendaftaran"]);
const viewer = () => signedInCookie(uniqueEmail("viewer"), "viewer");

async function body<T = Record<string, unknown>>(response: Response) {
  return (await response.json()) as T;
}

const file = { title: "Panduan Pendaftaran", description: "Baca dulu", category: "panduan", displayOrder: 10, contentType: "file", filePath: "/resources/panduan.pdf", fileSize: 12345, notes: "Dari panitia" };
const link = { title: "Video Token Listrik", category: "tutorial", displayOrder: 5, contentType: "url", externalUrl: "https://youtube.com/watch?v=abc" };
const snippet = { title: "Caption Instagram", category: "berkas-marketing", displayOrder: 1, contentType: "text", bodyText: "Aku daftar di Sakola Kembara!" };

type Item = Record<string, unknown> & { id: string; updatedAt: string; contentType: string };

const create = (cookie: string, json: unknown) => call(LIST, { method: "POST", cookie, json });
async function made(cookie: string, json: unknown) {
  const res = await create(cookie, json);
  expect(res.status, JSON.stringify(json)).toBe(201);
  return (await body<{ item: Item }>(res)).item;
}

/** Uploads a real PDF as an editor of pendaftaran and returns what the upload answered with. */
async function uploaded(cookie: string, name = "panduan.pdf"): Promise<Uploaded> {
  const res = await upload({ kind: "resource", bytes: pdf(), filename: name, claimedType: "application/pdf", cookie });
  expect(res.status).toBe(201);
  return (await res.json()) as Uploaded;
}

beforeEach(clearBucket);

describe("resources: who may do what", () => {
  test("nobody signed in: 401 on every route", async () => {
    const row = await addResourceRow();
    const results = await Promise.all([call(LIST), call(`${LIST}/${row.id}`), call(LIST, { method: "POST", json: file }), call(`${LIST}/${row.id}`, { method: "PUT", json: file }), call(`${LIST}/${row.id}`, { method: "DELETE" })]);
    expect(results.map((res) => res.status)).toEqual([401, 401, 401, 401, 401]);
    expect(await count("audit_log")).toBe(0);
  });

  // Negative test (scripts/negative-checks-pendaftaran.mjs): take the area check off a write route and a case below passes the guard.
  for (const { label, role, areas, read, write } of MATRIX) {
    test(`${label}: read ${read ? 200 : 403}, write ${write ? "allowed" : 403}`, async () => {
      const cookie = await signedInCookie(uniqueEmail(role), role, areas);
      const target = await addResourceRow({ title: "Sasaran" });
      const deletable = await addResourceRow({ title: "Hapus" });

      expect([(await call(LIST, { cookie })).status, (await call(`${LIST}/${target.id}`, { cookie })).status]).toEqual(read ? [200, 200] : [403, 403]);

      const created = await create(cookie, link);
      const updated = await call(`${LIST}/${target.id}`, { method: "PUT", cookie, headers: await etagOfRow("site_resources", target.id), json: { ...file, title: "Baru" } });
      const deleted = await call(`${LIST}/${deletable.id}`, { method: "DELETE", cookie });
      if (write) {
        expect([created.status, updated.status, deleted.status]).toEqual([201, 200, 204]);
        expect((await audit()).map((row) => row.action)).toEqual(["resource.create", "resource.update", "resource.delete"]);
      } else {
        expect([created.status, updated.status, deleted.status]).toEqual([403, 403, 403]);
        expect(await count("site_resources")).toBe(2);
        expect((await rowOf<{ title: string }>("site_resources", target.id))?.title).toBe("Sasaran");
        expect(await count("audit_log")).toBe(0);
      }
    });
  }
});

describe("resources: the three shapes of a row", () => {
  test("a file: the path and the size are stored, the other shapes are null, and the audit row names fields and the title", async () => {
    const email = uniqueEmail("editor");
    const cookie = await signedInCookie(email, "editor", ["pendaftaran"]);
    const res = await create(cookie, file);
    expect(res.status).toBe(201);
    const { item } = await body<{ item: Item }>(res);
    expect(item).toMatchObject({ title: "Panduan Pendaftaran", description: "Baca dulu", category: "panduan", displayOrder: 10, contentType: "file", filePath: "/resources/panduan.pdf", fileSize: 12345, externalUrl: null, bodyText: null, notes: "Dari panitia" });
    expect(Object.keys(item).sort()).toEqual(["bodyText", "category", "contentType", "createdAt", "description", "displayOrder", "externalUrl", "filePath", "fileSize", "id", "notes", "title", "updatedAt"]);
    expect(res.headers.get("etag")).toBe(`"${item.updatedAt}"`);

    const row = await rowOf<{ updated_by: string }>("site_resources", item.id);
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
    expect(row?.updated_by).toBe(user?.id);
    const rows = await audit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_email: email, action: "resource.create", resource_type: "site_resource", resource_id: item.id });
    expect(JSON.parse(rows[0]!.metadata!)).toEqual({
      fields: ["title", "description", "category", "displayOrder", "contentType", "filePath", "fileSize", "externalUrl", "bodyText", "notes", "updatedBy"],
      label: "Panduan Pendaftaran",
    });
  });

  test("a link and a text: only their own column is set, whatever else the form carried", async () => {
    const cookie = await editor();
    const url = await made(cookie, { ...link, filePath: "/resources/lama.pdf", fileSize: 10, bodyText: "sisa teks" });
    expect(url).toMatchObject({ contentType: "url", externalUrl: link.externalUrl, filePath: null, fileSize: null, bodyText: null });
    const text = await made(cookie, { ...snippet, externalUrl: "https://example.test", filePath: "/resources/lama.pdf", fileSize: 10 });
    expect(text).toMatchObject({ contentType: "text", bodyText: snippet.bodyText, externalUrl: null, filePath: null, fileSize: null });
    // The table's own CHECK would have refused anything else; this is the form saying it first.
    expect(await count("site_resources")).toBe(2);
  });

  test("the text and the description are trimmed, an empty description or note is stored as none", async () => {
    const cookie = await editor();
    const item = await made(cookie, { ...snippet, title: "  Caption  ", description: "   ", notes: "", bodyText: "  salin  " });
    expect(item).toMatchObject({ title: "Caption", description: null, notes: null, bodyText: "salin" });
  });

  test("a file uploaded through the admin is accepted (`/uploads/resource/...`), and so is a legacy `/resources/...` path", async () => {
    const cookie = await editor();
    const upl = await uploaded(cookie);
    expect(upl.path).toMatch(/^\/uploads\/resource\//);
    expect(await made(cookie, { ...file, filePath: upl.path, fileSize: upl.size })).toMatchObject({ filePath: upl.path, fileSize: upl.size });
    expect(await made(cookie, { ...file, filePath: "/resources/lama.pdf" })).toMatchObject({ filePath: "/resources/lama.pdf" });
  });
});

describe("resources: the form keeps the legacy rules and messages, in the one 400 shape", () => {
  async function refuse(input: Record<string, unknown>) {
    const cookie = await editor();
    const res = await create(cookie, input);
    expect(res.status, JSON.stringify(input).slice(0, 120)).toBe(400);
    const json = await body<{ error: string; message: string; fields: Record<string, string> }>(res);
    expect(json).toMatchObject({ error: "invalid", message: "Periksa kembali isian formulir." });
    expect(await count("site_resources")).toBe(0);
    expect(await count("audit_log")).toBe(0);
    return json.fields;
  }

  test("the title: 2 to 200 characters, trimmed", async () => {
    expect(await refuse({ ...file, title: "a" })).toEqual({ title: "Judul minimal 2 karakter" });
    expect(await refuse({ ...file, title: "   a  " })).toEqual({ title: "Judul minimal 2 karakter" });
    expect(await refuse({ ...file, title: "x".repeat(201) })).toEqual({ title: "Judul maksimal 200 karakter" });
    const { title: _title, ...noTitle } = file;
    expect(await refuse(noTitle)).toEqual({ title: "Wajib diisi." });
  });

  test("the description, the note and the text have their limits", async () => {
    expect(await refuse({ ...file, description: "x".repeat(1001) })).toEqual({ description: "Deskripsi maksimal 1000 karakter" });
    expect(await refuse({ ...file, notes: "x".repeat(501) })).toEqual({ notes: "Catatan maksimal 500 karakter" });
    expect(await refuse({ ...snippet, bodyText: "x".repeat(10_001) })).toEqual({ bodyText: "Teks maksimal 10.000 karakter" });
  });

  test("the category and the type must be known", async () => {
    expect(await refuse({ ...file, category: "rahasia" })).toEqual({ category: "Kategori tidak dikenal" });
    expect(await refuse({ ...file, contentType: "video" })).toEqual({ contentType: "Tipe konten tidak dikenal" });
  });

  test("the order: a whole number from 0 to 9999", async () => {
    expect(await refuse({ ...file, displayOrder: -1 })).toEqual({ displayOrder: "Tidak boleh negatif" });
    expect(await refuse({ ...file, displayOrder: 10_000 })).toEqual({ displayOrder: "Maksimal 9999" });
    expect(await refuse({ ...file, displayOrder: 1.5 })).toEqual({ displayOrder: "Harus bilangan bulat" });
    expect(await refuse({ ...file, displayOrder: "abc" })).toEqual({ displayOrder: "Wajib diisi" });
  });

  test("a link needs a URL, and it must be a web address", async () => {
    expect(await refuse({ ...link, externalUrl: "" })).toEqual({ externalUrl: "URL wajib diisi untuk tipe Link Eksternal." });
    const { externalUrl: _url, ...noUrl } = link;
    expect(await refuse(noUrl)).toEqual({ externalUrl: "URL wajib diisi untuk tipe Link Eksternal." });
    expect(await refuse({ ...link, externalUrl: "bukan url" })).toEqual({ externalUrl: "Format URL tidak valid" });
    expect(await refuse({ ...link, externalUrl: "x".repeat(501) })).toEqual({ externalUrl: "URL maksimal 500 karakter" });
  });

  // The public page puts this URL in a link: a `javascript:` URL would run in the visitor's browser.
  test("only http and https links are stored (the public page makes them clickable)", async () => {
    for (const externalUrl of ["javascript:alert(document.cookie)", "data:text/html,<script>alert(1)</script>", "ftp://example.test/x", "file:///etc/passwd", "//example.test/x", "/halaman-dalam"]) {
      expect(await refuse({ ...link, externalUrl }), externalUrl).toEqual({ externalUrl: "Format URL tidak valid" });
    }
    const cookie = await editor();
    for (const externalUrl of ["https://drive.google.com/file/d/abc/view", "http://example.test/x?y=1#z"]) {
      expect((await create(cookie, { ...link, externalUrl })).status, externalUrl).toBe(201);
    }
  });

  test("a text needs its text", async () => {
    expect(await refuse({ ...snippet, bodyText: "" })).toEqual({ bodyText: "Isi teks yang bisa disalin." });
    expect(await refuse({ ...snippet, bodyText: "   " })).toEqual({ bodyText: "Isi teks yang bisa disalin." });
  });

  test("a file needs its path and its size, the path must be one an upload or the legacy folder makes, and the size at most 25 MB", async () => {
    expect(await refuse({ ...file, filePath: "" })).toEqual({ filePath: "File wajib diupload." });
    expect(await refuse({ ...file, filePath: null })).toEqual({ filePath: "File wajib diupload." });
    expect(await refuse({ ...file, fileSize: null })).toEqual({ filePath: "File wajib diupload." });
    const { fileSize: _size, ...noSize } = file;
    expect(await refuse(noSize)).toEqual({ filePath: "File wajib diupload." });
    for (const filePath of [
      "https://example.test/x.pdf",
      "javascript:alert(1)",
      "/etc/passwd",
      "/resources/../etc/passwd",
      "/uploads/report/2026/0b8d1f5e-2b6f-4d2a-9d53-9a6f2d3c8f10-laporan.pdf", // another kind's folder
      "/uploads/resource/2026/tidak-sesuai-bentuk.pdf",
      "/uploads/resource/2026/0b8d1f5e-2b6f-4d2a-9d53-9a6f2d3c8f10-x.exe",
    ]) {
      expect(await refuse({ ...file, filePath }), filePath).toEqual({ filePath: "Berkas tidak valid. Unggah ulang berkasnya." });
    }
    expect(await refuse({ ...file, fileSize: 25_000_001 })).toEqual({ fileSize: "Ukuran file maksimal 25 MB." });
    expect(await refuse({ ...file, fileSize: -1 })).toEqual({ fileSize: "Ukuran file tidak valid" });
    const cookie = await editor();
    expect((await create(cookie, { ...file, fileSize: 25_000_000 })).status).toBe(201);
  });

  test("a body that is not JSON is refused", async () => {
    const cookie = await editor();
    const form = await call(LIST, { method: "POST", cookie, headers: { "content-type": "application/x-www-form-urlencoded" }, body: "title=Halo" });
    const broken = await call(LIST, { method: "POST", cookie, headers: { "content-type": "application/json" }, body: "{nope" });
    expect([form.status, broken.status]).toEqual([415, 400]);
    expect(await count("site_resources")).toBe(0);
  });
});

describe("resources: edit and delete", () => {
  test("an edit needs If-Match (428), a stale one is 409 without a trace, and the audit row names only what changed", async () => {
    const cookie = await editor();
    const item = await made(cookie, file);
    const first = await etagOfRow("site_resources", item.id);
    const form = (over: Record<string, unknown>) => ({ ...file, ...over });

    expect((await call(`${LIST}/${item.id}`, { method: "PUT", cookie, json: form({ title: "Tanpa versi" }) })).status).toBe(428);
    const saved = await call(`${LIST}/${item.id}`, { method: "PUT", cookie, headers: first, json: form({ title: "Versi pertama" }) });
    expect(saved.status).toBe(200);
    const late = await call(`${LIST}/${item.id}`, { method: "PUT", cookie, headers: first, json: form({ title: "Versi kedua" }) });
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ error: "stale" });
    expect((await rowOf<{ title: string }>("site_resources", item.id))?.title).toBe("Versi pertama");
    const rows = await audit();
    expect(rows.map((row) => row.action)).toEqual(["resource.create", "resource.update"]);
    expect(JSON.parse(rows[1]!.metadata!)).toEqual({ fields: ["title"], label: "Versi pertama" });
  });

  test("a resource that does not exist is 404", async () => {
    const cookie = await editor();
    expect((await call(`${LIST}/tidak-ada`, { cookie })).status).toBe(404);
    expect((await call(`${LIST}/tidak-ada`, { method: "PUT", cookie, headers: { "if-match": '"2026-01-01T00:00:00.000Z"' }, json: file })).status).toBe(404);
    expect((await call(`${LIST}/tidak-ada`, { method: "DELETE", cookie })).status).toBe(404);
  });

  test("the type can be changed: the new shape is stored and the old column is emptied", async () => {
    const cookie = await editor();
    const item = await made(cookie, file);
    const res = await call(`${LIST}/${item.id}`, { method: "PUT", cookie, headers: await etagOfRow("site_resources", item.id), json: { ...link, title: file.title } });
    expect(res.status).toBe(200);
    expect(await rowOf("site_resources", item.id)).toMatchObject({ content_type: "url", external_url: link.externalUrl, file_path: null, file_size: null, body_text: null });
  });

  test("delete removes the row, and writes an audit row that keeps the id and the title", async () => {
    const cookie = await editor();
    const item = await made(cookie, snippet);
    expect((await call(`${LIST}/${item.id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect(await count("site_resources")).toBe(0);
    const rows = await audit();
    expect(rows.map((row) => row.action)).toEqual(["resource.create", "resource.delete"]);
    expect(rows[1]).toMatchObject({ resource_type: "site_resource", resource_id: item.id });
    expect(JSON.parse(rows[1]!.metadata!)).toEqual({ label: snippet.title });
  });
});

describe("resources: the files a row held (R2, docs/cloudflare/uploads.md)", () => {
  const withCleanup: CrudDeps = { notify: () => undefined, deleteUpload: deleteUploadByPath };
  const via = () => appAround({ "/api/admin/resources": createResourceRoutes(withCleanup) });
  const send = (path: string, init: Parameters<typeof call>[1]) => call(path, { ...init, via: via() });

  test("replacing the file removes the old one from the bucket and from the media table, after the save", async () => {
    const cookie = await editor();
    const first = await uploaded(cookie, "satu.pdf");
    const item = (await body<{ item: Item }>(await send(LIST, { method: "POST", cookie, json: { ...file, filePath: first.path, fileSize: first.size } }))).item;
    const second = await uploaded(cookie, "dua.pdf");
    expect((await objectKeys()).length).toBe(2);

    const res = await send(`${LIST}/${item.id}`, { method: "PUT", cookie, headers: await etagOfRow("site_resources", item.id), json: { ...file, filePath: second.path, fileSize: second.size } });
    expect(res.status).toBe(200);
    expect(await objectKeys()).toEqual([second.path.slice(1)]);
    expect((await mediaRows()).map((row) => row.id)).toEqual([second.id]);
    expect((await audit()).map((row) => row.action)).toContain("upload.delete");
  });

  test("switching to a link or a text removes the file the row held", async () => {
    const cookie = await editor();
    const upl = await uploaded(cookie);
    const item = (await body<{ item: Item }>(await send(LIST, { method: "POST", cookie, json: { ...file, filePath: upl.path, fileSize: upl.size } }))).item;
    await send(`${LIST}/${item.id}`, { method: "PUT", cookie, headers: await etagOfRow("site_resources", item.id), json: { ...snippet, title: file.title } });
    expect(await objectKeys()).toEqual([]);
    expect(await mediaRows()).toEqual([]);
  });

  test("deleting the row removes its file", async () => {
    const cookie = await editor();
    const upl = await uploaded(cookie);
    const item = (await body<{ item: Item }>(await send(LIST, { method: "POST", cookie, json: { ...file, filePath: upl.path, fileSize: upl.size } }))).item;
    expect((await send(`${LIST}/${item.id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect(await objectKeys()).toEqual([]);
    expect(await mediaRows()).toEqual([]);
  });

  test("a file that another row still uses is never removed", async () => {
    const cookie = await editor();
    const upl = await uploaded(cookie);
    const a = (await body<{ item: Item }>(await send(LIST, { method: "POST", cookie, json: { ...file, title: "Dok A", filePath: upl.path, fileSize: upl.size } }))).item;
    await send(LIST, { method: "POST", cookie, json: { ...file, title: "Dok B", filePath: upl.path, fileSize: upl.size } });
    expect((await send(`${LIST}/${a.id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect(await objectKeys()).toEqual([upl.path.slice(1)]);
  });

  test("a legacy static path is not ours: replacing or deleting it touches no object", async () => {
    const cookie = await editor();
    const upl = await uploaded(cookie); // an unrelated object that must stay
    const item = (await body<{ item: Item }>(await send(LIST, { method: "POST", cookie, json: { ...file, filePath: "/resources/lama.pdf" } }))).item;
    await send(`${LIST}/${item.id}`, { method: "DELETE", cookie });
    expect(await objectKeys()).toEqual([upl.path.slice(1)]);
  });

  test("an image is as good as a PDF for a document; the upload rules themselves are those of docs/cloudflare/uploads.md", async () => {
    const cookie = await editor();
    const res = await upload({ kind: "resource", bytes: png(20, 10), filename: "poster.png", claimedType: "image/png", cookie });
    expect(res.status).toBe(201);
    const upl = (await res.json()) as Uploaded;
    expect((await create(cookie, { ...file, filePath: upl.path, fileSize: upl.size })).status).toBe(201);
  });
});

describe("resources: the public page is told, and what it is told is true", () => {
  const notify = vi.fn<(change: ContentChange) => void>();
  afterEach(() => notify.mockReset());
  const app = () => appAround({ "/api/admin/resources": createResourceRoutes({ notify: (change) => notify(change), deleteUpload: async () => ({ status: "not_found" }) }) });

  test("create, update and delete each ask for a purge of the public resources", async () => {
    const cookie = await editor();
    const via = app();
    const created = await call(LIST, { method: "POST", cookie, json: file, via });
    const id = (await body<{ item: Item }>(created)).item.id;
    await call(`${LIST}/${id}`, { method: "PUT", cookie, headers: await etagOfRow("site_resources", id), json: { ...file, title: "Baru lagi" }, via });
    await call(`${LIST}/${id}`, { method: "DELETE", cookie, via });
    expect(notify.mock.calls.map(([change]) => change)).toEqual([{ area: "resources" }, { area: "resources" }, { area: "resources" }]);
  });

  test("a refused write (validation, stale, area) asks for no purge", async () => {
    const via = app();
    const cookie = await editor();
    const id = (await body<{ item: Item }>(await call(LIST, { method: "POST", cookie, json: file, via }))).item.id;
    notify.mockReset();
    await call(LIST, { method: "POST", cookie, json: { ...file, title: "a" }, via });
    await call(`${LIST}/${id}`, { method: "PUT", cookie, headers: { "if-match": '"2020-01-01T00:00:00.000Z"' }, json: file, via });
    const reader = await viewer();
    await call(LIST, { method: "POST", cookie: reader, json: file, via });
    expect(notify).not.toHaveBeenCalled();
  });

  // Contract: what the Astro site reads (`GET /api/public/resources`, through the service binding) is what the admin wrote.
  test("the public payload follows an admin's create, edit and delete, and never carries the note", async () => {
    const cookie = await editor();
    const publicResources = async () => (await (await internalFetch("/api/public/resources")).json()) as { resources: Record<string, unknown>[] };
    expect((await publicResources()).resources).toEqual([]);

    const f = await made(cookie, file);
    const l = await made(cookie, link);
    const t = await made(cookie, snippet);
    const listed = (await publicResources()).resources;
    // The page's order: panduan, then berkas-marketing, then tutorial.
    expect(listed.map((row) => row.title)).toEqual(["Panduan Pendaftaran", "Caption Instagram", "Video Token Listrik"]);
    expect(listed.find((row) => row.id === f.id)).toMatchObject({ contentType: "file", filePath: "/resources/panduan.pdf", fileSize: 12345, externalUrl: null, bodyText: null });
    expect(listed.find((row) => row.id === l.id)).toMatchObject({ contentType: "url", externalUrl: link.externalUrl, filePath: null });
    // A text entry carries the text the page's copy button copies.
    expect(listed.find((row) => row.id === t.id)).toMatchObject({ contentType: "text", bodyText: snippet.bodyText });
    expect(JSON.stringify(listed)).not.toContain("Dari panitia");
    for (const row of listed) expect(Object.keys(row)).not.toContain("notes");

    await call(`${LIST}/${f.id}`, { method: "PUT", cookie, headers: await etagOfRow("site_resources", f.id), json: { ...file, title: "Panduan 2027", category: "lainnya" } });
    expect((await publicResources()).resources.map((row) => row.title)).toEqual(["Caption Instagram", "Video Token Listrik", "Panduan 2027"]);

    await call(`${LIST}/${t.id}`, { method: "DELETE", cookie });
    expect((await publicResources()).resources.map((row) => row.title)).toEqual(["Video Token Listrik", "Panduan 2027"]);
  });
});

describe("resources: the list", () => {
  type Page = { items: Item[]; page: number; pageSize: number; total: number };
  const list = async (cookie: string, query = "") => body<Page>(await call(`${LIST}${query}`, { cookie }));
  const titles = async (cookie: string, query = "") => (await list(cookie, query)).items.map((item) => String(item.title));

  async function catalog() {
    const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes));
    const text = { contentType: "text" as const, filePath: null, fileSize: null, bodyText: "isi" };
    await addResourceRow({ title: "lainnya", category: "lainnya", displayOrder: 1, createdAt: at(1), ...text });
    await addResourceRow({ title: "tutorial", category: "tutorial", displayOrder: 1, createdAt: at(2), ...text });
    await addResourceRow({ title: "marketing 2", category: "berkas-marketing", displayOrder: 2, createdAt: at(3), ...text });
    await addResourceRow({ title: "panduan", category: "panduan", displayOrder: 1, createdAt: at(4), ...text });
    await addResourceRow({ title: "marketing 1", category: "berkas-marketing", displayOrder: 1, createdAt: at(5), ...text });
    await addResourceRow({ title: "pendaftaran", category: "berkas-pendaftaran", displayOrder: 9, createdAt: at(6), ...text });
  }

  test("in the public page's order: the five categories as the page has them (not the alphabet), then the manual order, then creation", async () => {
    const cookie = await viewer();
    await catalog();
    expect(await titles(cookie)).toEqual(["panduan", "pendaftaran", "marketing 1", "marketing 2", "tutorial", "lainnya"]);
  });

  test("the envelope has every row on one page by default (100), and the true total", async () => {
    const cookie = await viewer();
    await catalog();
    expect(await list(cookie)).toMatchObject({ page: 1, pageSize: 100, total: 6 });
    const small = await list(cookie, "?pageSize=2&page=2");
    expect(small).toMatchObject({ page: 2, pageSize: 2, total: 6 });
    expect(small.items.map((item) => item.title)).toEqual(["marketing 1", "marketing 2"]);
    expect((await list(cookie, "?pageSize=500")).pageSize).toBe(100);
  });

  test("filters by category and by type, searches the title and the description, sorts by a whitelist, refuses the rest", async () => {
    const cookie = await viewer();
    await catalog();
    await addResourceRow({ title: "Video PLN", description: "token listrik", category: "tutorial", contentType: "url", filePath: null, fileSize: null, externalUrl: "https://example.test/pln" });
    expect(await titles(cookie, "?category=tutorial")).toEqual(["Video PLN", "tutorial"]); // the manual order first: 0 before 1
    expect(await titles(cookie, "?category=tutorial&contentType=url")).toEqual(["Video PLN"]);
    expect(await titles(cookie, "?contentType=file")).toEqual([]);
    expect(await titles(cookie, "?q=listrik")).toEqual(["Video PLN"]);
    expect(await titles(cookie, "?q=VIDEO")).toEqual(["Video PLN"]);
    expect(await titles(cookie, "?category=berkas-marketing&sort=-title")).toEqual(["marketing 2", "marketing 1"]);
    expect(await titles(cookie, "?sort=-displayOrder&pageSize=1")).toEqual(["pendaftaran"]);
    for (const bad of ["?category=rahasia", "?contentType=video", "?sort=notes", "?sort=-updatedBy"]) expect((await call(`${LIST}${bad}`, { cookie })).status, bad).toBe(400);
  });

  test("a viewer sees the internal note (it is an admin screen); the public payload does not (see above)", async () => {
    const cookie = await viewer();
    await addResourceRow({ title: "Dengan catatan", notes: "Sumber asli: Canva" });
    expect((await list(cookie)).items[0]).toMatchObject({ notes: "Sumber asli: Canva" });
  });
});
