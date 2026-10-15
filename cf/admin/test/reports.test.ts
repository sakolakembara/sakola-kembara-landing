import { env } from "cloudflare:workers";
import { describe, expect, test, vi } from "vitest";
import { createReportRoutes } from "../src/api/reports";
import type { CrudDeps } from "../src/api/crud";
import type { ContentChange } from "../src/public/purge";
import { isValidReportYear } from "../src/reports/rules";
import { appAround, ifMatchOf } from "./crud-app";
import { auditRows, body, count, fakeUploadPath, konten, KONTEN_CASES, mediaCount, objectExists, uploaded } from "./konten-helpers";
import { call, signedInCookie, uniqueEmail } from "./helpers";
import { addReport, internalFetch, json } from "./public-helpers";

// Laporan (area `konten`): the Worker half of docs/cloudflare/admin-konten.md. What is generic (the envelopes, the
// 409s, the audit transaction, clamping, the generic upload cleanup) is proved by test/crud-contract.test.ts on a
// throwaway resource; this file proves reports are wired to it correctly and keep their legacy rules.

const LIST = "/api/admin/reports";

const valid = (over: Record<string, unknown> = {}) => ({
  title: "Laporan Dampak 2025/2026",
  description: "Ringkasan dampak program.",
  category: "impact",
  year: "2025/2026",
  filePath: fakeUploadPath("report", "laporan-dampak"),
  fileSize: 1_843_200,
  ...over,
});

const ifMatch = (id: string) => ifMatchOf("reports", id);
const fieldsOf = async (res: Response) => (await body<{ fields: Record<string, string> }>(res)).fields;

describe("reports: who may do what (the role matrix of the area konten)", () => {
  test("nobody signed in: 401 on every route", async () => {
    const { id } = await addReport();
    expect((await call(LIST)).status).toBe(401);
    expect((await call(`${LIST}/${id}`)).status).toBe(401);
    expect((await call(LIST, { method: "POST", json: valid() })).status).toBe(401);
    expect((await call(`${LIST}/${id}`, { method: "PUT", json: valid() })).status).toBe(401);
    expect((await call(`${LIST}/${id}`, { method: "DELETE" })).status).toBe(401);
    expect(await count("audit_log")).toBe(0);
  });

  // Negative test (scripts/negative-checks-konten-misc.mjs): drop the area from a route, or make a role rule in
  // src/auth/permissions.ts permissive, and a refused case below turns into a success.
  for (const { label, role, areas, read, write } of KONTEN_CASES) {
    test(`${label}: read ${read}, write ${write === "ok" ? "allowed" : "403"}`, async () => {
      const cookie = await signedInCookie(uniqueEmail(role), role, areas);
      const { id } = await addReport({ title: "Laporan Awal" });

      expect((await call(LIST, { cookie })).status).toBe(read);
      expect((await call(`${LIST}/${id}`, { cookie })).status).toBe(read);

      const created = await call(LIST, { method: "POST", cookie, json: valid() });
      const updated = await call(`${LIST}/${id}`, { method: "PUT", cookie, headers: await ifMatch(id), json: { title: "Judul baru", category: "yearly", year: "2025" } });
      const deleted = await call(`${LIST}/${id}`, { method: "DELETE", cookie });

      if (write === "ok") {
        expect([created.status, updated.status, deleted.status]).toEqual([201, 200, 204]);
        expect((await auditRows()).map((row) => row.action)).toEqual(["report.create", "report.update", "report.delete"]);
      } else {
        expect([created.status, updated.status, deleted.status]).toEqual([403, 403, 403]);
        // A refused write changes nothing and leaves no audit row.
        expect(await count("reports")).toBe(1);
        expect((await env.DB.prepare("SELECT title FROM reports WHERE id = ?").bind(id).first<{ title: string }>())?.title).toBe("Laporan Awal");
        expect(await count("audit_log")).toBe(0);
      }
    });
  }

  test("a refused read says nothing about what is there", async () => {
    await addReport({ title: "Rahasia" });
    const cookie = await signedInCookie(uniqueEmail("elsewhere"), "editor", ["pendaftaran", "komunikasi"]);
    const res = await call(LIST, { cookie });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });
});

describe("reports: the list", () => {
  test("the default order is the public page's: newest year first, then newest upload, and it equals what /laporan is given", async () => {
    // Nothing here depends on the clock or on luck: every upload time is planted, and so is every id. The kit breaks a tie on
    // the sort key by `id` (ascending), and an `id` is a random UUID in real life, so a list that forgot the upload time would
    // come out right whenever the random ids happened to agree with it (one run in four for two same-year pairs: the flake
    // of the negative check "konten: the report list is not in the public page's order (the upload time is not the
    // tie-break)"). Inside each year the ids below are in NEITHER the upload order nor its reverse, which is asserted
    // underneath, so such a list is wrong on every run, whichever way a tie is broken.
    const t = (n: number) => new Date(Date.UTC(2026, 0, n));
    const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
    const planted = [
      { id: id(1), title: "A 2024", year: "2024", uploadedAt: t(1) },
      { id: id(6), title: "B 2025 lama", year: "2025", uploadedAt: t(2) },
      { id: id(9), title: "C 2025/2026 lama", year: "2025/2026", uploadedAt: t(3) },
      { id: id(5), title: "D 2025 baru", year: "2025", uploadedAt: t(9) },
      { id: id(2), title: "E 2024/2025", year: "2024/2025", uploadedAt: t(4) },
      { id: id(8), title: "F 2025/2026 baru", year: "2025/2026", uploadedAt: t(8) },
      { id: id(4), title: "G 2025 tengah", year: "2025", uploadedAt: t(5) },
      { id: id(7), title: "H 2025/2026 tengah", year: "2025/2026", uploadedAt: t(6) },
    ];
    for (const row of planted) await addReport(row);
    for (const year of ["2025", "2025/2026"]) {
      const sameYear = planted.filter((row) => row.year === year);
      const byUpload = [...sameYear].sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime()).map((row) => row.title);
      const byId = [...sameYear].sort((a, b) => a.id.localeCompare(b.id)).map((row) => row.title);
      expect(byId, `the planted ids of ${year} must not follow the upload order`).not.toEqual(byUpload);
      expect([...byId].reverse(), `the planted ids of ${year} must not follow the upload order backwards`).not.toEqual(byUpload);
    }
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");

    const admin = await body<{ items: { id: string; title: string }[]; page: number; pageSize: number; total: number }>(await call(LIST, { cookie }));
    expect(admin.items.map((item) => item.title)).toEqual(["F 2025/2026 baru", "H 2025/2026 tengah", "C 2025/2026 lama", "D 2025 baru", "G 2025 tengah", "B 2025 lama", "E 2024/2025", "A 2024"]);
    expect(admin).toMatchObject({ page: 1, pageSize: 20, total: 8 });

    const pub = await json<{ reports: { id: string }[] }>(await internalFetch("/api/public/reports"));
    expect(admin.items.map((item) => item.id)).toEqual(pub.reports.map((report) => report.id));
  });

  test("the opposite sort, the other whitelisted sorts, and a refused name", async () => {
    await addReport({ title: "Beta", year: "2024", fileSize: 300 });
    await addReport({ title: "Alpha", year: "2025", fileSize: 100 });
    await addReport({ title: "Gamma", year: "2025/2026", fileSize: 200 });
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    const titles = async (query: string) => (await body<{ items: { title: string }[] }>(await call(`${LIST}${query}`, { cookie }))).items.map((item) => item.title);

    expect(await titles("?sort=year")).toEqual(["Beta", "Alpha", "Gamma"]);
    expect(await titles("?sort=title")).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(await titles("?sort=-fileSize")).toEqual(["Beta", "Gamma", "Alpha"]);
    for (const bad of ["?sort=filePath", "?sort=-uploadedBy", "?sort=description"]) expect((await call(`${LIST}${bad}`, { cookie })).status, bad).toBe(400);
  });

  test("filter by category, search in the title, description and year, and a filter value it does not know is refused", async () => {
    await addReport({ title: "Laporan Keuangan", category: "financial", year: "2025", description: "angka-angka" });
    await addReport({ title: "Laporan Dampak", category: "impact", year: "2024/2025", description: "cerita siswa" });
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    const titles = async (query: string) => (await body<{ items: { title: string }[] }>(await call(`${LIST}${query}`, { cookie }))).items.map((item) => item.title);

    expect(await titles("?category=impact")).toEqual(["Laporan Dampak"]);
    expect(await titles("?q=KEUANGAN")).toEqual(["Laporan Keuangan"]);
    expect(await titles("?q=cerita")).toEqual(["Laporan Dampak"]);
    expect(await titles("?q=2024/2025")).toEqual(["Laporan Dampak"]);
    expect((await call(`${LIST}?category=anual`, { cookie })).status).toBe(400);
  });

  test("an item is an explicit field list: no uploader", async () => {
    const user = await signedInCookie(uniqueEmail("viewer"), "viewer");
    const row = await addReport();
    const res = await call(`${LIST}/${row.id}`, { cookie: user });
    const { item } = await body<{ item: Record<string, unknown> }>(res);
    expect(Object.keys(item).sort()).toEqual(["category", "description", "fileSize", "filePath", "id", "title", "updatedAt", "uploadedAt", "year"].sort());
    expect(res.headers.get("etag")).toBe(`"${item.updatedAt}"`);
    expect((await call(`${LIST}/missing`, { cookie: user })).status).toBe(404);
  });
});

describe("reports: creating one (the PDF is required, the metadata keeps its legacy rules)", () => {
  test("create returns the item, records who uploaded it, and writes one audit row of field names and the title", async () => {
    const { email, cookie } = await konten();
    const input = valid();
    const res = await call(LIST, { method: "POST", cookie, json: input });
    expect(res.status).toBe(201);
    const { item } = await body<{ item: Record<string, unknown> }>(res);
    expect(item).toMatchObject({ title: input.title, description: input.description, category: "impact", year: "2025/2026", filePath: input.filePath, fileSize: 1_843_200 });
    expect(res.headers.get("etag")).toBe(`"${item.updatedAt}"`);
    expect(item.uploadedAt).toBe(item.updatedAt); // a new row's first version is its upload

    const row = await env.DB.prepare("SELECT uploaded_by FROM reports WHERE id = ?").bind(item.id).first<{ uploaded_by: string }>();
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
    expect(row?.uploaded_by).toBe(user?.id);

    const audit = await auditRows();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_email: email, action: "report.create", resource_type: "report", resource_id: item.id });
    expect(JSON.parse(audit[0]!.metadata!)).toEqual({ fields: ["title", "description", "category", "year", "filePath", "fileSize", "uploadedBy"], label: input.title });
    // Names only: not the description, not the file path.
    expect(audit[0]!.metadata).not.toContain(input.description);
    expect(audit[0]!.metadata).not.toContain("/uploads/");
  });

  test("a new report shows on the public page's feed", async () => {
    const { cookie } = await konten();
    const input = valid({ title: "Laporan yang Baru Saja Dibuat" });
    await call(LIST, { method: "POST", cookie, json: input });
    const pub = await json<{ reports: { title: string; filePath: string; fileSize: number }[] }>(await internalFetch("/api/public/reports"));
    expect(pub.reports).toMatchObject([{ title: input.title, filePath: input.filePath, fileSize: 1_843_200 }]);
  });

  test("the PDF is required: no path, an empty path, another kind's file and a text that is no path are refused with the legacy sentence", async () => {
    const { cookie } = await konten();
    const post = (over: Record<string, unknown>) => call(LIST, { method: "POST", cookie, json: valid(over) });

    const { filePath: _gone, fileSize: _size, ...withoutFile } = valid();
    const missing = await call(LIST, { method: "POST", cookie, json: withoutFile });
    expect(missing.status).toBe(400);
    expect(await fieldsOf(missing)).toMatchObject({ filePath: "File PDF wajib diupload.", fileSize: "File PDF wajib diupload." });

    for (const filePath of ["", fakeUploadPath("team-photo"), fakeUploadPath("resource"), "https://example.org/laporan.pdf", "/uploads/report/../../etc/passwd", 42]) {
      expect(await fieldsOf(await post({ filePath })), String(filePath)).toMatchObject({ filePath: "File PDF wajib diupload." });
    }
    expect(await count("reports")).toBe(0);
  });

  test("the size is a whole number of bytes, at most 20 MB (the upload's own limit)", async () => {
    const { cookie } = await konten();
    const post = (fileSize: unknown) => call(LIST, { method: "POST", cookie, json: valid({ fileSize }) });
    expect((await post(20_000_000)).status).toBe(201);
    expect(await fieldsOf(await post(20_000_001))).toEqual({ fileSize: "Ukuran file maksimal 20 MB." });
    for (const bad of [-1, 1.5, "100", null]) expect((await post(bad)).status, String(bad)).toBe(400);
  });

  test("a file that was uploaded before the admin existed (a legacy static path) can still be attached", async () => {
    const { cookie } = await konten();
    expect((await call(LIST, { method: "POST", cookie, json: valid({ filePath: "/reports/2025-2026/impact/laporan-lama.pdf" }) })).status).toBe(201);
  });

  test("validation keeps the legacy rules and messages, in the one 400 shape", async () => {
    const { cookie } = await konten();
    const post = (over: Record<string, unknown>) => call(LIST, { method: "POST", cookie, json: valid(over) });

    const short = await post({ title: "ab", year: "tahun depan" });
    expect(short.status).toBe(400);
    expect(await short.json()).toMatchObject({
      error: "invalid",
      message: "Periksa kembali isian formulir.",
      fields: { title: "Judul minimal 3 karakter", year: "Format tahun tidak valid. Contoh: 2025 atau 2025/2026" },
    });
    expect(await fieldsOf(await post({ title: "x".repeat(201) }))).toEqual({ title: "Judul maksimal 200 karakter" });
    expect(await fieldsOf(await post({ description: "x".repeat(1001) }))).toEqual({ description: "Deskripsi maksimal 1000 karakter" });
    expect(await fieldsOf(await post({ category: "annual" }))).toEqual({ category: "Kategori tidak dikenal" });
    expect(await fieldsOf(await post({ year: "2025/2027" }))).toEqual({ year: "Format tahun tidak valid. Contoh: 2025 atau 2025/2026" });
    // A missing field is one of ours, never zod's English.
    const { title: _title, ...noTitle } = valid();
    expect(await fieldsOf(await call(LIST, { method: "POST", cookie, json: noTitle }))).toEqual({ title: "Wajib diisi." });
    expect(await count("reports")).toBe(0);
    expect(await count("audit_log")).toBe(0);
  });

  test("a blank description is no description, and text around a title is trimmed", async () => {
    const { cookie } = await konten();
    const res = await call(LIST, { method: "POST", cookie, json: valid({ title: "  Laporan Rapi  ", description: "   " }) });
    expect(await body(res)).toMatchObject({ item: { title: "Laporan Rapi", description: null } });
  });
});

describe("the year of a report (isValidReportYear: the legacy rule)", () => {
  const now = new Date(Date.UTC(2026, 9, 12));
  test.each(["2018", "2026", "2028", " 2025 ", "2018/2019", "2025/2026", "2028/2029"])("%j is a year", (year) => {
    expect(isValidReportYear(year, now)).toBe(true);
  });
  test.each(["", "abc", "25", "20255", "2017", "2029", "2017/2018", "2029/2030", "2025/2027", "2025/2025", "2026/2025", "2025/26", "2025-2026", "2025 /2026", "2025/", "/2026", "2025/2026/2027"])(
    "%j is not",
    (year) => {
      expect(isValidReportYear(year, now)).toBe(false);
    },
  );
  test("the upper bound follows the clock", () => {
    expect(isValidReportYear("2030", new Date(Date.UTC(2028, 0, 1)))).toBe(true);
    expect(isValidReportYear("2031", new Date(Date.UTC(2028, 0, 1)))).toBe(false);
  });
});

describe("reports: editing one changes the metadata and never the file", () => {
  test("a metadata update leaves the file alone, even when the body names another one, and the audit row lists what changed", async () => {
    const { cookie } = await konten();
    const row = await addReport({ title: "Lama", category: "yearly", year: "2025", description: "Deskripsi lama" });
    const res = await call(`${LIST}/${row.id}`, {
      method: "PUT",
      cookie,
      headers: await ifMatch(row.id),
      json: { title: "Judul baru", description: "Deskripsi lama", category: "financial", year: "2025/2026", filePath: fakeUploadPath("report", "lain"), fileSize: 1 },
    });
    expect(res.status).toBe(200);
    const { item } = await body<{ item: Record<string, unknown> }>(res);
    expect(item).toMatchObject({ title: "Judul baru", category: "financial", year: "2025/2026", filePath: row.filePath, fileSize: row.fileSize });
    const stored = await env.DB.prepare("SELECT file_path, file_size FROM reports WHERE id = ?").bind(row.id).first<{ file_path: string; file_size: number }>();
    expect(stored).toEqual({ file_path: row.filePath, file_size: row.fileSize });

    const update = (await auditRows()).at(-1)!;
    expect(update).toMatchObject({ action: "report.update", resource_type: "report", resource_id: row.id });
    expect(JSON.parse(update.metadata!)).toEqual({ fields: ["title", "category", "year"], label: "Judul baru" });
  });

  test("the edit's version moves on every save: a new ETag, and updated_at is later than the upload", async () => {
    const { cookie } = await konten();
    const row = await addReport({ uploadedAt: new Date(Date.UTC(2026, 0, 1)) });
    const before = await ifMatch(row.id);
    const res = await call(`${LIST}/${row.id}`, { method: "PUT", cookie, headers: before, json: { title: "Baru", category: "yearly", year: "2025" } });
    expect(res.headers.get("etag")).not.toBe(before["if-match"]);
    const { item } = await body<{ item: { uploadedAt: string; updatedAt: string } }>(res);
    expect(new Date(item.updatedAt).getTime()).toBeGreaterThan(new Date(item.uploadedAt).getTime());
  });

  test("an update needs If-Match (428), a stale one is refused (409) without a trace, and a bad form is a 400 before any of that", async () => {
    const { cookie } = await konten();
    const row = await addReport({ title: "Awal" });
    const first = await ifMatch(row.id);
    const edit = (title: string) => ({ title, category: "yearly", year: "2025" });

    expect((await call(`${LIST}/${row.id}`, { method: "PUT", cookie, json: edit("Tanpa versi") })).status).toBe(428);
    expect((await call(`${LIST}/${row.id}`, { method: "PUT", cookie, headers: first, json: edit("Pertama") })).status).toBe(200);
    const late = await call(`${LIST}/${row.id}`, { method: "PUT", cookie, headers: first, json: edit("Kedua") });
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ error: "stale", message: expect.stringContaining("diubah orang lain") });
    expect((await env.DB.prepare("SELECT title FROM reports WHERE id = ?").bind(row.id).first<{ title: string }>())?.title).toBe("Pertama");
    expect((await auditRows()).map((r) => r.action)).toEqual(["report.update"]);

    const bad = await call(`${LIST}/${row.id}`, { method: "PUT", cookie, headers: await ifMatch(row.id), json: { title: "x", category: "yearly", year: "2099" } });
    expect(bad.status).toBe(400);
    expect(await fieldsOf(bad)).toEqual({ title: "Judul minimal 3 karakter", year: "Format tahun tidak valid. Contoh: 2025 atau 2025/2026" });
  });

  test("saving what is already saved writes nothing", async () => {
    const { cookie } = await konten();
    const row = await addReport({ title: "Sama", category: "yearly", year: "2025", description: null });
    const before = await ifMatch(row.id);
    const res = await call(`${LIST}/${row.id}`, { method: "PUT", cookie, headers: before, json: { title: "Sama", category: "yearly", year: "2025" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBe(before["if-match"]);
    expect(await count("audit_log")).toBe(0);
  });
});

describe("reports: deleting one removes its file, and only a file nothing else uses", () => {
  test("an uploaded report: the row, the object and the media row all go, and the audit trail says so", async () => {
    const { cookie } = await konten();
    const file = await uploaded(cookie, "report", "Laporan Tahunan.pdf");
    const created = await call(LIST, { method: "POST", cookie, json: valid({ filePath: file.path, fileSize: file.size }) });
    const id = (await body<{ item: { id: string } }>(created)).item.id;
    expect(await objectExists(file.path)).toBe(true);
    expect(await mediaCount()).toBe(1);

    // While the report uses it, the file cannot be deleted from the uploads API.
    const refused = await call(`/api/admin/uploads/${file.id}`, { method: "DELETE", cookie });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: "in_use", usedBy: ["Laporan"] });

    expect((await call(`${LIST}/${id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect(await count("reports")).toBe(0);
    expect(await objectExists(file.path)).toBe(false);
    expect(await mediaCount()).toBe(0);
    expect((await auditRows()).map((row) => row.action)).toEqual(["upload.create", "report.create", "report.delete", "upload.delete"]);
  });

  test("a file another row still uses is kept, and the delete itself still succeeds", async () => {
    const { cookie } = await konten();
    const file = await uploaded(cookie, "report");
    const first = await body<{ item: { id: string } }>(await call(LIST, { method: "POST", cookie, json: valid({ filePath: file.path, fileSize: file.size }) }));
    await addReport({ filePath: file.path, fileSize: file.size, title: "Salinan" });

    expect((await call(`${LIST}/${first.item.id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect(await objectExists(file.path)).toBe(true);
    expect(await mediaCount()).toBe(1);
  });

  test("a legacy static path is not ours: deleting its row touches no object", async () => {
    const { cookie } = await konten();
    const row = await addReport({ filePath: "/reports/2025/yearly/lama.pdf" });
    const deleteUpload = vi.fn<CrudDeps["deleteUpload"]>(async () => ({ status: "not_found" }));
    const app = appAround({ "/api/admin/reports": createReportRoutes({ notify: () => undefined, deleteUpload }) });
    expect((await call(`${LIST}/${row.id}`, { method: "DELETE", cookie, via: app })).status).toBe(204);
    // The helper is asked, and answers "not_found" for a path that is not an upload; nothing was removed.
    expect(deleteUpload.mock.calls.map(([, , path]) => path)).toEqual(["/reports/2025/yearly/lama.pdf"]);
  });

  test("deleting a missing report is a 404 without an audit row, and an old version is refused as stale", async () => {
    const { cookie } = await konten();
    expect((await call(`${LIST}/missing`, { method: "DELETE", cookie })).status).toBe(404);
    const row = await addReport();
    const old = await ifMatch(row.id);
    await call(`${LIST}/${row.id}`, { method: "PUT", cookie, headers: old, json: { title: "Diubah orang lain", category: "yearly", year: "2025" } });
    const late = await call(`${LIST}/${row.id}`, { method: "DELETE", cookie, headers: old });
    expect(late.status).toBe(409);
    expect(await count("reports")).toBe(1);
  });
});

describe("reports: the public page is told when they change", () => {
  test("create, update and delete each ask for a purge of the reports feed, and the delete cleans up the file; a no-op save does neither", async () => {
    const notify = vi.fn<(change: ContentChange) => void>();
    const deleteUpload = vi.fn<CrudDeps["deleteUpload"]>(async () => ({ status: "deleted" }));
    const app = appAround({ "/api/admin/reports": createReportRoutes({ notify: (change) => notify(change), deleteUpload }) });
    const { cookie } = await konten();

    const input = valid();
    const created = await call(LIST, { method: "POST", cookie, json: input, via: app });
    const id = (await body<{ item: { id: string } }>(created)).item.id;
    await call(`${LIST}/${id}`, { method: "PUT", cookie, headers: await ifMatch(id), json: { title: "Judul lain", category: "impact", year: "2025/2026" }, via: app });
    await call(`${LIST}/${id}`, { method: "PUT", cookie, headers: await ifMatch(id), json: { title: "Judul lain", category: "impact", year: "2025/2026" }, via: app });
    expect(deleteUpload).not.toHaveBeenCalled(); // an edit never touches the file
    await call(`${LIST}/${id}`, { method: "DELETE", cookie, via: app });

    expect(notify.mock.calls.map(([change]) => change)).toEqual([{ area: "reports" }, { area: "reports" }, { area: "reports" }]);
    expect(deleteUpload.mock.calls.map(([, , path]) => path)).toEqual([input.filePath]);
  });
});

describe("reports: the table the screen stands on", () => {
  test("migration 0008 left the table as the schema says: updated_at, the checks, the index", async () => {
    const columns = (await env.DB.prepare("PRAGMA table_info(reports)").all<{ name: string; notnull: number }>()).results;
    expect(columns.find((column) => column.name === "updated_at")).toMatchObject({ notnull: 1 });
    const { sql } = (await env.DB.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'reports'").first<{ sql: string }>())!;
    for (const name of ["reports_category_check", "reports_file_size_check", "reports_year_check"]) expect(sql, name).toContain(name);
    const indexes = (await env.DB.prepare("PRAGMA index_list(reports)").all<{ name: string }>()).results.map((index) => index.name);
    expect(indexes).toContain("reports_category_year_idx");
    // The checks still refuse what they refused before the rebuild.
    await expect(env.DB.prepare("INSERT INTO reports (id, title, category, year, file_path, file_size) VALUES ('x', 't', 'annual', '2025', '/a.pdf', 1)").run()).rejects.toThrow(/reports_category_check/);
    await expect(env.DB.prepare("INSERT INTO reports (id, title, category, year, file_path, file_size) VALUES ('x', 't', 'yearly', '25', '/a.pdf', 1)").run()).rejects.toThrow(/reports_year_check/);
  });

  test("the rebuild keeps every row and gives it its upload time as the first version", async () => {
    // Replaying the migration on the table as it is now is a faithful test of its copy rule: it creates a new table,
    // copies every row, drops the old one and renames. `updated_at` is deliberately set apart from `uploaded_at` first.
    await env.DB.prepare("INSERT INTO reports (id, title, category, year, file_path, file_size, uploaded_at, updated_at) VALUES ('old-1', 'Lama', 'yearly', '2025', '/reports/a.pdf', 10, 1700000000000, 1800000000000)").run();
    const migration = env.TEST_MIGRATIONS.find((candidate) => candidate.name.startsWith("0008"));
    expect(migration, "migration 0008 exists").toBeDefined();
    for (const query of migration!.queries) await env.DB.prepare(query).run();
    const row = await env.DB.prepare("SELECT uploaded_at, updated_at FROM reports WHERE id = 'old-1'").first<{ uploaded_at: number; updated_at: number }>();
    expect(row).toEqual({ uploaded_at: 1700000000000, updated_at: 1700000000000 });
  });

  test("a list reads the table once for the page and once for the total, in one round trip", async () => {
    // The plan of the default list: a scan and a sort (the order is an expression), acceptable for a table that stays
    // small (a few reports a year); said so in docs/cloudflare/admin-konten.md.
    for (let n = 0; n < 5; n++) await addReport();
    const { spyOnD1 } = await import("./crud-app");
    const spy = spyOnD1(env.DB);
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    const before = spy.touching("reports").length;
    expect((await call(LIST, { cookie, env: { DB: spy.db } })).status).toBe(200);
    const events = spy.touching("reports").slice(before);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("batch");
    expect(events[0]!.sql).toHaveLength(2);
  });
});
