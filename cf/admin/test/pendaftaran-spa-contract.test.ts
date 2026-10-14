import { afterEach, describe, expect, test } from "vitest";
import { REVOCATION_NOTES_MIN as WORKER_REVOCATION_MIN } from "../src/admission/review";
import { batchPhase } from "../src/dashboard/payload";
import { applicationStatus, resourceCategory, resourceContentType } from "../src/db/schema";
import { KIND_RULES } from "../src/uploads/kinds";
import { api, setTransport } from "../spa/src/lib/api";
import { describeFailure } from "../spa/src/lib/crud/errors";
import { ifMatch } from "../spa/src/lib/crud/etag";
import { type ListSpec, parseListQuery, toApiQuery } from "../spa/src/lib/crud/query";
import { UPLOAD_KINDS } from "../spa/src/lib/crud/upload-kinds";
import { ALL_BATCHES, API_PATH as APPLICATIONS, LIST_SPEC as APPLICATION_SPEC, APPLICATION_STATUS, REVOCATION_NOTES_MIN, STATUSES } from "../spa/src/pages/applications/model";
import { API_PATH as BATCHES, LIST_SPEC as BATCH_SPEC, PHASE_STATUS, STATUS_KEYS, toBody as batchBody, toValues as batchValues } from "../spa/src/pages/batches/model";
import {
  API_PATH as RESOURCES,
  CATEGORIES,
  CATEGORY_DESCRIPTION,
  CATEGORY_LABEL,
  CATEGORY_TONE,
  CONTENT_TYPES,
  CONTENT_TYPE_HELP,
  CONTENT_TYPE_LABEL,
  LIST_SPEC as RESOURCE_SPEC,
  toBody as resourceBody,
  toValues as resourceValues,
} from "../spa/src/pages/resources/model";
import { call, signedInCookie, uniqueEmail } from "./helpers";
import { addApplication, addApplications, addBatch } from "./pendaftaran-helpers";
import { DAY } from "./public-helpers";

// What the SPA's Pendaftaran screens send and expect, checked against the real Worker in workerd (the SPA tests
// stub the API, so these are what keep the two sides honest): the constants both sides spell, the list queries the
// SPA builds, the bodies it sends, the shape of every answer it reads, and the sentence each refusal becomes.
// Same idea as test/crud-spa-contract.test.ts.

afterEach(() => setTransport(null));

/** The SPA's `api()` over the real Worker: what a page would get, with this session. */
function over(cookie: string) {
  setTransport(async (path, init) => call(path, { method: init.method, headers: init.headers as Record<string, string> | undefined, body: init.body as string | undefined, cookie }));
}

const editor = () => signedInCookie(uniqueEmail("editor"), "editor", ["pendaftaran"]);
const viewer = () => signedInCookie(uniqueEmail("viewer"), "viewer");
const keys = (value: unknown) => Object.keys(value as object).sort();

describe("the two sides spell the same constants", () => {
  test("the statuses of an application, their labels and the revocation rule", () => {
    expect([...STATUSES]).toEqual([...applicationStatus]);
    expect(Object.keys(APPLICATION_STATUS).sort()).toEqual([...applicationStatus].sort());
    expect(Object.keys(APPLICATION_STATUS)).toEqual([...applicationStatus]);
    expect(REVOCATION_NOTES_MIN).toBe(WORKER_REVOCATION_MIN);
    expect([...STATUS_KEYS]).toEqual([...applicationStatus]);
  });

  test("the five categories and the three shapes of a document, in the page's order", () => {
    expect([...CATEGORIES]).toEqual([...resourceCategory]);
    expect([...CONTENT_TYPES]).toEqual([...resourceContentType]);
    for (const table of [CATEGORY_LABEL, CATEGORY_DESCRIPTION, CATEGORY_TONE]) expect(Object.keys(table)).toEqual([...resourceCategory]);
    for (const table of [CONTENT_TYPE_LABEL, CONTENT_TYPE_HELP]) expect(Object.keys(table)).toEqual([...resourceContentType]);
  });

  test("every phase the Worker can give a batch has a tag, and the tag table has no phase the Worker cannot give", () => {
    const now = new Date("2026-10-12T00:00:00Z");
    const day = (offset: number) => new Date(now.getTime() + offset * DAY);
    const batch = (opens: number, closes: number, published: boolean, applied: boolean) => ({ opensAt: day(opens), closesAt: day(closes), resultsPublishedAt: published ? day(closes + 1) : null, hasApplications: applied });
    const phases = new Set([
      batchPhase(batch(5, 30, false, false), 0, now),
      batchPhase(batch(-5, 30, false, true), 3, now),
      batchPhase(batch(-60, -10, false, true), 3, now),
      batchPhase(batch(-60, -10, false, true), 0, now),
      batchPhase(batch(-60, -10, false, false), 0, now),
      batchPhase(batch(-60, -10, true, true), 0, now),
    ]);
    expect([...phases].sort()).toEqual(Object.keys(PHASE_STATUS).sort());
  });

  test("the upload kind of a document is the Worker's `resource`: the Pendaftaran area, PDF and images, 25 MB", () => {
    expect(UPLOAD_KINDS.resource.area).toBe(KIND_RULES.resource.area);
    expect(UPLOAD_KINDS.resource.area).toBe("pendaftaran");
    expect(UPLOAD_KINDS.resource.maxBytes).toBe(KIND_RULES.resource.maxBytes);
    expect([...UPLOAD_KINDS.resource.types].sort()).toEqual([...KIND_RULES.resource.types].sort());
  });
});

describe("the list queries the SPA builds are what the Worker's lists accept", () => {
  const cases: [string, string, ListSpec, string[]][] = [
    ["batches", BATCHES, BATCH_SPEC, ["", "q=gen", "sort=name", "sort=-opensAt", "sort=year", "page=2"]],
    [
      "applications",
      APPLICATIONS,
      APPLICATION_SPEC,
      ["", "batch=all", "status=pending", "status=under_review", "status=accepted", "status=rejected", "q=siti", "sort=fullName", "sort=-fullName", "sort=submittedAt", "batch=all&status=pending&q=siti&sort=fullName&page=2", "batch=tidak-ada"],
    ],
    ["resources", RESOURCES, RESOURCE_SPEC, ["", "category=panduan", "category=berkas-pendaftaran", "category=berkas-marketing", "category=tutorial", "category=lainnya", "contentType=file", "contentType=url", "contentType=text", "q=panduan", "sort=title", "sort=-displayOrder", "sort=updatedAt", "sort=category"]],
  ];

  for (const [name, path, spec, searches] of cases) {
    test(`${name}: the default query and every filter, sort and search of the spec answer 200 with the envelope`, async () => {
      over(await viewer());
      for (const search of searches) {
        const query = parseListQuery(new URLSearchParams(search), spec);
        const result = await api<{ items: unknown[]; page: number; pageSize: number; total: number }>(`${path}${toApiQuery(query, spec)}`);
        expect(result.ok, `${name}: ${search}`).toBe(true);
        if (result.ok) expect(result.data).toMatchObject({ page: query.page, pageSize: spec.pageSize ?? 20 });
      }
    });
  }

  test("every sort the spec lists, ascending and descending, is a sort the Worker has", async () => {
    over(await viewer());
    for (const [path, spec] of [[BATCHES, BATCH_SPEC], [APPLICATIONS, APPLICATION_SPEC], [RESOURCES, RESOURCE_SPEC]] as const) {
      for (const name of spec.sorts ?? []) {
        for (const sort of [name, `-${name}`]) expect((await api(`${path}?sort=${sort}`)).ok, `${path} ${sort}`).toBe(true);
      }
    }
  });

  test("the names the spec lists are all there is: a sort or filter the spec does not list is refused by the Worker", async () => {
    over(await viewer());
    for (const [path, spec] of [[BATCHES, BATCH_SPEC], [APPLICATIONS, APPLICATION_SPEC], [RESOURCES, RESOURCE_SPEC]] as const) {
      expect((await api(`${path}?sort=notes`)).ok, `${path} sort`).toBe(false);
      expect((await api(`${path}?sort=-createdBy`)).ok, `${path} sort`).toBe(false);
      expect(spec.defaultSort).toBeTruthy();
    }
    expect(ALL_BATCHES).toBe("all");
  });
});

describe("the shape of every answer the SPA reads", () => {
  test("a batch: the list row, the page of one batch, and what a save answers", async () => {
    const cookie = await editor();
    over(cookie);
    const batch = await addBatch();
    await addApplications(batch.id, { pending: 2, under_review: 1, accepted: 3 });

    const list = await api<{ items: Record<string, unknown>[] }>(`${BATCHES}?pageSize=100&sort=-year`);
    if (!list.ok) throw new Error("list failed");
    expect(keys(list.data.items[0])).toEqual(["closesAt", "createdAt", "description", "id", "name", "opensAt", "pending", "phase", "resultsPublishedAt", "underReview", "updatedAt", "year"]);
    expect(list.data.items[0]).toMatchObject({ pending: 2, underReview: 1, phase: "awaiting_decisions" });

    const detail = await api<{ item: Record<string, unknown> & { counts: Record<string, number>; recent: Record<string, unknown>[] } }>(`${BATCHES}/${batch.id}`);
    if (!detail.ok) throw new Error("detail failed");
    expect(keys(detail.data.item)).toEqual(["canPublish", "closesAt", "counts", "createdAt", "description", "id", "name", "opensAt", "phase", "recent", "resultsPublishedAt", "updatedAt", "year"]);
    expect(keys(detail.data.item.counts)).toEqual(["accepted", "pending", "rejected", "total", "under_review"]);
    expect(keys(detail.data.item.recent[0])).toEqual(["email", "fullName", "id", "schoolName", "status", "submittedAt"]);
    // The tiles of the page are the four statuses, by the names the Worker counts under.
    for (const status of STATUS_KEYS) expect(typeof detail.data.item.counts[status]).toBe("number");

    const created = await api<{ item: Record<string, unknown> }>(BATCHES, { method: "POST", json: batchBody({ ...batchValues(null), year: "2090", name: "Gen 66", opensAt: new Date(Date.now() + 10 * DAY).toISOString().slice(0, 16), closesAt: new Date(Date.now() + 40 * DAY).toISOString().slice(0, 16) }) });
    expect(created.ok).toBe(true);
    if (created.ok) expect(keys(created.data.item)).toEqual(["closesAt", "createdAt", "description", "id", "name", "opensAt", "resultsPublishedAt", "updatedAt", "year"]);
  });

  test("an application: the list row and the detail with every field the page reads", async () => {
    over(await viewer());
    const batch = await addBatch();
    const application = await addApplication(batch.id, { branchPreference: "Bandung" });

    const list = await api<{ items: Record<string, unknown>[] }>(`${APPLICATIONS}?batch=${batch.id}`);
    if (!list.ok) throw new Error("list failed");
    expect(keys(list.data.items[0])).toEqual(["batch", "branchPreference", "email", "fullName", "graduationYear", "id", "schoolName", "status", "submittedAt", "updatedAt"]);
    expect(keys(list.data.items[0]!.batch)).toEqual(["id", "name", "year"]);

    const detail = await api<{ item: Record<string, unknown> }>(`${APPLICATIONS}/${application.id}`);
    if (!detail.ok) throw new Error("detail failed");
    expect(keys(detail.data.item)).toEqual([
      "batch", "branchPreference", "canOpenFiles", "economicBackground", "email", "files", "formData", "formVersion", "fullName", "graduationYear", "id",
      "motivation", "reviewNotes", "reviewedAt", "schoolName", "status", "submittedAt", "updatedAt", "whatsapp",
    ]);
  });

  test("a document: the item with every field the form and the list read, for each of the three shapes", async () => {
    over(await editor());
    const base = { title: "Dokumen", category: "panduan", displayOrder: 1 };
    const bodies = [
      { ...base, contentType: "file", filePath: "/resources/dokumen.pdf", fileSize: 1000 },
      { ...base, contentType: "url", externalUrl: "https://contoh.test/x" },
      { ...base, contentType: "text", bodyText: "salin" },
    ];
    for (const body of bodies) {
      const created = await api<{ item: Record<string, unknown> }>(RESOURCES, { method: "POST", json: body });
      expect(created.ok, body.contentType).toBe(true);
      if (created.ok) expect(keys(created.data.item)).toEqual(["bodyText", "category", "contentType", "createdAt", "description", "displayOrder", "externalUrl", "filePath", "fileSize", "id", "notes", "title", "updatedAt"]);
    }
  });
});

describe("the bodies the SPA's forms send are accepted by the Worker", () => {
  test("a batch: the form's values as the SPA turns them into a body, to create and to edit with the version it loaded", async () => {
    over(await editor());
    const opensAt = new Date(Date.now() + 10 * DAY);
    const values = { ...batchValues(null), year: "2091", name: "Gen 67", description: "Angkatan baru", opensAt: opensAt.toISOString().slice(0, 16), closesAt: new Date(opensAt.getTime() + 30 * DAY).toISOString().slice(0, 16) };
    const created = await api<{ item: { id: string; updatedAt: string; year: number } }>(BATCHES, { method: "POST", json: batchBody(values) });
    if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created)}`);
    expect(created.data.item.year).toBe(2091);
    const edited = await api<{ item: { name: string } }>(`${BATCHES}/${created.data.item.id}`, { method: "PUT", json: batchBody({ ...values, name: "Gen 67 baru" }), ifMatch: ifMatch(created.data.item.updatedAt) });
    expect(edited.ok).toBe(true);
    if (edited.ok) expect(edited.data.item.name).toBe("Gen 67 baru");
  });

  test("a document of each shape, then its edit with the version it loaded; switching the shape keeps the one chosen", async () => {
    over(await editor());
    const blank = resourceValues(null);
    const file = await api<{ item: { id: string; updatedAt: string } }>(RESOURCES, { method: "POST", json: resourceBody({ ...blank, title: "Panduan", filePath: "/resources/panduan.pdf", fileSize: "1234" }) });
    expect(file.ok).toBe(true);
    if (!file.ok) return;
    const text = await api(RESOURCES, { method: "POST", json: resourceBody({ ...blank, title: "Caption", contentType: "text", bodyText: "salin ini", filePath: "/resources/lama.pdf", fileSize: "1" }) });
    expect(text.ok).toBe(true);
    const link = await api<{ item: Record<string, unknown> }>(`${RESOURCES}/${file.data.item.id}`, {
      method: "PUT",
      json: resourceBody({ ...blank, title: "Panduan", contentType: "url", externalUrl: "https://contoh.test/panduan" }),
      ifMatch: ifMatch(file.data.item.updatedAt),
    });
    expect(link.ok).toBe(true);
    if (link.ok) expect(link.data.item).toMatchObject({ contentType: "url", externalUrl: "https://contoh.test/panduan", filePath: null, fileSize: null });
  });

  test("the review: the status and the note, with the version loaded; and with a stale version it is refused", async () => {
    over(await editor());
    const batch = await addBatch();
    const application = await addApplication(batch.id);
    const loaded = await api<{ item: { updatedAt: string } }>(`${APPLICATIONS}/${application.id}`);
    if (!loaded.ok) throw new Error("load failed");
    const saved = await api<{ item: { status: string; reviewNotes: string } }>(`${APPLICATIONS}/${application.id}/status`, { method: "POST", json: { status: "accepted", reviewNotes: "Berkas lengkap." }, ifMatch: ifMatch(loaded.data.item.updatedAt) });
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.data.item).toMatchObject({ status: "accepted", reviewNotes: "Berkas lengkap." });
    const stale = await api(`${APPLICATIONS}/${application.id}/status`, { method: "POST", json: { status: "pending" }, ifMatch: ifMatch(loaded.data.item.updatedAt) });
    if (stale.ok) throw new Error("expected a failure");
    expect(stale.status).toBe(409);
    expect(describeFailure(stale)).toMatchObject({ stale: true });
  });
});

describe("every refusal of the area becomes a sentence for a person, through the SPA's own api()", () => {
  test("a batch with applicants cannot be deleted, and the sentence says why", async () => {
    over(await editor());
    const batch = await addBatch();
    await addApplications(batch.id, { accepted: 1 });
    const refused = await api(`${BATCHES}/${batch.id}`, { method: "DELETE" });
    if (refused.ok) throw new Error("expected a failure");
    expect(refused.status).toBe(409);
    expect(refused.code).toBe("in_use");
    expect(describeFailure(refused).message).toBe("Batch ini masih punya pendaftar, jadi tidak bisa dihapus.");
  });

  test("publishing: each precondition's words reach the page untouched", async () => {
    over(await editor());
    const empty = await addBatch();
    const waiting = await addBatch();
    await addApplications(waiting.id, { pending: 2 });
    const done = await addBatch({ resultsPublishedAt: new Date() });
    await addApplications(done.id, { accepted: 1 });
    const publish = async (id: string) => {
      const result = await api(`${BATCHES}/${id}/publish`, { method: "POST" });
      if (result.ok) throw new Error("expected a failure");
      return describeFailure(result).message;
    };
    expect(await publish(empty.id)).toBe("Belum ada pendaftar di batch ini");
    expect(await publish(waiting.id)).toBe("Masih ada 2 pendaftar yang belum diputuskan");
    expect(await publish(done.id)).toBe("Hasil sudah dipublikasikan");
    expect(await publish("tidak-ada")).toBe("Batch tidak ditemukan");
  });

  test("the review: the note's refusals land on the field the form calls reviewNotes; the 404 and the 403 have their sentences", async () => {
    const cookie = await editor();
    over(cookie);
    const batch = await addBatch();
    const pending = await addApplication(batch.id);
    const accepted = await addApplication(batch.id, { status: "accepted" });
    const version = async (id: string) => {
      const loaded = await api<{ item: { updatedAt: string } }>(`${APPLICATIONS}/${id}`);
      if (!loaded.ok) throw new Error("load failed");
      return ifMatch(loaded.data.item.updatedAt);
    };

    const noNote = await api(`${APPLICATIONS}/${pending.id}/status`, { method: "POST", json: { status: "accepted", reviewNotes: "" }, ifMatch: await version(pending.id) });
    if (noNote.ok) throw new Error("expected a failure");
    expect(describeFailure(noNote)).toEqual({ message: "Periksa kembali isian formulir.", fields: { reviewNotes: "Catatan review wajib diisi saat menerima atau menolak." }, stale: false });

    const short = await api(`${APPLICATIONS}/${accepted.id}/status`, { method: "POST", json: { status: "rejected", reviewNotes: "Mundur." }, ifMatch: await version(accepted.id) });
    if (short.ok) throw new Error("expected a failure");
    expect(describeFailure(short).fields.reviewNotes).toBe("Alasan pencabutan wajib diisi minimal 20 karakter — jelaskan mengapa penerimaan ini dibatalkan.");

    const gone = await api(`${APPLICATIONS}/tidak-ada/status`, { method: "POST", json: { status: "pending" }, ifMatch: '"2026-01-01T00:00:00.000Z"' });
    if (gone.ok) throw new Error("expected a failure");
    expect(describeFailure(gone).message).toBe("Pendaftar tidak ditemukan.");

    over(await viewer());
    const denied = await api(`${APPLICATIONS}/${pending.id}/status`, { method: "POST", json: { status: "under_review" }, ifMatch: await version(pending.id) });
    if (denied.ok) throw new Error("expected a failure");
    expect(denied.status).toBe(403);
    expect(describeFailure(denied).message).toBe("Kamu tidak punya izin untuk melakukan ini.");
  });

  test("the field names the Worker reports are the ids of the SPA's form controls", async () => {
    over(await editor());
    const batch = await api(BATCHES, { method: "POST", json: { year: 1999, name: "", opensAt: "", closesAt: "", description: "x".repeat(1001) } });
    if (batch.ok) throw new Error("expected a failure");
    for (const name of Object.keys(describeFailure(batch).fields)) expect(["year", "name", "description", "opensAt", "closesAt"], name).toContain(name);

    const resource = await api(RESOURCES, { method: "POST", json: { title: "", description: "x".repeat(1001), category: "x", displayOrder: -1, contentType: "file", filePath: "", notes: "x".repeat(501) } });
    if (resource.ok) throw new Error("expected a failure");
    for (const name of Object.keys(describeFailure(resource).fields)) expect(["title", "description", "category", "displayOrder", "contentType", "filePath", "fileSize", "externalUrl", "bodyText", "notes"], name).toContain(name);
  });

  test("a year taken is a conflict on the year, and a stale edit is recognised as one", async () => {
    over(await editor());
    const taken = await addBatch();
    const conflict = await api(BATCHES, { method: "POST", json: batchBody({ ...batchValues(null), year: String(taken.year), name: "Gen", opensAt: "2031-08-01T00:00", closesAt: "2031-09-01T00:00" }) });
    if (conflict.ok) throw new Error("expected a failure");
    expect(conflict.status).toBe(409);
    expect(describeFailure(conflict).fields).toEqual({ year: "Tahun sudah dipakai batch lain" });

    const stale = await api(`${BATCHES}/${taken.id}`, { method: "PUT", json: batchBody({ ...batchValues(null), year: String(taken.year), name: "Gen", opensAt: "2031-08-01T00:00", closesAt: "2031-09-01T00:00" }), ifMatch: '"2020-01-01T00:00:00.000Z"' });
    if (stale.ok) throw new Error("expected a failure");
    expect(describeFailure(stale).stale).toBe(true);
  });
});
