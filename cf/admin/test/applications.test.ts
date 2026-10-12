import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vitest";
import { call, createVerifiedUser, emails, signedInCookie, signIn, cookiesOf, uniqueEmail } from "./helpers";
import { addApplication, addApplications, addBatch, APPLICANT, audit, count, etagOfRow, MATRIX, rowOf } from "./pendaftaran-helpers";

// Pendaftar (SAKEM-082, area `pendaftaran`): a port of app/(admin)/admin/applications/*. The list and its
// filters, the search (a prefix match, never `LIKE '%q%'`), the detail with every answer, and the review with the
// legacy rules, messages and audit actions. The pure rules are in test/admission-rules.test.ts, the plans and the
// rows read in test/pendaftaran-plans.test.ts.

const LIST = "/api/admin/applications";

const editor = () => signedInCookie(uniqueEmail("editor"), "editor", ["pendaftaran"]);
const viewer = () => signedInCookie(uniqueEmail("viewer"), "viewer");

async function body<T = Record<string, unknown>>(response: Response) {
  return (await response.json()) as T;
}

const get = (path: string, cookie: string) => call(path, { cookie });

/** The review: the version of the row as the SPA built it, unless the test says another. */
async function decide(id: string, cookie: string, json: unknown, headers?: Record<string, string>) {
  return call(`${LIST}/${id}/status`, { method: "POST", cookie, json, headers: headers ?? (await etagOfRow("student_applications", id)) });
}

type Listed = { id: string; fullName: string; email: string; status: string; batch: { id: string; year: number; name: string } };
type Page = { items: Listed[]; page: number; pageSize: number; total: number };
const page = async (cookie: string, query = "") => body<Page>(await get(`${LIST}${query}`, cookie));
const names = async (cookie: string, query = "") => (await page(cookie, query)).items.map((item) => item.fullName);

describe("applications: who may do what", () => {
  test("nobody signed in: 401 on every route", async () => {
    const batch = await addBatch();
    const application = await addApplication(batch.id);
    const results = await Promise.all([call(LIST), call(`${LIST}/${application.id}`), call(`${LIST}/${application.id}/status`, { method: "POST", json: { status: "under_review" } })]);
    expect(results.map((res) => res.status)).toEqual([401, 401, 401]);
    expect(await count("audit_log")).toBe(0);
  });

  // Negative test (scripts/negative-checks-pendaftaran.mjs): take the area check off the review route (or the reads)
  // and the cases that must be refused start to pass the guard.
  for (const { label, role, areas, read, write } of MATRIX) {
    test(`${label}: read ${read ? 200 : 403}, review ${write ? "allowed" : 403}`, async () => {
      const cookie = await signedInCookie(uniqueEmail(role), role, areas);
      const batch = await addBatch();
      const application = await addApplication(batch.id, { fullName: APPLICANT.fullName });
      const version = await etagOfRow("student_applications", application.id);

      const list = await get(LIST, cookie);
      const one = await get(`${LIST}/${application.id}`, cookie);
      expect([list.status, one.status]).toEqual(read ? [200, 200] : [403, 403]);
      // A refused read says nothing about who is there.
      if (!read) for (const res of [list, one]) expect(await res.json()).toEqual({ error: "forbidden" });

      const review = await decide(application.id, cookie, { status: "under_review" }, version);
      expect(review.status).toBe(write ? 200 : 403);
      const row = await rowOf<{ status: string; reviewed_by: string | null }>("student_applications", application.id);
      expect(row?.status).toBe(write ? "under_review" : "pending");
      expect((await audit()).map((entry) => entry.action)).toEqual(write ? ["application.under_review"] : []);
    });
  }

  test("a student cannot read their own application through the admin API", async () => {
    const email = uniqueEmail("student");
    const cookie = await signedInCookie(email);
    const userId = (await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>())!.id;
    const batch = await addBatch();
    const application = await addApplication(batch.id, { userId, email });
    expect((await get(`${LIST}/${application.id}`, cookie)).status).toBe(403);
    expect((await get(LIST, cookie)).status).toBe(403);
  });

  test("a role or grant changed in the database applies to the very next request", async () => {
    const email = uniqueEmail("regranted");
    const userId = await createVerifiedUser(email, "editor", ["pendaftaran"]);
    const cookie = cookiesOf(await signIn(email));
    const batch = await addBatch();
    const application = await addApplication(batch.id);
    expect((await get(`${LIST}/${application.id}`, cookie)).status).toBe(200);
    await env.DB.prepare("DELETE FROM admin_area_grants WHERE user_id = ?").bind(userId).run();
    expect((await get(`${LIST}/${application.id}`, cookie)).status).toBe(403);
    await env.DB.prepare("INSERT INTO admin_area_grants (user_id, area) VALUES (?, 'pendaftaran')").bind(userId).run();
    await env.DB.prepare("UPDATE users SET role = 'viewer' WHERE id = ?").bind(userId).run();
    expect((await get(`${LIST}/${application.id}`, cookie)).status).toBe(200);
    expect((await decide(application.id, cookie, { status: "under_review" })).status).toBe(403);
  });
});

describe("applications: the list", () => {
  test("newest first, as an envelope, with the batch of each row and an explicit field list", async () => {
    const cookie = await viewer();
    const batch = await addBatch({ year: 2041, name: "Gen Uji" });
    await addApplication(batch.id, { fullName: "Lama", submittedAt: new Date(1000) });
    await addApplication(batch.id, { fullName: "Baru", submittedAt: new Date(2000) });
    const res = await get(LIST, cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const result = await body<Page>(res);
    expect(result).toMatchObject({ page: 1, pageSize: 20, total: 2 });
    expect(result.items.map((item) => item.fullName)).toEqual(["Baru", "Lama"]);
    expect(result.items[0]!.batch).toEqual({ id: batch.id, year: 2041, name: "Gen Uji" });
    // No answers, no notes, no phone number, no account id in a list row.
    expect(Object.keys(result.items[0]!).sort()).toEqual(["batch", "branchPreference", "email", "fullName", "graduationYear", "id", "schoolName", "status", "submittedAt", "updatedAt"]);
  });

  test("filters by status and by batch, both together, and `batch=all` means every batch", async () => {
    const cookie = await viewer();
    const one = await addBatch();
    const two = await addBatch();
    await addApplication(one.id, { fullName: "A satu", status: "pending", submittedAt: new Date(1000) });
    await addApplication(one.id, { fullName: "B satu", status: "accepted", submittedAt: new Date(2000) });
    await addApplication(two.id, { fullName: "C dua", status: "pending", submittedAt: new Date(3000) });

    expect(await names(cookie, "?status=pending")).toEqual(["C dua", "A satu"]);
    expect(await names(cookie, `?batch=${one.id}`)).toEqual(["B satu", "A satu"]);
    expect(await names(cookie, `?batch=${one.id}&status=pending`)).toEqual(["A satu"]);
    expect(await names(cookie, "?batch=all&status=accepted")).toEqual(["B satu"]);
    expect(await names(cookie, "?batch=all")).toEqual(["C dua", "B satu", "A satu"]);
    expect((await page(cookie, `?batch=${two.id}`)).total).toBe(1);
    // An empty value is no filter.
    expect(await names(cookie, "?status=&batch=")).toEqual(["C dua", "B satu", "A satu"]);
  });

  test("a status that does not exist is 400 invalid_query naming the parameter, a batch nobody has is an empty list", async () => {
    const cookie = await viewer();
    const batch = await addBatch();
    await addApplication(batch.id);
    const bad = await get(`${LIST}?status=approved`, cookie);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "invalid_query", param: "status" });
    expect((await get(`${LIST}?sort=whatsapp`, cookie)).status).toBe(400);
    expect((await get(`${LIST}?sort=-formData`, cookie)).status).toBe(400);
    expect((await get(`${LIST}?batch=${"x".repeat(200)}`, cookie)).status).toBe(400);
    expect(await page(cookie, "?batch=bukan-batch-mana-pun")).toMatchObject({ items: [], total: 0 });
  });

  test("pages: the true total, the clamped sizes, a page past the end is empty", async () => {
    const cookie = await viewer();
    const batch = await addBatch();
    await addApplications(batch.id, { pending: 5 });
    const first = await page(cookie, "?pageSize=2");
    expect(first).toMatchObject({ page: 1, pageSize: 2, total: 5 });
    expect(first.items).toHaveLength(2);
    expect((await page(cookie, "?pageSize=2&page=3")).items).toHaveLength(1);
    expect(await page(cookie, "?pageSize=2&page=9")).toMatchObject({ items: [], total: 5, page: 9 });
    expect((await page(cookie, "?pageSize=500")).pageSize).toBe(100);
    // No row appears on two pages.
    const ids = [...(await page(cookie, "?pageSize=2&page=1")).items, ...(await page(cookie, "?pageSize=2&page=2")).items, ...(await page(cookie, "?pageSize=2&page=3")).items].map((item) => item.id);
    expect(new Set(ids).size).toBe(5);
  });

  test("sorts by a whitelist: newest first by default, or by name", async () => {
    const cookie = await viewer();
    const batch = await addBatch();
    await addApplication(batch.id, { fullName: "Charlie", submittedAt: new Date(1000) });
    await addApplication(batch.id, { fullName: "Alpha", submittedAt: new Date(3000) });
    await addApplication(batch.id, { fullName: "Bravo", submittedAt: new Date(2000) });
    expect(await names(cookie)).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(await names(cookie, "?sort=submittedAt")).toEqual(["Charlie", "Bravo", "Alpha"]);
    expect(await names(cookie, "?sort=fullName")).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(await names(cookie, "?sort=-fullName")).toEqual(["Charlie", "Bravo", "Alpha"]);
  });

  describe("search: the start of a name or of an email, and nothing in the middle", () => {
    async function people() {
      const batch = await addBatch();
      const rows = [
        { fullName: "Siti Aminah", email: "siti.aminah@example.test" },
        { fullName: "Budi Santoso", email: "budi.santoso@example.test" },
        { fullName: "Ani Siti Rahma", email: "ani.rahma@example.test" },
        { fullName: "100% Semangat", email: "semangat@example.test" },
        { fullName: "Dewi_Lestari", email: "dewi_lestari@example.test" },
        { fullName: "Éka Putri", email: "eka.putri@example.test" },
      ];
      for (const [index, row] of rows.entries()) await addApplication(batch.id, { ...row, submittedAt: new Date(1000 + index) });
      return batch;
    }

    test("a name prefix, in any letter case", async () => {
      const cookie = await viewer();
      await people();
      expect(await names(cookie, "?q=siti")).toEqual(["Siti Aminah"]);
      expect(await names(cookie, "?q=SITI")).toEqual(["Siti Aminah"]);
      expect(await names(cookie, "?q=Budi%20San")).toEqual(["Budi Santoso"]);
    });

    test("an email prefix, in any letter case", async () => {
      const cookie = await viewer();
      await people();
      expect(await names(cookie, "?q=budi.s")).toEqual(["Budi Santoso"]);
      expect(await names(cookie, "?q=ANI.RAH")).toEqual(["Ani Siti Rahma"]);
      expect(await names(cookie, "?q=semangat@")).toEqual(["100% Semangat"]);
    });

    // Negative test (scripts/negative-checks-pendaftaran.mjs): `%q%` instead of `q%` and "aminah" or "santoso" match.
    test("the middle of a name or an email matches nothing: this is a prefix search, not a contains", async () => {
      const cookie = await viewer();
      await people();
      expect(await names(cookie, "?q=aminah")).toEqual([]);
      expect(await names(cookie, "?q=santoso")).toEqual([]);
      expect(await names(cookie, "?q=example")).toEqual([]);
      expect(await names(cookie, "?q=rahma")).toEqual([]); // "Ani Siti Rahma": the last word is not the start
      expect(await names(cookie, "?q=ni")).toEqual([]);
    });

    test("LIKE wildcards in the search match only themselves", async () => {
      const cookie = await viewer();
      await people();
      expect(await names(cookie, "?q=100%25")).toEqual(["100% Semangat"]);
      expect(await names(cookie, "?q=%25")).toEqual([]); // "%" is not "anything"
      expect(await names(cookie, "?q=_")).toEqual([]);
      expect(await names(cookie, "?q=Dewi_")).toEqual(["Dewi_Lestari"]);
      expect(await names(cookie, "?q=Dewi%25")).toEqual([]);
      expect(await names(cookie, "?q=dewi!")).toEqual([]);
    });

    test("combines with the filters and the pages, and counts what matches", async () => {
      const cookie = await viewer();
      const batch = await addBatch();
      const other = await addBatch();
      for (let i = 0; i < 5; i++) await addApplication(batch.id, { fullName: `Sari ${i}`, status: i < 3 ? "pending" : "accepted", submittedAt: new Date(1000 + i) });
      await addApplication(other.id, { fullName: "Sari lain", status: "pending", submittedAt: new Date(9000) });
      expect((await page(cookie, "?q=sari")).total).toBe(6);
      expect((await page(cookie, `?q=sari&batch=${batch.id}`)).total).toBe(5);
      expect((await page(cookie, `?q=sari&batch=${batch.id}&status=accepted`)).total).toBe(2);
      const second = await page(cookie, `?q=sari&batch=${batch.id}&pageSize=2&page=2`);
      expect(second).toMatchObject({ total: 5, page: 2 });
      expect(second.items).toHaveLength(2);
    });

    test("a very long search, or one made of multi-byte characters, is cut to what fits and is never a 500", async () => {
      const cookie = await viewer();
      const batch = await addBatch();
      await addApplication(batch.id, { fullName: `${"a".repeat(60)} panjang` });
      for (const q of ["a".repeat(300), "%".repeat(100), "漢".repeat(100), "é".repeat(100), "_!%".repeat(40)]) {
        const res = await get(`${LIST}?q=${encodeURIComponent(q)}`, cookie);
        expect(res.status, q.slice(0, 10)).toBe(200);
      }
      // 300 a's are cut to the first 48: the name starts with them.
      expect(await names(cookie, `?q=${"a".repeat(300)}`)).toHaveLength(1);
    });

    test("an empty or blank search is no search", async () => {
      const cookie = await viewer();
      await people();
      expect((await page(cookie, "?q=")).total).toBe(6);
      expect((await page(cookie, "?q=%20%20")).total).toBe(6);
    });
  });
});

describe("applications: the detail", () => {
  const formData = {
    formVersion: 2,
    identity: { nickname: "Siti", gender: "perempuan", religion: "Islam", homeAddress: "Jl. Contoh No. 1" },
    household: { livingWith: ["Ibu"], father: { name: "Ayah", occupation: "Petani", income: 1_000_000 }, mother: { name: "Ibu", occupation: "IRT", income: 0 }, otherEarners: [], familySize: 4 },
    documents: { familyCardUrl: "https://drive.example.test/kk", dtksRegistered: false },
    interview: { motivationSakem: "Ingin belajar", agreedToSignedStatement: true },
  };

  test("everything of the application: the answers, the notes, its batch, and an ETag", async () => {
    const cookie = await viewer();
    const batch = await addBatch({ year: 2041, name: "Gen Uji" });
    const application = await addApplication(batch.id, {
      fullName: APPLICANT.fullName,
      email: APPLICANT.email,
      whatsapp: APPLICANT.whatsapp,
      schoolName: APPLICANT.schoolName,
      branchPreference: "Bandung",
      reviewNotes: APPLICANT.note,
      reviewedAt: new Date(5000),
      formData: formData as never,
    });
    const res = await get(`${LIST}/${application.id}`, cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { item } = await body<{ item: Record<string, unknown> }>(res);
    expect(item).toMatchObject({
      id: application.id,
      batch: { id: batch.id, year: 2041, name: "Gen Uji" },
      fullName: APPLICANT.fullName,
      email: APPLICANT.email,
      whatsapp: APPLICANT.whatsapp,
      schoolName: APPLICANT.schoolName,
      branchPreference: "Bandung",
      status: "pending",
      reviewNotes: APPLICANT.note,
      reviewedAt: new Date(5000).toISOString(),
      formData,
    });
    // An explicit field list: no account id, no reviewer id.
    expect(Object.keys(item).sort()).toEqual([
      "batch", "branchPreference", "economicBackground", "email", "formData", "fullName", "graduationYear", "id", "motivation",
      "reviewNotes", "reviewedAt", "schoolName", "status", "submittedAt", "updatedAt", "whatsapp",
    ]);
    expect(res.headers.get("etag")).toBe(`"${item.updatedAt}"`);
  });

  test("an old application with no wizard answers has formData null and its legacy story", async () => {
    const cookie = await viewer();
    const batch = await addBatch();
    const application = await addApplication(batch.id, { motivation: "Cerita lama", economicBackground: "Latar lama", formData: null });
    const { item } = await body<{ item: { formData: unknown; motivation: string; economicBackground: string } }>(await get(`${LIST}/${application.id}`, cookie));
    expect(item).toMatchObject({ formData: null, motivation: "Cerita lama", economicBackground: "Latar lama" });
  });

  test("an application that does not exist, or an id that cannot, is 404", async () => {
    const cookie = await viewer();
    expect((await get(`${LIST}/tidak-ada`, cookie)).status).toBe(404);
    expect((await get(`${LIST}/${"x".repeat(200)}`, cookie)).status).toBe(404);
  });
});

describe("applications: the review", () => {
  test("a decision sets the status and the note, records who reviewed and when, moves the version, and writes one audit row of field names", async () => {
    const email = uniqueEmail("editor");
    const cookie = await signedInCookie(email, "editor", ["pendaftaran"]);
    const batch = await addBatch();
    const application = await addApplication(batch.id, { fullName: APPLICANT.fullName, email: APPLICANT.email, whatsapp: APPLICANT.whatsapp });
    const before = await rowOf<{ updated_at: number }>("student_applications", application.id);
    const start = Date.now();

    const res = await decide(application.id, cookie, { status: "accepted", reviewNotes: "  Berkas lengkap, wawancara baik.  " });
    expect(res.status).toBe(200);
    const { item } = await body<{ item: Record<string, unknown> }>(res);
    expect(item).toMatchObject({ status: "accepted", reviewNotes: "Berkas lengkap, wawancara baik.", fullName: APPLICANT.fullName });
    expect(Date.parse(item.reviewedAt as string)).toBeGreaterThanOrEqual(start - 1000);
    expect(res.headers.get("etag")).toBe(`"${item.updatedAt}"`);

    const row = await rowOf<{ status: string; review_notes: string; reviewed_by: string; reviewed_at: number; updated_at: number }>("student_applications", application.id);
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
    expect(row).toMatchObject({ status: "accepted", review_notes: "Berkas lengkap, wawancara baik.", reviewed_by: user?.id });
    expect(row!.updated_at).toBeGreaterThan(before!.updated_at);

    const rows = await audit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_email: email, action: "application.accepted", resource_type: "application", resource_id: application.id });
    // The names of the columns written, and nothing else: no label (it is about a person), no note.
    expect(JSON.parse(rows[0]!.metadata!)).toEqual({ fields: ["status", "reviewNotes", "reviewedBy", "reviewedAt"] });
  });

  test("an empty note is stored as no note, and pending and under_review need none", async () => {
    const cookie = await editor();
    const batch = await addBatch();
    const application = await addApplication(batch.id, { status: "pending", reviewNotes: "Catatan lama" });
    const res = await decide(application.id, cookie, { status: "under_review", reviewNotes: "" });
    expect(res.status).toBe(200);
    expect((await rowOf<{ review_notes: string | null }>("student_applications", application.id))?.review_notes).toBeNull();
    expect((await decide(application.id, cookie, { status: "pending" })).status).toBe(200);
  });

  test("accepting or rejecting without a note is 400 on the note, in the legacy words, and nothing changes", async () => {
    const cookie = await editor();
    const batch = await addBatch();
    const application = await addApplication(batch.id);
    for (const status of ["accepted", "rejected"]) {
      for (const reviewNotes of ["", "   ", undefined]) {
        const res = await decide(application.id, cookie, { status, reviewNotes });
        expect(res.status, `${status} / ${String(reviewNotes)}`).toBe(400);
        expect(await res.json()).toEqual({
          error: "invalid",
          message: "Periksa kembali isian formulir.",
          fields: { reviewNotes: "Catatan review wajib diisi saat menerima atau menolak." },
        });
      }
    }
    expect((await rowOf<{ status: string }>("student_applications", application.id))?.status).toBe("pending");
    expect(await count("audit_log")).toBe(0);
  });

  test("a status that does not exist, or a note over 2000 characters, is 400 with a message of ours", async () => {
    const cookie = await editor();
    const batch = await addBatch();
    const application = await addApplication(batch.id);
    const unknown = await decide(application.id, cookie, { status: "approved", reviewNotes: "x" });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ fields: { status: "Status tidak dikenal" } });
    const long = await decide(application.id, cookie, { status: "pending", reviewNotes: "x".repeat(2001) });
    expect(long.status).toBe(400);
    expect(await long.json()).toMatchObject({ fields: { reviewNotes: "Catatan review maksimal 2000 karakter" } });
    expect((await decide(application.id, cookie, { status: "pending", reviewNotes: "x".repeat(2000) })).status).toBe(200);
  });

  test("the legacy transitions: any status can follow any other", async () => {
    const cookie = await editor();
    const batch = await addBatch();
    const application = await addApplication(batch.id);
    const path: [string, string][] = [
      ["under_review", ""],
      ["accepted", "Diterima."],
      ["pending", ""],
      ["rejected", "Ditolak."],
      ["accepted", "Diterima setelah banding."],
      ["under_review", ""],
    ];
    for (const [status, reviewNotes] of path) {
      const res = await decide(application.id, cookie, { status, reviewNotes });
      expect(res.status, status).toBe(200);
      expect((await rowOf<{ status: string }>("student_applications", application.id))?.status).toBe(status);
    }
    expect((await audit()).map((row) => row.action)).toEqual([
      "application.under_review",
      "application.accepted",
      "application.pending",
      "application.rejected",
      "application.accepted",
      "application.under_review",
    ]);
  });

  // Negative test (scripts/negative-checks-pendaftaran.mjs): without the rule, a one-word reason revokes an acceptance.
  test("revoking an acceptance needs a reason of at least 20 characters, and is logged as application.revoke", async () => {
    const cookie = await editor();
    const batch = await addBatch();
    const application = await addApplication(batch.id, { status: "accepted", reviewNotes: "Diterima." });

    const short = await decide(application.id, cookie, { status: "rejected", reviewNotes: "x".repeat(19) });
    expect(short.status).toBe(400);
    expect(await short.json()).toMatchObject({
      error: "invalid",
      fields: { reviewNotes: "Alasan pencabutan wajib diisi minimal 20 karakter — jelaskan mengapa penerimaan ini dibatalkan." },
    });
    expect((await rowOf<{ status: string; review_notes: string }>("student_applications", application.id))).toMatchObject({ status: "accepted", review_notes: "Diterima." });
    expect(await count("audit_log")).toBe(0);

    const reason = "Siswa mengundurkan diri secara resmi.";
    const ok = await decide(application.id, cookie, { status: "rejected", reviewNotes: reason });
    expect(ok.status).toBe(200);
    const rows = await audit();
    expect(rows.map((row) => row.action)).toEqual(["application.revoke"]);
    // The reason is in the application's own note; the audit row does not repeat it.
    expect(rows[0]!.metadata).not.toContain("mengundurkan");
    expect(JSON.parse(rows[0]!.metadata!)).toEqual({ fields: ["status", "reviewNotes", "reviewedBy", "reviewedAt"] });
    expect((await rowOf<{ review_notes: string }>("student_applications", application.id))?.review_notes).toBe(reason);
  });

  test("rejecting someone who was not accepted is an ordinary decision with an ordinary note", async () => {
    const cookie = await editor();
    const batch = await addBatch();
    for (const status of ["pending", "under_review", "rejected"] as const) {
      const application = await addApplication(batch.id, { status });
      expect((await decide(application.id, cookie, { status: "rejected", reviewNotes: "Tidak memenuhi syarat." })).status, status).toBe(200);
    }
    expect((await audit()).map((row) => row.action)).toEqual(["application.rejected", "application.rejected", "application.rejected"]);
  });

  test("the review needs If-Match (428); a stale one is 409 and writes nothing; two reviewers cannot both decide", async () => {
    const cookie = await editor();
    const batch = await addBatch();
    const application = await addApplication(batch.id);
    const first = await etagOfRow("student_applications", application.id);

    const missing = await call(`${LIST}/${application.id}/status`, { method: "POST", cookie, json: { status: "under_review" } });
    expect(missing.status).toBe(428);

    expect((await decide(application.id, cookie, { status: "under_review" }, first)).status).toBe(200);
    const late = await decide(application.id, cookie, { status: "rejected", reviewNotes: "Terlambat." }, first);
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ error: "stale" });
    expect((await rowOf<{ status: string }>("student_applications", application.id))?.status).toBe("under_review");
    expect((await audit()).map((row) => row.action)).toEqual(["application.under_review"]);

    // Two decisions on the same version, at the same moment: exactly one is written.
    const version = await etagOfRow("student_applications", application.id);
    const both = await Promise.all([decide(application.id, cookie, { status: "accepted", reviewNotes: "Satu." }, version), decide(application.id, cookie, { status: "rejected", reviewNotes: "Dua." }, version)]);
    expect(both.map((res) => res.status).sort()).toEqual([200, 409]);
    expect((await audit()).filter((row) => row.action !== "application.under_review")).toHaveLength(1);
  });

  test("an application that does not exist is 404 in the legacy words; the body is checked first", async () => {
    const cookie = await editor();
    const res = await call(`${LIST}/tidak-ada/status`, { method: "POST", cookie, headers: { "if-match": '"2026-01-01T00:00:00.000Z"' }, json: { status: "pending" } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found", message: "Pendaftar tidak ditemukan." });
    const invalid = await call(`${LIST}/tidak-ada/status`, { method: "POST", cookie, headers: { "if-match": '"2026-01-01T00:00:00.000Z"' }, json: { status: "accepted" } });
    expect(invalid.status).toBe(400);
  });

  test("a body that is not JSON is refused", async () => {
    const cookie = await editor();
    const batch = await addBatch();
    const application = await addApplication(batch.id);
    const headers = await etagOfRow("student_applications", application.id);
    const form = await call(`${LIST}/${application.id}/status`, { method: "POST", cookie, headers: { ...headers, "content-type": "application/x-www-form-urlencoded" }, body: "status=accepted&reviewNotes=ok" });
    const broken = await call(`${LIST}/${application.id}/status`, { method: "POST", cookie, headers: { ...headers, "content-type": "application/json" }, body: "{nope" });
    expect([form.status, broken.status]).toEqual([415, 400]);
    expect((await rowOf<{ status: string }>("student_applications", application.id))?.status).toBe("pending");
  });

  test("the review changes nothing else: not the answers, not the batch, not the contact details", async () => {
    const cookie = await editor();
    const batch = await addBatch();
    const application = await addApplication(batch.id, { fullName: "Nama Tetap", email: "tetap@example.test", whatsapp: "081200099999", schoolName: "SMA Tetap", branchPreference: "Bandung" });
    await decide(application.id, cookie, { status: "under_review" });
    expect(await rowOf("student_applications", application.id)).toMatchObject({ full_name: "Nama Tetap", email: "tetap@example.test", whatsapp: "081200099999", school_name: "SMA Tetap", branch_preference: "Bandung", batch_id: batch.id });
  });
});

describe("applications: nothing about a person leaves except in the answer to someone allowed", () => {
  afterEach(() => vi.restoreAllMocks());

  test("no log line and no audit row holds a name, an address, a phone number or a note, on success or on failure", async () => {
    const logs: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logs.push(args.map((arg) => (arg instanceof Error ? arg.message : typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ")));
    }
    const cookie = await editor();
    const batch = await addBatch();
    const application = await addApplication(batch.id, { fullName: APPLICANT.fullName, email: APPLICANT.email, whatsapp: APPLICANT.whatsapp, schoolName: APPLICANT.schoolName });

    await get(LIST, cookie);
    await get(`${LIST}?q=${encodeURIComponent(APPLICANT.fullName)}`, cookie);
    await get(`${LIST}/${application.id}`, cookie);
    await decide(application.id, cookie, { status: "accepted", reviewNotes: APPLICANT.note });
    await decide(application.id, cookie, { status: "rejected", reviewNotes: `${APPLICANT.note} ${APPLICANT.note}` }); // a revocation
    await decide(application.id, cookie, { status: "accepted", reviewNotes: "" }); // refused
    await get(`${LIST}?status=bukan`, cookie); // refused

    const text = logs.join("\n");
    const audited = (await audit()).map((row) => `${row.resource_id} ${row.metadata ?? ""}`).join("\n");
    for (const secret of [APPLICANT.fullName, APPLICANT.email, APPLICANT.whatsapp, APPLICANT.schoolName, APPLICANT.note]) {
      expect(text, `log: ${secret}`).not.toContain(secret);
      expect(audited, `audit: ${secret}`).not.toContain(secret);
    }
  });

  test("a decision sends no email to the applicant (the legacy review sent none)", async () => {
    const cookie = await editor();
    const batch = await addBatch();
    const application = await addApplication(batch.id, { email: APPLICANT.email });
    const mailBefore = emails().length;
    await decide(application.id, cookie, { status: "accepted", reviewNotes: "Diterima." });
    await decide(application.id, cookie, { status: "rejected", reviewNotes: "Dicabut karena alasan administrasi." });
    expect(emails().length).toBe(mailBefore);
    expect(emails().filter((message) => message.to === APPLICANT.email)).toEqual([]);
  });

  test("there is no way to create, edit or delete an application from the admin: those routes do not exist", async () => {
    const cookie = await editor();
    const batch = await addBatch();
    const application = await addApplication(batch.id);
    const version = await etagOfRow("student_applications", application.id);
    expect((await call(LIST, { method: "POST", cookie, json: { fullName: "Baru" } })).status).toBe(404);
    expect((await call(`${LIST}/${application.id}`, { method: "PUT", cookie, headers: version, json: { fullName: "Ganti" } })).status).toBe(404);
    expect((await call(`${LIST}/${application.id}`, { method: "DELETE", cookie })).status).toBe(404);
    expect(await count("student_applications")).toBe(1);
  });
});
