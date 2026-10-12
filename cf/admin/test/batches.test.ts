import { env } from "cloudflare:workers";
import { describe, expect, test, vi } from "vitest";
import { createBatchRoutes } from "../src/api/batches";
import type { CrudDeps } from "../src/api/crud";
import type { ContentChange } from "../src/public/purge";
import { appAround } from "./crud-app";
import { call, createVerifiedUser, emails, signedInCookie, signIn, cookiesOf, uniqueEmail } from "./helpers";
import { addApplication, addApplications, addBatch, audit, count, etagOfRow, MATRIX, nextYear, rowOf } from "./pendaftaran-helpers";
import { DAY } from "./public-helpers";

// Batch (SAKEM-082, area `pendaftaran`): a port of app/(admin)/admin/batches/*. The generic behaviour of the CRUD
// kit (envelopes, the 409s, the audit transaction) is proved by test/crud-contract.test.ts; this file proves that
// the batches are wired to it and keep their legacy rules: the form, the publish preconditions and their order,
// who may do what, what is written to the audit log, and that nothing here touches the public caches.

const LIST = "/api/admin/batches";

const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

function valid(over: Record<string, unknown> = {}) {
  return { year: nextYear(), name: "Gen 7 - 2031/2032", description: "Angkatan baru", opensAt: iso(10), closesAt: iso(40), ...over };
}

const editor = () => signedInCookie(uniqueEmail("editor"), "editor", ["pendaftaran"]);
const viewer = () => signedInCookie(uniqueEmail("viewer"), "viewer");

const get = (path: string, cookie: string) => call(path, { cookie });
const post = (path: string, cookie: string, json?: unknown, headers?: Record<string, string>) => call(path, { method: "POST", cookie, json, headers });

async function body<T = Record<string, unknown>>(response: Response) {
  return (await response.json()) as T;
}

/** A closed batch whose applicants are all decided: the one that can be published. */
async function readyBatch() {
  const batch = await addBatch();
  await addApplications(batch.id, { accepted: 2, rejected: 1 });
  return batch;
}

describe("batches: who may do what", () => {
  test("nobody signed in: 401 on every route, nothing changes", async () => {
    const batch = await readyBatch();
    const id = batch.id;
    const calls = [
      call(LIST),
      call(`${LIST}/${id}`),
      call(LIST, { method: "POST", json: valid() }),
      call(`${LIST}/${id}`, { method: "PUT", json: valid() }),
      call(`${LIST}/${id}`, { method: "DELETE" }),
      call(`${LIST}/${id}/publish`, { method: "POST" }),
      call(`${LIST}/${id}/unpublish`, { method: "POST" }),
    ];
    expect((await Promise.all(calls)).map((res) => res.status)).toEqual([401, 401, 401, 401, 401, 401, 401]);
    expect(await count("audit_log")).toBe(0);
    expect((await rowOf<{ results_published_at: number | null }>("admission_batches", id))?.results_published_at).toBeNull();
  });

  // Negative test (scripts/negative-checks-pendaftaran.mjs): take the area check off any write route (create, update,
  // delete, publish, unpublish) and the cases that must be refused below start to pass the guard.
  for (const { label, role, areas, read, write } of MATRIX) {
    test(`${label}: read ${read ? 200 : 403}, write ${write ? "allowed" : 403}`, async () => {
      const cookie = await signedInCookie(uniqueEmail(role), role, areas);
      const target = await addBatch({ name: "Batch Sasaran" });
      const publishable = await readyBatch();
      const deletable = await addBatch();
      const before = { batches: await count("admission_batches"), audit: await count("audit_log") };

      const reads = [(await get(LIST, cookie)).status, (await get(`${LIST}/${target.id}`, cookie)).status];
      expect(reads, "list, detail").toEqual([read ? 200 : 403, read ? 200 : 403]);

      const created = await post(LIST, cookie, valid());
      const updated = await call(`${LIST}/${target.id}`, { method: "PUT", cookie, headers: await etagOfRow("admission_batches", target.id), json: valid({ year: target.year, name: "Nama baru" }) });
      const published = await post(`${LIST}/${publishable.id}/publish`, cookie);
      const unpublished = await post(`${LIST}/${publishable.id}/unpublish`, cookie);
      const deleted = await call(`${LIST}/${deletable.id}`, { method: "DELETE", cookie });
      const statuses = [created.status, updated.status, published.status, unpublished.status, deleted.status];

      if (write) {
        expect(statuses, "create, update, publish, unpublish, delete").toEqual([201, 200, 200, 200, 204]);
        expect((await audit()).map((row) => row.action)).toEqual(["batch.create", "batch.update", "batch.publish_results", "batch.unpublish_results", "batch.delete"]);
      } else {
        expect(statuses, "create, update, publish, unpublish, delete").toEqual([403, 403, 403, 403, 403]);
        // A refused write changes nothing and leaves no audit row.
        expect(await count("admission_batches")).toBe(before.batches);
        expect(await count("audit_log")).toBe(before.audit);
        expect((await rowOf<{ name: string }>("admission_batches", target.id))?.name).toBe("Batch Sasaran");
        expect((await rowOf<{ results_published_at: number | null }>("admission_batches", publishable.id))?.results_published_at).toBeNull();
      }
    });
  }

  test("a refused read answers nothing about what is there", async () => {
    await addBatch({ name: "Nama Batch Rahasia" });
    const cookie = await signedInCookie(uniqueEmail("elsewhere"), "editor", ["konten"]);
    const res = await get(LIST, cookie);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  test("a grant added or revoked applies to the very next request", async () => {
    const email = uniqueEmail("regranted");
    const userId = await createVerifiedUser(email, "editor", ["pendaftaran"]);
    const cookie = cookiesOf(await signIn(email));
    expect((await post(LIST, cookie, valid())).status).toBe(201);
    await env.DB.prepare("DELETE FROM admin_area_grants WHERE user_id = ?").bind(userId).run();
    expect((await post(LIST, cookie, valid())).status).toBe(403);
    expect((await get(LIST, cookie)).status).toBe(403);
  });
});

describe("batches: create and edit", () => {
  test("create returns the item with its ETag, records who made it, and writes one audit row of field names and the batch name", async () => {
    const email = uniqueEmail("editor");
    const cookie = await signedInCookie(email, "editor", ["pendaftaran"]);
    const input = valid();
    const res = await post(LIST, cookie, input);
    expect(res.status).toBe(201);
    const { item } = await body<{ item: Record<string, unknown> }>(res);
    expect(item).toMatchObject({ year: input.year, name: "Gen 7 - 2031/2032", description: "Angkatan baru", resultsPublishedAt: null });
    // An explicit field list: the author's id is not part of the answer.
    expect(Object.keys(item).sort()).toEqual(["closesAt", "createdAt", "description", "id", "name", "opensAt", "resultsPublishedAt", "updatedAt", "year"]);
    expect(res.headers.get("etag")).toBe(`"${item.updatedAt}"`);

    const row = await rowOf<{ created_by: string; opens_at: number }>("admission_batches", item.id as string);
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
    expect(row?.created_by).toBe(user?.id);
    expect(row?.opens_at).toBe(Date.parse(input.opensAt));

    const rows = await audit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_email: email, action: "batch.create", resource_type: "batch", resource_id: item.id });
    expect(JSON.parse(rows[0]!.metadata!)).toEqual({ fields: ["year", "name", "description", "opensAt", "closesAt"], label: "Gen 7 - 2031/2032" });
  });

  test("a year may be a number or the digits of one, and an empty description is stored as no description", async () => {
    const cookie = await editor();
    const text = await post(LIST, cookie, valid({ year: String(nextYear()), description: "   " }));
    expect(text.status).toBe(201);
    expect((await body<{ item: { description: string | null } }>(text)).item.description).toBeNull();
  });

  test("the edit changes only what the form says, bumps the version, and its audit row names only the fields that changed", async () => {
    const cookie = await editor();
    const batch = await addBatch({ name: "Nama Lama", description: "Lama" });
    const res = await call(`${LIST}/${batch.id}`, {
      method: "PUT",
      cookie,
      headers: await etagOfRow("admission_batches", batch.id),
      json: valid({ year: batch.year, name: "Nama Baru", description: "Lama", opensAt: batch.opensAt.toISOString(), closesAt: batch.closesAt.toISOString() }),
    });
    expect(res.status).toBe(200);
    const { item } = await body<{ item: { name: string; updatedAt: string } }>(res);
    expect(item.name).toBe("Nama Baru");
    expect(item.updatedAt).not.toBe(batch.opensAt.toISOString());
    const rows = await audit();
    expect(rows.map((row) => row.action)).toEqual(["batch.update"]);
    expect(JSON.parse(rows[0]!.metadata!)).toEqual({ fields: ["name"], label: "Nama Baru" });
  });

  test("an edit needs If-Match (428), and a stale one is refused (409) without a trace", async () => {
    const cookie = await editor();
    const batch = await addBatch();
    const first = await etagOfRow("admission_batches", batch.id);
    const form = (name: string) => valid({ year: batch.year, name, opensAt: batch.opensAt.toISOString(), closesAt: batch.closesAt.toISOString() });

    expect((await call(`${LIST}/${batch.id}`, { method: "PUT", cookie, json: form("Tanpa versi") })).status).toBe(428);
    expect((await call(`${LIST}/${batch.id}`, { method: "PUT", cookie, headers: first, json: form("Versi pertama") })).status).toBe(200);
    const late = await call(`${LIST}/${batch.id}`, { method: "PUT", cookie, headers: first, json: form("Versi kedua") });
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ error: "stale" });
    expect((await rowOf<{ name: string }>("admission_batches", batch.id))?.name).toBe("Versi pertama");
    expect((await audit()).map((row) => row.action)).toEqual(["batch.update"]);
  });

  test("editing a batch that does not exist is 404", async () => {
    const cookie = await editor();
    expect((await call(`${LIST}/tidak-ada`, { method: "PUT", cookie, headers: { "if-match": '"2026-01-01T00:00:00.000Z"' }, json: valid() })).status).toBe(404);
    expect((await get(`${LIST}/tidak-ada`, cookie)).status).toBe(404);
    expect((await get(`${LIST}/${"x".repeat(200)}`, cookie)).status).toBe(404);
  });

  test("a year that another batch has is a 409 on the year field, on create and on edit, and the batch's own year is fine", async () => {
    const cookie = await editor();
    const taken = await addBatch();
    const other = await addBatch();

    const created = await post(LIST, cookie, valid({ year: taken.year }));
    expect(created.status).toBe(409);
    expect(await created.json()).toMatchObject({ error: "conflict", fields: { year: "Tahun sudah dipakai batch lain" } });

    const form = valid({ year: taken.year, opensAt: other.opensAt.toISOString(), closesAt: other.closesAt.toISOString() });
    const edited = await call(`${LIST}/${other.id}`, { method: "PUT", cookie, headers: await etagOfRow("admission_batches", other.id), json: form });
    expect(edited.status).toBe(409);
    expect(await edited.json()).toMatchObject({ error: "conflict", fields: { year: "Tahun sudah dipakai batch lain" } });

    const sameYear = await call(`${LIST}/${other.id}`, {
      method: "PUT",
      cookie,
      headers: await etagOfRow("admission_batches", other.id),
      json: { ...form, year: other.year, name: "Nama lain" },
    });
    expect(sameYear.status).toBe(200);
    expect(await audit()).toHaveLength(1); // only the edit that worked
  });

  test("two admins creating the same year at once: one batch, one audit row", async () => {
    const cookie = await editor();
    const year = nextYear();
    const results = await Promise.all([post(LIST, cookie, valid({ year })), post(LIST, cookie, valid({ year }))]);
    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM admission_batches WHERE year = ?").bind(year).first()).toEqual({ n: 1 });
    expect((await audit()).map((row) => row.action)).toEqual(["batch.create"]);
  });
});

describe("batches: the form keeps the legacy rules and messages, in the one 400 shape", () => {
  async function refuse(over: Record<string, unknown>, remove: string[] = []) {
    const cookie = await editor();
    const input: Record<string, unknown> = { ...valid(), ...over };
    for (const key of remove) delete input[key];
    const res = await post(LIST, cookie, input);
    expect(res.status, JSON.stringify(over)).toBe(400);
    const json = await body<{ error: string; message: string; fields: Record<string, string> }>(res);
    expect(json.error).toBe("invalid");
    expect(json.message).toBe("Periksa kembali isian formulir.");
    return json.fields;
  }

  test("the year: a number from 2024 to 2100", async () => {
    expect(await refuse({ year: 2023 })).toEqual({ year: "Tahun terlalu jauh ke belakang" });
    expect(await refuse({ year: 2101 })).toEqual({ year: "Tahun terlalu jauh ke depan" });
    expect(await refuse({ year: "" })).toEqual({ year: "Tahun terlalu jauh ke belakang" }); // what the legacy form said for an empty year
    expect(await refuse({ year: "abc" })).toEqual({ year: "Tahun harus berupa angka" });
    expect(await refuse({ year: 2030.5 })).toEqual({ year: "Tahun harus bilangan bulat" });
    expect(await refuse({}, ["year"])).toEqual({ year: "Tahun harus berupa angka" });
  });

  test("the name: 3 to 120 characters, trimmed", async () => {
    expect(await refuse({ name: "ab" })).toEqual({ name: "Nama minimal 3 karakter" });
    expect(await refuse({ name: "   a   " })).toEqual({ name: "Nama minimal 3 karakter" });
    expect(await refuse({ name: "x".repeat(121) })).toEqual({ name: "Nama maksimal 120 karakter" });
    expect(await refuse({}, ["name"])).toEqual({ name: "Wajib diisi." });
  });

  test("the description: at most 1000 characters", async () => {
    expect(await refuse({ description: "x".repeat(1001) })).toEqual({ description: "Deskripsi maksimal 1000 karakter" });
  });

  test("the dates: both required, readable, and the close after the open", async () => {
    expect(await refuse({ opensAt: "" })).toEqual({ opensAt: "Tanggal buka wajib diisi" });
    expect(await refuse({ closesAt: "" })).toEqual({ closesAt: "Tanggal tutup wajib diisi" });
    expect(await refuse({}, ["opensAt"])).toEqual({ opensAt: "Tanggal buka wajib diisi" });
    expect(await refuse({ opensAt: "bukan tanggal" })).toEqual({ opensAt: "Format tanggal tidak valid" });
    expect(await refuse({ closesAt: "31 Desember" })).toEqual({ closesAt: "Format tanggal tidak valid" });
    expect(await refuse({ opensAt: iso(10), closesAt: iso(5) })).toEqual({ closesAt: "Tanggal tutup harus setelah tanggal buka" });
    const same = iso(10);
    expect(await refuse({ opensAt: same, closesAt: same })).toEqual({ closesAt: "Tanggal tutup harus setelah tanggal buka" });
  });

  test("a refused form changes nothing and leaves no audit row", async () => {
    await refuse({ name: "ab", year: 1999 });
    expect(await count("admission_batches")).toBe(0);
    expect(await count("audit_log")).toBe(0);
  });

  test("a body that is not JSON is refused", async () => {
    const cookie = await editor();
    const form = await call(LIST, { method: "POST", cookie, headers: { "content-type": "application/x-www-form-urlencoded" }, body: "year=2031&name=Gen" });
    const broken = await call(LIST, { method: "POST", cookie, headers: { "content-type": "application/json" }, body: "{nope" });
    expect([form.status, broken.status]).toEqual([415, 400]);
    expect(await count("admission_batches")).toBe(0);
  });
});

describe("batches: delete", () => {
  test("a batch nobody applied to is deleted, with an audit row that keeps its id and name", async () => {
    const cookie = await editor();
    const batch = await addBatch({ name: "Batch Kosong" });
    const res = await call(`${LIST}/${batch.id}`, { method: "DELETE", cookie });
    expect(res.status).toBe(204);
    expect(await count("admission_batches")).toBe(0);
    const rows = await audit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "batch.delete", resource_type: "batch", resource_id: batch.id });
    expect(JSON.parse(rows[0]!.metadata!)).toEqual({ label: "Batch Kosong" });
    expect((await call(`${LIST}/${batch.id}`, { method: "DELETE", cookie })).status).toBe(404);
  });

  // Negative test (scripts/negative-checks-pendaftaran.mjs): without the in-use guard the foreign key error is a 500.
  test("a batch with applications is refused: 409 in_use naming Pendaftar, and nothing changes (not the batch, not the applications, no audit row)", async () => {
    const cookie = await editor();
    const batch = await addBatch();
    await addApplications(batch.id, { pending: 1, accepted: 2 });
    const res = await call(`${LIST}/${batch.id}`, { method: "DELETE", cookie });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "in_use", message: "Batch ini masih punya pendaftar, jadi tidak bisa dihapus.", usedBy: ["Pendaftar"] });
    expect(await count("admission_batches")).toBe(1);
    expect(await count("student_applications")).toBe(3);
    expect(await count("audit_log")).toBe(0);
  });

  test("the guard is for every status: even one rejected applicant keeps the batch", async () => {
    const cookie = await editor();
    const batch = await addBatch();
    await addApplication(batch.id, { status: "rejected" });
    expect((await call(`${LIST}/${batch.id}`, { method: "DELETE", cookie })).status).toBe(409);
  });

  test("a stale delete is refused when If-Match is sent", async () => {
    const cookie = await editor();
    const batch = await addBatch();
    const old = await etagOfRow("admission_batches", batch.id);
    await call(`${LIST}/${batch.id}`, {
      method: "PUT",
      cookie,
      headers: old,
      json: valid({ year: batch.year, name: "Diubah", opensAt: batch.opensAt.toISOString(), closesAt: batch.closesAt.toISOString() }),
    });
    expect((await call(`${LIST}/${batch.id}`, { method: "DELETE", cookie, headers: old })).status).toBe(409);
    expect(await count("admission_batches")).toBe(1);
  });
});

describe("batches: the list", () => {
  type Item = { id: string; year: number; name: string; phase: string; pending: number; underReview: number };
  const list = async (cookie: string, query = "") => body<{ items: Item[]; page: number; pageSize: number; total: number }>(await get(`${LIST}${query}`, cookie));

  test("newest year first, as an envelope, with the phase the dashboard's own function gives and the undecided counts", async () => {
    const cookie = await viewer();
    const upcoming = await addBatch({ year: 2051, opensAt: new Date(Date.now() + 30 * DAY), closesAt: new Date(Date.now() + 60 * DAY) });
    const open = await addBatch({ year: 2050, opensAt: new Date(Date.now() - 5 * DAY), closesAt: new Date(Date.now() + 5 * DAY) });
    const awaiting = await addBatch({ year: 2049 });
    await addApplications(awaiting.id, { pending: 3, under_review: 2, accepted: 4 });
    const ready = await addBatch({ year: 2048 });
    await addApplications(ready.id, { accepted: 2, rejected: 1 });
    const empty = await addBatch({ year: 2047 });
    const published = await addBatch({ year: 2046, resultsPublishedAt: new Date(Date.now() - DAY) });
    await addApplications(published.id, { accepted: 1 });

    const result = await list(cookie);
    expect(result).toMatchObject({ page: 1, pageSize: 20, total: 6 });
    expect(result.items.map((item) => [item.year, item.phase, item.pending, item.underReview])).toEqual([
      [2051, "upcoming", 0, 0],
      [2050, "open", 0, 0],
      [2049, "awaiting_decisions", 3, 2],
      [2048, "ready_to_publish", 0, 0],
      [2047, "closed_empty", 0, 0],
      [2046, "published", 0, 0],
    ]);
    expect([upcoming.id, open.id, awaiting.id, ready.id, empty.id, published.id]).toEqual(result.items.map((item) => item.id));
  });

  test("pages, a search over the name, sorts from a whitelist, and 400 for anything else", async () => {
    const cookie = await viewer();
    await addBatch({ year: 2041, name: "Gen Alpha" });
    await addBatch({ year: 2042, name: "Gen Beta" });
    await addBatch({ year: 2043, name: "Gen Gamma" });
    const years = async (query: string) => (await list(cookie, query)).items.map((item) => item.year);

    expect(await years("?pageSize=2")).toEqual([2043, 2042]);
    expect(await years("?pageSize=2&page=2")).toEqual([2041]);
    expect(await years("?q=beta")).toEqual([2042]);
    expect(await years("?sort=name")).toEqual([2041, 2042, 2043]);
    expect(await years("?sort=-opensAt&pageSize=1")).toHaveLength(1);
    expect((await list(cookie, "?q=beta")).total).toBe(1);
    for (const bad of ["?sort=resultsPublishedAt", "?sort=-createdBy"]) expect((await get(`${LIST}${bad}`, cookie)).status, bad).toBe(400);
  });

  test("the answer carries no applicant's name, address or phone number", async () => {
    const cookie = await viewer();
    const batch = await addBatch();
    await addApplication(batch.id, { fullName: "Rahasia Pendaftar", email: "rahasia-pendaftar@example.test", whatsapp: "081200012345", schoolName: "SMA Rahasia" });
    const text = await (await get(LIST, cookie)).text();
    for (const secret of ["Rahasia Pendaftar", "rahasia-pendaftar", "081200012345", "SMA Rahasia"]) expect(text).not.toContain(secret);
  });
});

describe("batches: the detail", () => {
  type Detail = {
    id: string;
    phase: string;
    canPublish: boolean;
    counts: Record<string, number>;
    recent: { id: string; fullName: string; email: string; schoolName: string; status: string; submittedAt: string }[];
    updatedAt: string;
    resultsPublishedAt: string | null;
  };
  const detail = async (cookie: string, id: string) => (await body<{ item: Detail }>(await get(`${LIST}/${id}`, cookie))).item;

  test("counts per status, the five newest applicants (newest first), and the ETag", async () => {
    const cookie = await viewer();
    const batch = await addBatch();
    await addApplications(batch.id, { pending: 4, under_review: 1, accepted: 3, rejected: 2 });
    const res = await get(`${LIST}/${batch.id}`, cookie);
    expect(res.status).toBe(200);
    const { item } = await body<{ item: Detail }>(res);
    expect(item.counts).toEqual({ pending: 4, under_review: 1, accepted: 3, rejected: 2, total: 10 });
    expect(item.phase).toBe("awaiting_decisions");
    expect(item.canPublish).toBe(false);
    expect(item.recent).toHaveLength(5);
    const times = item.recent.map((entry) => Date.parse(entry.submittedAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(Object.keys(item.recent[0]!).sort()).toEqual(["email", "fullName", "id", "schoolName", "status", "submittedAt"]);
    expect(res.headers.get("etag")).toBe(`"${item.updatedAt}"`);
  });

  test("a batch with no applicants has zero counts and an empty list", async () => {
    const cookie = await viewer();
    const batch = await addBatch();
    const item = await detail(cookie, batch.id);
    expect(item.counts).toEqual({ pending: 0, under_review: 0, accepted: 0, rejected: 0, total: 0 });
    expect(item.recent).toEqual([]);
    expect(item.phase).toBe("closed_empty");
    expect(item.canPublish).toBe(false);
  });

  test("it only counts its own batch", async () => {
    const cookie = await viewer();
    const mine = await addBatch();
    const other = await addBatch();
    await addApplications(mine.id, { accepted: 1 });
    await addApplications(other.id, { pending: 5 });
    expect((await detail(cookie, mine.id)).counts.total).toBe(1);
  });

  test("canPublish is the legacy rule: not published, at least one applicant, none undecided", async () => {
    const cookie = await viewer();
    const ready = await readyBatch();
    expect(await detail(cookie, ready.id)).toMatchObject({ canPublish: true, phase: "ready_to_publish" });
    const published = await addBatch({ resultsPublishedAt: new Date() });
    await addApplications(published.id, { accepted: 1 });
    expect(await detail(cookie, published.id)).toMatchObject({ canPublish: false, phase: "published" });
  });
});

describe("batches: publishing the results", () => {
  const refusal = async (response: Response) => body<{ error: string; message: string; undecided?: number }>(response);

  test("the legacy preconditions, in the legacy order, each in the legacy words", async () => {
    const cookie = await editor();

    expect((await post(`${LIST}/tidak-ada/publish`, cookie)).status).toBe(404);
    expect(await refusal(await post(`${LIST}/tidak-ada/publish`, cookie))).toEqual({ error: "not_found", message: "Batch tidak ditemukan" });

    const empty = await addBatch();
    const none = await post(`${LIST}/${empty.id}/publish`, cookie);
    expect(none.status).toBe(409);
    expect(await refusal(none)).toEqual({ error: "no_applicants", message: "Belum ada pendaftar di batch ini" });

    const waiting = await addBatch();
    await addApplications(waiting.id, { pending: 2, under_review: 1, accepted: 3 });
    const undecided = await post(`${LIST}/${waiting.id}/publish`, cookie);
    expect(undecided.status).toBe(409);
    expect(await refusal(undecided)).toEqual({ error: "undecided", message: "Masih ada 3 pendaftar yang belum diputuskan", undecided: 3 });

    const done = await addBatch({ resultsPublishedAt: new Date(Date.now() - DAY) });
    await addApplications(done.id, { pending: 1 }); // published AND undecided: the first check wins
    const already = await post(`${LIST}/${done.id}/publish`, cookie);
    expect(already.status).toBe(409);
    expect(await refusal(already)).toEqual({ error: "already_published", message: "Hasil sudah dipublikasikan" });

    // Nothing was written by any of them.
    expect(await count("audit_log")).toBe(0);
    expect((await rowOf<{ results_published_at: number | null }>("admission_batches", empty.id))?.results_published_at).toBeNull();
    expect((await rowOf<{ results_published_at: number | null }>("admission_batches", waiting.id))?.results_published_at).toBeNull();
  });

  // Negative test (scripts/negative-checks-pendaftaran.mjs): drop the preconditions and these publish what must not be.
  test("a batch whose applicants are all decided is published: the date is set, the version moves, one audit row of field names", async () => {
    const email = uniqueEmail("editor");
    const cookie = await signedInCookie(email, "editor", ["pendaftaran"]);
    const batch = await readyBatch();
    const before = await rowOf<{ updated_at: number }>("admission_batches", batch.id);
    const start = Date.now();

    const res = await post(`${LIST}/${batch.id}/publish`, cookie);
    expect(res.status).toBe(200);
    const { item } = await body<{ item: { resultsPublishedAt: string; phase: string; canPublish: boolean; updatedAt: string; counts: { total: number } } }>(res);
    expect(Date.parse(item.resultsPublishedAt)).toBeGreaterThanOrEqual(start - 1000);
    expect(item).toMatchObject({ phase: "published", canPublish: false, counts: { total: 3 } });
    expect(res.headers.get("etag")).toBe(`"${item.updatedAt}"`);

    const row = await rowOf<{ results_published_at: number; updated_at: number }>("admission_batches", batch.id);
    expect(row?.results_published_at).toBe(Date.parse(item.resultsPublishedAt));
    expect(row!.updated_at).toBeGreaterThan(before!.updated_at);

    const rows = await audit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_email: email, action: "batch.publish_results", resource_type: "batch", resource_id: batch.id });
    // Names only, plus the batch name: the legacy row also held the accepted and rejected counts.
    expect(JSON.parse(rows[0]!.metadata!)).toEqual({ fields: ["resultsPublishedAt"], label: batch.name });
  });

  test("a second publish is refused, and the first publication date stays", async () => {
    const cookie = await editor();
    const batch = await readyBatch();
    expect((await post(`${LIST}/${batch.id}/publish`, cookie)).status).toBe(200);
    const first = (await rowOf<{ results_published_at: number }>("admission_batches", batch.id))!.results_published_at;
    const again = await post(`${LIST}/${batch.id}/publish`, cookie);
    expect(again.status).toBe(409);
    expect((await again.json()) as object).toMatchObject({ error: "already_published" });
    expect((await rowOf<{ results_published_at: number }>("admission_batches", batch.id))!.results_published_at).toBe(first);
    expect((await audit()).map((row) => row.action)).toEqual(["batch.publish_results"]);
  });

  test("two publishes at once: one wins, the other is told it is already published, one audit row", async () => {
    const cookie = await editor();
    const batch = await readyBatch();
    const results = await Promise.all([post(`${LIST}/${batch.id}/publish`, cookie), post(`${LIST}/${batch.id}/publish`, cookie)]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    expect((await audit()).map((row) => row.action)).toEqual(["batch.publish_results"]);
  });

  // The rule is in the UPDATE's WHERE too: an applicant moved back to "pending" after the check cannot be published over.
  test("an applicant sent back to pending between the check and the write stops the publication, and nothing is written", async () => {
    const cookie = await editor();
    const batch = await readyBatch();
    const victim = (await env.DB.prepare("SELECT id FROM student_applications WHERE batch_id = ? LIMIT 1").bind(batch.id).first<{ id: string }>())!.id;

    // The first read of the route (the batch, its counts and its newest applicants) goes through; right after it
    // somebody else sends one applicant back to "pending".
    let interfered = false;
    const db = new Proxy(env.DB, {
      get(target, property) {
        const value = Reflect.get(target, property, target) as unknown;
        if (property === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            const results = await target.batch(statements);
            if (!interfered && statements.length === 3) {
              interfered = true;
              await target.prepare("UPDATE student_applications SET status = 'pending' WHERE id = ?").bind(victim).run();
            }
            return results;
          };
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const res = await call(`${LIST}/${batch.id}/publish`, { method: "POST", cookie, env: { DB: db } });
    expect(interfered).toBe(true);
    expect(res.status).toBe(409);
    expect(await refusal(res)).toEqual({ error: "undecided", message: "Masih ada 1 pendaftar yang belum diputuskan", undecided: 1 });
    expect((await rowOf<{ results_published_at: number | null }>("admission_batches", batch.id))?.results_published_at).toBeNull();
    expect(await count("audit_log")).toBe(0);
  });
});

describe("batches: cancelling the publication", () => {
  test("clears the date, moves the version, writes one audit row, and the batch can be published again", async () => {
    const email = uniqueEmail("editor");
    const cookie = await signedInCookie(email, "editor", ["pendaftaran"]);
    const batch = await readyBatch();
    await post(`${LIST}/${batch.id}/publish`, cookie);
    const published = await rowOf<{ updated_at: number }>("admission_batches", batch.id);

    const res = await post(`${LIST}/${batch.id}/unpublish`, cookie);
    expect(res.status).toBe(200);
    const { item } = await body<{ item: { resultsPublishedAt: string | null; phase: string; canPublish: boolean } }>(res);
    expect(item).toMatchObject({ resultsPublishedAt: null, phase: "ready_to_publish", canPublish: true });
    const row = await rowOf<{ results_published_at: number | null; updated_at: number }>("admission_batches", batch.id);
    expect(row?.results_published_at).toBeNull();
    expect(row!.updated_at).toBeGreaterThan(published!.updated_at);

    const rows = await audit();
    expect(rows.map((entry) => entry.action)).toEqual(["batch.publish_results", "batch.unpublish_results"]);
    expect(rows[1]).toMatchObject({ actor_email: email, resource_type: "batch", resource_id: batch.id });
    expect(JSON.parse(rows[1]!.metadata!)).toEqual({ fields: ["resultsPublishedAt"], label: batch.name });

    expect((await post(`${LIST}/${batch.id}/publish`, cookie)).status).toBe(200);
  });

  test("cancelling what is not published changes nothing and writes nothing (the legacy action wrote an audit row anyway)", async () => {
    const cookie = await editor();
    const batch = await readyBatch();
    const before = await rowOf<{ updated_at: number }>("admission_batches", batch.id);
    const res = await post(`${LIST}/${batch.id}/unpublish`, cookie);
    expect(res.status).toBe(200);
    expect((await body<{ item: { resultsPublishedAt: string | null } }>(res)).item.resultsPublishedAt).toBeNull();
    expect((await rowOf<{ updated_at: number }>("admission_batches", batch.id))?.updated_at).toBe(before?.updated_at);
    expect(await count("audit_log")).toBe(0);
  });

  test("a batch that does not exist is 404 in the legacy words", async () => {
    const cookie = await editor();
    const res = await post(`${LIST}/tidak-ada/unpublish`, cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found", message: "Batch tidak ditemukan" });
  });
});

describe("batches: nothing leaves the admin", () => {
  test("no change to a batch asks for a purge of the public site, and no email is sent to anybody", async () => {
    const notify = vi.fn<(change: ContentChange) => void>();
    const deps: CrudDeps = { notify: (change) => notify(change), deleteUpload: async () => ({ status: "not_found" }) };
    const app = appAround({ "/api/admin/batches": createBatchRoutes(deps) });
    const cookie = await editor();
    const mailBefore = emails().length;

    const created = await call(LIST, { method: "POST", cookie, json: valid(), via: app });
    const id = (await body<{ item: { id: string; year: number; opensAt: string; closesAt: string } }>(created)).item;
    await call(`${LIST}/${id.id}`, { method: "PUT", cookie, headers: await etagOfRow("admission_batches", id.id), json: valid({ year: id.year, name: "Baru lagi", opensAt: id.opensAt, closesAt: id.closesAt }), via: app });
    await addApplications(id.id, { accepted: 1 });
    await call(`${LIST}/${id.id}/publish`, { method: "POST", cookie, via: app });
    await call(`${LIST}/${id.id}/unpublish`, { method: "POST", cookie, via: app });
    const empty = await addBatch();
    await call(`${LIST}/${empty.id}`, { method: "DELETE", cookie, via: app });

    expect(notify).not.toHaveBeenCalled();
    expect(emails().length).toBe(mailBefore);
    expect((await audit()).map((row) => row.action)).toEqual(["batch.create", "batch.update", "batch.publish_results", "batch.unpublish_results", "batch.delete"]);
  });
});
