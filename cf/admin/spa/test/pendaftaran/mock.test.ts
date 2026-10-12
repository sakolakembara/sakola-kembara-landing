import { describe, expect, test } from "vitest";
import type { Access } from "~/lib/access";
import { ifMatch } from "~/lib/crud/etag";
import { MOCK_RESOURCES } from "~/mock/registry";
import { createMockResources } from "~/mock/resources";

// The mock of the Pendaftaran area (`pnpm dev:spa:mock`) has to answer like the Worker, or a screen that works in
// the mock fails against the real thing. It repeats the Worker's rules in miniature; these tests pin the ones the
// screens depend on (test/pendaftaran-spa-contract.test.ts proves the shapes against the real Worker).

function mock(access: Access = "write") {
  const resources = createMockResources(
    MOCK_RESOURCES.filter((spec) => spec.path.startsWith("/api/admin/batches") || spec.path.startsWith("/api/admin/applications") || spec.path.startsWith("/api/admin/resources")),
    () => access,
  );
  const call = async (method: string, path: string, init: { json?: unknown; ifMatch?: string } = {}) => {
    const response = resources.handle(method, new URL(path, "http://mock.invalid"), {
      method,
      headers: init.ifMatch ? { "If-Match": init.ifMatch } : undefined,
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
    });
    if (!response) throw new Error(`nobody handled ${method} ${path}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: response.status, body: (response.status === 204 ? null : await response.json()) as Record<string, any> };
  };
  return { call, resources };
}

const BATCHES = "/api/admin/batches";
const APPLICATIONS = "/api/admin/applications";
const RESOURCES = "/api/admin/resources";

describe("who may", () => {
  test("a role that cannot read the area gets 403 on everything, one that cannot write gets 403 on every write and verb", async () => {
    const none = mock("none");
    for (const path of [BATCHES, `${BATCHES}/mock-batch-2026`, APPLICATIONS, `${APPLICATIONS}/mock-app-1`, RESOURCES]) expect((await none.call("GET", path)).status, path).toBe(403);
    const readOnly = mock("read");
    expect((await readOnly.call("GET", BATCHES)).status).toBe(200);
    for (const [method, path] of [["POST", BATCHES], ["PUT", `${BATCHES}/mock-batch-2026`], ["DELETE", `${BATCHES}/mock-batch-2026`], ["POST", `${BATCHES}/mock-batch-2026/publish`], ["POST", `${BATCHES}/mock-batch-2026/unpublish`], ["POST", `${APPLICATIONS}/mock-app-1/status`], ["POST", RESOURCES]] as const) {
      expect((await readOnly.call(method, path, { json: {} })).status, `${method} ${path}`).toBe(403);
    }
  });
});

describe("batches", () => {
  test("the list: newest year first, with the phase and the applicants waiting, as the Worker's", async () => {
    const { body } = await mock().call("GET", BATCHES);
    expect(body).toMatchObject({ page: 1, pageSize: 20, total: 4 });
    expect(body.items.map((item: { year: number; phase: string; pending: number; underReview: number }) => [item.year, item.phase, item.pending, item.underReview])).toEqual([
      [2027, "upcoming", 0, 0],
      [2026, "open", 3, 1],
      [2025, "awaiting_decisions", 2, 1],
      [2024, "published", 0, 0],
    ]);
    expect((await mock().call("GET", `${BATCHES}?sort=resultsPublishedAt`)).status).toBe(400);
    expect((await mock().call("GET", `${BATCHES}?q=gen%205`)).body.items).toHaveLength(1);
  });

  test("the detail: counts per status, the newest five, canPublish; a batch nobody has is 404", async () => {
    const { call } = mock();
    const { body } = await call("GET", `${BATCHES}/mock-batch-2025`);
    expect(body.item.counts).toEqual({ pending: 2, under_review: 1, accepted: 2, rejected: 1, total: 6 });
    expect(body.item.recent).toHaveLength(5);
    expect(body.item.canPublish).toBe(false);
    expect((await call("GET", `${BATCHES}/nope`)).status).toBe(404);
  });

  test("publishing: the legacy preconditions in their order and words, then it works once and can be cancelled", async () => {
    const { call } = mock();
    expect(await call("POST", `${BATCHES}/nope/publish`)).toMatchObject({ status: 404, body: { message: "Batch tidak ditemukan" } });
    expect(await call("POST", `${BATCHES}/mock-batch-2027/publish`)).toMatchObject({ status: 409, body: { error: "no_applicants", message: "Belum ada pendaftar di batch ini" } });
    expect(await call("POST", `${BATCHES}/mock-batch-2025/publish`)).toMatchObject({ status: 409, body: { error: "undecided", message: "Masih ada 3 pendaftar yang belum diputuskan", undecided: 3 } });
    expect(await call("POST", `${BATCHES}/mock-batch-2024/publish`)).toMatchObject({ status: 409, body: { error: "already_published", message: "Hasil sudah dipublikasikan" } });

    // Decide the three waiting applicants of 2025, and it can be published.
    for (const id of ["mock-app-7", "mock-app-8", "mock-app-9"]) {
      const one = (await call("GET", `${APPLICATIONS}/${id}`)).body.item;
      expect((await call("POST", `${APPLICATIONS}/${id}/status`, { json: { status: "rejected", reviewNotes: "Tidak memenuhi syarat." }, ifMatch: ifMatch(one.updatedAt) })).status).toBe(200);
    }
    const published = await call("POST", `${BATCHES}/mock-batch-2025/publish`);
    expect(published.status).toBe(200);
    expect(published.body.item).toMatchObject({ phase: "published", canPublish: false });
    expect(published.body.item.resultsPublishedAt).toBeTruthy();
    expect((await call("POST", `${BATCHES}/mock-batch-2025/publish`)).body.error).toBe("already_published");

    const cancelled = await call("POST", `${BATCHES}/mock-batch-2025/unpublish`);
    expect(cancelled.body.item).toMatchObject({ resultsPublishedAt: null, phase: "ready_to_publish", canPublish: true });
    // Cancelling what is not published changes nothing.
    expect((await call("POST", `${BATCHES}/mock-batch-2025/unpublish`)).body.item.resultsPublishedAt).toBeNull();
  });

  test("create: the legacy rules; a year that is taken is a 409 on the year, and a batch's own year is fine when it is edited", async () => {
    const { call } = mock();
    const form = { year: 2031, name: "Gen 12", description: "", opensAt: "2031-08-01T00:00:00.000Z", closesAt: "2031-09-30T00:00:00.000Z" };
    expect((await call("POST", BATCHES, { json: { ...form, year: 2023 } })).body.fields).toEqual({ year: "Tahun terlalu jauh ke belakang" });
    expect((await call("POST", BATCHES, { json: { ...form, name: "ab" } })).body.fields).toEqual({ name: "Nama minimal 3 karakter" });
    expect((await call("POST", BATCHES, { json: { ...form, closesAt: form.opensAt } })).body.fields).toEqual({ closesAt: "Tanggal tutup harus setelah tanggal buka" });
    expect((await call("POST", BATCHES, { json: { ...form, opensAt: "" } })).body.fields).toEqual({ opensAt: "Tanggal buka wajib diisi" });
    const taken = await call("POST", BATCHES, { json: { ...form, year: 2026 } });
    expect(taken).toMatchObject({ status: 409, body: { error: "conflict", fields: { year: "Tahun sudah dipakai batch lain" } } });

    const created = await call("POST", BATCHES, { json: form });
    expect(created.status).toBe(201);
    const id = created.body.item.id as string;
    const own = await call("PUT", `${BATCHES}/${id}`, { json: { ...form, name: "Gen 12 baru" }, ifMatch: ifMatch(created.body.item.updatedAt) });
    expect(own.status).toBe(200);
    const clash = await call("PUT", `${BATCHES}/${id}`, { json: { ...form, year: 2026 }, ifMatch: ifMatch(own.body.item.updatedAt) });
    expect(clash.status).toBe(409);
    expect((await call("PUT", `${BATCHES}/${id}`, { json: form })).status).toBe(428);
  });

  test("a batch with applicants cannot be deleted (409 in_use); an empty one can", async () => {
    const { call } = mock();
    expect(await call("DELETE", `${BATCHES}/mock-batch-2026`)).toMatchObject({ status: 409, body: { error: "in_use", usedBy: ["Pendaftar"] } });
    expect((await call("DELETE", `${BATCHES}/mock-batch-2027`)).status).toBe(204);
    expect((await call("GET", `${BATCHES}/mock-batch-2027`)).status).toBe(404);
  });
});

describe("applications", () => {
  test("the list: newest first, with its batch; filters by status and batch, `all`, and unknown values are 400", async () => {
    const { call } = mock();
    const all = await call("GET", APPLICATIONS);
    expect(all.body.total).toBe(15);
    expect(Object.keys(all.body.items[0]).sort()).toEqual(["batch", "branchPreference", "email", "fullName", "graduationYear", "id", "schoolName", "status", "submittedAt", "updatedAt"]);
    expect((await call("GET", `${APPLICATIONS}?batch=mock-batch-2026`)).body.total).toBe(6);
    expect((await call("GET", `${APPLICATIONS}?batch=all&status=accepted`)).body.total).toBe(5);
    expect((await call("GET", `${APPLICATIONS}?batch=mock-batch-2026&status=pending`)).body.total).toBe(3);
    expect(await call("GET", `${APPLICATIONS}?status=approved`)).toMatchObject({ status: 400, body: { error: "invalid_query", param: "status" } });
    expect((await call("GET", `${APPLICATIONS}?sort=whatsapp`)).status).toBe(400);
  });

  test("the search is the start of a name or an email, never the middle (like the Worker)", async () => {
    const { call } = mock();
    const names = async (q: string) => (await call("GET", `${APPLICATIONS}?q=${encodeURIComponent(q)}`)).body.items.map((item: { fullName: string }) => item.fullName);
    expect(await names("siti")).toEqual(["Siti Aminah"]);
    expect(await names("SITI")).toEqual(["Siti Aminah"]);
    expect(await names("budi.santoso@")).toEqual(["Budi Santoso"]);
    for (const middle of ["aminah", "santoso", "contoh.test", "ti"]) expect(await names(middle), middle).toEqual([]);
  });

  test("there is no create, edit or delete of an application", async () => {
    const { call } = mock();
    expect((await call("POST", APPLICATIONS, { json: {} })).status).toBe(404);
    expect((await call("PUT", `${APPLICATIONS}/mock-app-1`, { json: {} })).status).toBe(404);
    expect((await call("DELETE", `${APPLICATIONS}/mock-app-1`)).status).toBe(404);
  });

  test("the detail has the answers; an old application has none", async () => {
    const { call } = mock();
    const full = (await call("GET", `${APPLICATIONS}/mock-app-1`)).body.item;
    expect(full.formData.household.father.name).toBeTruthy();
    expect(full.batch).toMatchObject({ id: "mock-batch-2026", year: 2026 });
    const old = (await call("GET", `${APPLICATIONS}/mock-app-6`)).body.item;
    expect(old).toMatchObject({ formData: null, motivation: "Ingin kuliah tapi biaya terbatas." });
    expect((await call("GET", `${APPLICATIONS}/nope`)).status).toBe(404);
  });

  test("the review: If-Match, the note rules, the revocation rule, stale, in the Worker's words", async () => {
    const { call } = mock();
    const one = (await call("GET", `${APPLICATIONS}/mock-app-1`)).body.item; // pending
    const send = (json: unknown, version = ifMatch(one.updatedAt)) => call("POST", `${APPLICATIONS}/mock-app-1/status`, { json, ifMatch: version });

    expect((await call("POST", `${APPLICATIONS}/mock-app-1/status`, { json: { status: "under_review" } })).status).toBe(428);
    expect(await send({ status: "accepted", reviewNotes: "  " })).toMatchObject({ status: 400, body: { fields: { reviewNotes: "Catatan review wajib diisi saat menerima atau menolak." } } });
    expect(await send({ status: "approved" })).toMatchObject({ status: 400, body: { fields: { status: "Status tidak dikenal" } } });
    expect((await send({ status: "under_review" }, '"2000-01-01T00:00:00.000Z"')).status).toBe(409);
    expect((await call("POST", `${APPLICATIONS}/nope/status`, { json: { status: "under_review" }, ifMatch: '"x"' })).body.message).toBe("Pendaftar tidak ditemukan.");

    const accepted = await send({ status: "accepted", reviewNotes: "Berkas lengkap." });
    expect(accepted.status).toBe(200);
    expect(accepted.body.item).toMatchObject({ status: "accepted", reviewNotes: "Berkas lengkap." });
    expect(accepted.body.item.reviewedAt).toBeTruthy();
    // The old version is stale now.
    expect((await send({ status: "pending" })).status).toBe(409);

    const version = ifMatch(accepted.body.item.updatedAt);
    const short = await send({ status: "rejected", reviewNotes: "Mundur." }, version);
    expect(short).toMatchObject({ status: 400, body: { fields: { reviewNotes: "Alasan pencabutan wajib diisi minimal 20 karakter — jelaskan mengapa penerimaan ini dibatalkan." } } });
    expect((await send({ status: "rejected", reviewNotes: "Siswa mengundurkan diri secara resmi." }, version)).status).toBe(200);
  });
});

describe("resources", () => {
  test("the list is in the page's own order and every row is one of the three shapes", async () => {
    const { body } = await mock().call("GET", RESOURCES);
    expect(body).toMatchObject({ page: 1, pageSize: 100, total: 5 });
    expect(body.items.map((item: { category: string }) => item.category)).toEqual(["panduan", "berkas-pendaftaran", "berkas-pendaftaran", "berkas-marketing", "tutorial"]);
    for (const item of body.items as { contentType: string; filePath: string | null; externalUrl: string | null; bodyText: string | null }[]) {
      const set = [item.filePath, item.externalUrl, item.bodyText].filter((value) => value !== null);
      expect(set).toHaveLength(1);
    }
    expect((await mock().call("GET", `${RESOURCES}?category=tutorial`)).body.total).toBe(1);
    expect((await mock().call("GET", `${RESOURCES}?category=rahasia`)).status).toBe(400);
    expect((await mock().call("GET", `${RESOURCES}?sort=notes`)).status).toBe(400);
  });

  test("create: each shape's own rules, in the legacy words; only web links; what belongs to another shape is dropped", async () => {
    const { call } = mock();
    const base = { title: "Dokumen", description: "", category: "panduan", displayOrder: 1, notes: "" };
    expect((await call("POST", RESOURCES, { json: { ...base, contentType: "file", filePath: null, fileSize: null } })).body.fields).toEqual({ filePath: "File wajib diupload." });
    expect((await call("POST", RESOURCES, { json: { ...base, contentType: "url", externalUrl: "" } })).body.fields).toEqual({ externalUrl: "URL wajib diisi untuk tipe Link Eksternal." });
    expect((await call("POST", RESOURCES, { json: { ...base, contentType: "url", externalUrl: "javascript:alert(1)" } })).body.fields).toEqual({ externalUrl: "Format URL tidak valid" });
    expect((await call("POST", RESOURCES, { json: { ...base, contentType: "text", bodyText: "" } })).body.fields).toEqual({ bodyText: "Isi teks yang bisa disalin." });
    expect((await call("POST", RESOURCES, { json: { ...base, title: "a", contentType: "text", bodyText: "x" } })).body.fields).toEqual({ title: "Judul minimal 2 karakter" });

    const created = await call("POST", RESOURCES, { json: { ...base, contentType: "url", externalUrl: "https://contoh.test/x", bodyText: "sisa", filePath: "/uploads/resource/x" } });
    expect(created.status).toBe(201);
    expect(created.body.item).toMatchObject({ contentType: "url", externalUrl: "https://contoh.test/x", bodyText: null, filePath: null, fileSize: null });
  });
});
