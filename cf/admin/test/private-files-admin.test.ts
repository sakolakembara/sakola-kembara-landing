import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vitest";
import { call, signedInCookie, uniqueEmail } from "./helpers";
import { limiterClock } from "./limiter-clock";
import { addApplication, addBatch, MATRIX } from "./pendaftaran-helpers";
import {
  ADMIN_APPLICATIONS,
  addDraft,
  auditRows,
  bytes,
  emptyBucketBeforeEach,
  fileRows,
  privateKeys,
  seedFile,
  storage,
  student,
  upload,
  openBatch,
  readOwnFile,
} from "./private-files-helpers";

// The admin's side of the applicants' files (SAKEM-083, P4): the list in the Pendaftar detail, opening one file, and the
// manual purge. docs/cloudflare/portal-api.md, 12.1 to 12.3; docs/cloudflare/portal-architecture.md, 8.6 and 8.9.
// The rules that matter most: opening needs `pendaftaran` WRITE (a viewer sees the list and cannot open), every open is
// audited with ids only BEFORE a byte is sent, and nothing is deleted except by a person (the purge, audited).
// Negative checks: scripts/negative-checks-portal-files.mjs.

emptyBucketBeforeEach();

afterEach(() => {
  vi.restoreAllMocks();
});

const editor = () => signedInCookie(uniqueEmail("editor"), "editor", ["pendaftaran"]);
const viewer = () => signedInCookie(uniqueEmail("viewer"), "viewer");
const superAdmin = () => signedInCookie(uniqueEmail("super"), "super_admin");

const V3 = { formVersion: 3, identity: { nickname: "Nama Panggilan" }, documents: { dtksRegistered: false }, marketing: { instagramUsername: "akun_contoh" } };

/** A submitted application of version 3 with its files seeded as the API would have stored them. */
async function submitted(slots: Parameters<typeof seedFile>[0]["slot"][] = ["family-card"], over: { formData?: unknown } = {}) {
  const batch = await addBatch();
  const application = await addApplication(batch.id, { formData: (over.formData ?? V3) as never });
  const files = [];
  for (const slot of slots) files.push({ slot, ...(await seedFile({ applicationId: application.id, year: batch.year, slot, kind: slot === "electricity-bill" ? "pdf" : "png", size: 300 })) });
  return { batch, application, files };
}

const detail = (id: string, cookie: string) => call(`${ADMIN_APPLICATIONS}/${id}`, { cookie });
const open = (id: string, fileId: string, cookie?: string, init: { method?: string } = {}) => call(`${ADMIN_APPLICATIONS}/${id}/files/${fileId}`, { cookie, method: init.method });
const purge = (id: string, cookie?: string, body: unknown = { confirm: true }) => call(`${ADMIN_APPLICATIONS}/${id}/files/purge`, { method: "POST", cookie, json: body });

describe("the list of files in GET /api/admin/applications/:id (12.1)", () => {
  test("formVersion, the live files (metadata only, oldest first within a slot) and canOpenFiles", async () => {
    const { application, files, batch } = await submitted(["electricity-bill", "family-card"]);
    const later = await seedFile({ applicationId: application.id, year: batch.year, slot: "family-card", kind: "jpeg", size: 400, at: Date.now() + 5000 });
    await seedFile({ applicationId: application.id, year: batch.year, slot: "self-photo", deleted: true });
    const res = await detail(application.id, await editor());
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBeTruthy();
    const { item } = (await res.json()) as { item: Record<string, unknown> & { files: Record<string, unknown>[] } };
    expect(item.formVersion).toBe(3);
    expect(item.canOpenFiles).toBe(true);
    // Table order of the slots does not matter to the contract: slot, then oldest first. A deleted file is not listed.
    expect(item.files.map((file) => [file.slot, file.id])).toEqual([
      ["electricity-bill", files[0]!.id],
      ["family-card", files[1]!.id],
      ["family-card", later.id],
    ]);
    expect(Object.keys(item.files[0]!).sort()).toEqual(["contentType", "height", "id", "size", "slot", "uploadedAt", "width"]);
    expect(item.files[0]).toMatchObject({ contentType: "application/pdf", size: 300, width: null, height: null });
    expect(item.files[1]).toMatchObject({ contentType: "image/png", size: 300, width: 40, height: 30 });
    // Never a key, a checksum or a path.
    expect(JSON.stringify(item)).not.toMatch(/applications\/\d{4}|checksum|PRIVATE|r2/i);
  });

  test("a version 2 application and one with no answers have no files and say so; the review answer is unchanged", async () => {
    const batch = await addBatch();
    const v2 = await addApplication(batch.id, { formData: { formVersion: 2, documents: { fatherIncomeUrl: "https://drive.example/x" } } as never });
    await seedFile({ applicationId: v2.id, year: batch.year }); // a stray row of a version 2 application is not listed
    const none = await addApplication(batch.id, { formData: null });
    const cookie = await editor();
    const a = ((await (await detail(v2.id, cookie)).json()) as { item: { formVersion: unknown; files: unknown[] } }).item;
    expect([a.formVersion, a.files]).toEqual([2, []]);
    const b = ((await (await detail(none.id, cookie)).json()) as { item: { formVersion: unknown; files: unknown[] } }).item;
    expect([b.formVersion, b.files]).toEqual([null, []]);

    const review = await call(`${ADMIN_APPLICATIONS}/${none.id}/status`, {
      method: "POST",
      cookie,
      json: { status: "under_review", reviewNotes: "" },
      headers: { "if-match": (await detail(none.id, cookie)).headers.get("etag")! },
    });
    expect(review.status).toBe(200);
    const reviewed = ((await review.json()) as { item: Record<string, unknown> }).item;
    expect("files" in reviewed || "canOpenFiles" in reviewed || "formVersion" in reviewed).toBe(false);
  });

  for (const { label, role, areas, read, write } of MATRIX) {
    test(`${label}: ${read ? "sees the list" : "403"}, canOpenFiles ${write}`, async () => {
      const cookie = await signedInCookie(uniqueEmail(role), role, areas);
      const { application } = await submitted(["family-card", "self-photo"]);
      const res = await detail(application.id, cookie);
      expect(res.status).toBe(read ? 200 : 403);
      if (!read) return;
      const { item } = (await res.json()) as { item: { files: unknown[]; canOpenFiles: boolean } };
      expect(item.files).toHaveLength(2);
      expect(item.canOpenFiles).toBe(write);
    });
  }

  test("a draft's id is not an application: the detail is a 404 and its files are listed nowhere", async () => {
    const batch = await addBatch();
    const s = await student();
    const draft = await addDraft(s.id, batch.id);
    await seedFile({ applicationId: draft, year: batch.year });
    expect((await detail(draft, await superAdmin())).status).toBe(404);
  });
});

describe("opening a file (12.2)", () => {
  for (const { label, role, areas, write } of MATRIX) {
    test(`${label}: ${write ? "200, one audit row" : "403, no audit row, no read of the bucket"}`, async () => {
      const cookie = await signedInCookie(uniqueEmail(role), role, areas);
      const { application, files } = await submitted();
      const get = vi.spyOn(env.PRIVATE_FILES, "get");
      const res = await open(application.id, files[0]!.id, cookie);
      expect(res.status).toBe(write ? 200 : 403);
      if (write) {
        expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes.png(300));
        expect((await auditRows()).map((row) => row.action)).toEqual(["application_file.view"]);
      } else {
        expect(await res.json()).toEqual({ error: "forbidden" });
        expect(await auditRows()).toEqual([]);
        expect(get).not.toHaveBeenCalled();
      }
    });
  }

  test("nobody: 401; a student's portal cookie is no session on the admin; an admin-audience student account: 403", async () => {
    const { application, files } = await submitted();
    expect((await open(application.id, files[0]!.id)).status).toBe(401);
    const s = await student();
    expect((await open(application.id, files[0]!.id, s.cookie)).status).toBe(401);
    expect((await open(application.id, files[0]!.id, await signedInCookie(uniqueEmail("siswa")))).status).toBe(403);
    expect(await auditRows()).toEqual([]);
  });

  test("the headers are those of 11.4: inline for an image, attachment for a PDF, private and no-store, sandboxed", async () => {
    const { application, files } = await submitted(["family-card", "electricity-bill"]);
    const cookie = await editor();
    const img = await open(application.id, files[0]!.id, cookie);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("content-disposition")).toBe(`inline; filename="family-card-${files[0]!.id.slice(0, 8)}.png"`);
    expect(img.headers.get("cache-control")).toBe("private, no-store");
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
    expect(img.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(img.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(img.headers.get("content-length")).toBe("300");
    const doc = await open(application.id, files[1]!.id, cookie);
    expect(doc.headers.get("content-type")).toBe("application/pdf");
    expect(doc.headers.get("content-disposition")).toMatch(/^attachment; filename="electricity-bill-[0-9a-f]{8}\.pdf"$/);
    for (const name of ["etag", "last-modified", "accept-ranges", "set-cookie"]) expect(img.headers.get(name), name).toBeNull();
  });

  test("only a served file says `private, no-store`: every other answer of the admin API, refusals of these routes included, is a plain `no-store`", async () => {
    const { application, files } = await submitted();
    const cookie = await editor();
    const served = await open(application.id, files[0]!.id, cookie);
    expect(served.headers.get("cache-control")).toBe("private, no-store");
    for (const res of [
      await open(application.id, files[0]!.id), // 401
      await open(application.id, files[0]!.id, await viewer()), // 403
      await open(application.id, crypto.randomUUID(), cookie), // 404
      await detail(application.id, cookie),
      await call("/api/me", { cookie }),
      await purge(application.id, cookie, {}), // 400
    ]) {
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  test("every open writes exactly one audit row, with ids only: the file, the application, the slot", async () => {
    const { application, files } = await submitted(["family-card"]);
    const email = uniqueEmail("editor.mixed");
    const cookie = await signedInCookie(email, "editor", ["pendaftaran"]);
    for (let i = 1; i <= 3; i++) {
      expect((await open(application.id, files[0]!.id, cookie)).status).toBe(200);
      expect(await auditRows()).toHaveLength(i);
    }
    const [row] = await auditRows();
    expect(row).toMatchObject({ actor_email: email.toLowerCase(), action: "application_file.view", resource_type: "application_file", resource_id: files[0]!.id });
    expect(JSON.parse(row!.metadata!)).toEqual({ applicationId: application.id, slot: "family-card" });
    // Nothing else a person could be hurt by: no size, no type, no name, no address of the applicant.
    expect(row!.metadata).not.toMatch(/size|type|name|email|@|\.png|applications\//i);
  });

  test("the row is written before a byte is sent, and when it cannot be written nothing is served (503 audit_unavailable)", async () => {
    const { application, files } = await submitted();
    const cookie = await editor();
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
    await env.DB.exec("CREATE TRIGGER fail_view_audit BEFORE INSERT ON audit_log WHEN NEW.action = 'application_file.view' BEGIN SELECT RAISE(ABORT, 'no'); END");
    try {
      const res = await open(application.id, files[0]!.id, cookie);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "audit_unavailable", message: "Berkas belum bisa dibuka. Coba lagi." });
      expect(res.headers.get("content-type")).toMatch(/json/);
    } finally {
      await env.DB.exec("DROP TRIGGER fail_view_audit");
    }
    expect(await auditRows()).toEqual([]);
    expect(lines).toEqual(["[private-files] the audit row of a file open could not be written; the file was not served"]);
    // The same open works once the log can be written.
    expect((await open(application.id, files[0]!.id, cookie)).status).toBe(200);
  });

  test("404 for every mismatch, and none of them is audited: another application's file, a draft's file, a deleted one, junk ids", async () => {
    const one = await submitted(["family-card"]);
    const two = await submitted(["family-card"]);
    const draftBatch = await addBatch();
    const s = await student();
    const draft = await addDraft(s.id, draftBatch.id);
    const draftFile = await seedFile({ applicationId: draft, year: draftBatch.year });
    const gone = await seedFile({ applicationId: one.application.id, year: one.batch.year, deleted: true });
    const cookie = await editor();

    const cases: [string, string][] = [
      [one.application.id, two.files[0]!.id], // the file belongs to another application
      [two.application.id, one.files[0]!.id],
      [draft, draftFile.id], // a draft is not an application
      [one.application.id, gone.id],
      [one.application.id, crypto.randomUUID()],
      [crypto.randomUUID(), one.files[0]!.id],
      [one.application.id, "x"],
      ["x", one.files[0]!.id],
      [one.application.id, "../../etc/passwd"],
      [one.application.id, one.files[0]!.id.toUpperCase()],
    ];
    const seen = new Set<string>();
    for (const [applicationId, fileId] of cases) {
      const res = await open(applicationId, fileId, cookie);
      expect(res.status, `${applicationId} ${fileId}`).toBe(404);
      seen.add(JSON.stringify(await res.json()));
    }
    expect([...seen]).toEqual(['{"error":"not_found"}']);
    expect(await auditRows()).toEqual([]);
  });

  test("a row whose object is not in the bucket is a 404 and is not audited as an open", async () => {
    const { application, files } = await submitted();
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
    await env.PRIVATE_FILES.delete(files[0]!.key);
    expect((await open(application.id, files[0]!.id, await editor())).status).toBe(404);
    expect(await auditRows()).toEqual([]);
    expect(lines).toEqual(["[private-files] a file row has no object in the bucket"]);
  });

  test("a HEAD is not an open: 405, no audit row, the bucket is not read", async () => {
    const { application, files } = await submitted();
    const get = vi.spyOn(env.PRIVATE_FILES, "get");
    expect((await open(application.id, files[0]!.id, await editor(), { method: "HEAD" })).status).toBe(405);
    expect(await auditRows()).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  test("120 opens a minute per admin, by the admin's id; a refused one is not audited; a viewer's refusal does not use the allowance", async () => {
    const { application, files } = await submitted();
    const cookie = await editor();
    const other = await editor();
    const refused = await viewer();
    for (let i = 0; i < 5; i++) await open(application.id, files[0]!.id, refused);
    for (let i = 0; i < 120; i++) expect((await open(application.id, files[0]!.id, cookie)).status, `open ${i + 1}`).toBe(200);
    const limited = await open(application.id, files[0]!.id, cookie);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect((await auditRows()).length).toBe(120);
    expect((await open(application.id, files[0]!.id, other)).status).toBe(200);
    limiterClock.advance(60_000);
    expect((await open(application.id, files[0]!.id, cookie)).status).toBe(200);
  }, 60_000);

  test("without the bucket binding: 503 storage_unavailable, no audit row", async () => {
    const { application, files } = await submitted();
    const res = await call(`${ADMIN_APPLICATIONS}/${application.id}/files/${files[0]!.id}`, { cookie: await editor(), env: { PRIVATE_FILES: undefined } });
    expect(res.status).toBe(503);
    expect(await auditRows()).toEqual([]);
  });

  test("a file the student uploaded through the portal opens for the admin once the application is submitted, and not before", async () => {
    const batch = await openBatch();
    const s = await student();
    const done = await upload(s, "family-card", bytes.png(900));
    const cookie = await superAdmin();
    // Still a draft: the admin has no application to open it from.
    expect((await open(done.draft.id, done.file.id, cookie)).status).toBe(404);
    // The submit: the draft goes, an application with the same id comes, the file is the same.
    await env.DB.prepare("DELETE FROM application_drafts WHERE id = ?").bind(done.draft.id).run();
    await addApplication(batch.id, { id: done.draft.id, userId: s.id, email: s.email, formData: V3 as never });
    const res = await open(done.draft.id, done.file.id, cookie);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes.png(900));
    expect((await readOwnFile(done.file.id, s.cookie)).status).toBe(200);
  });
});

describe("the manual purge (12.3)", () => {
  for (const { label, role, areas, write } of MATRIX) {
    test(`${label}: ${write ? "200" : "403, nothing deleted, no audit row"}`, async () => {
      const cookie = await signedInCookie(uniqueEmail(role), role, areas);
      const { application } = await submitted(["family-card", "self-photo"]);
      const res = await purge(application.id, cookie);
      expect(res.status).toBe(write ? 200 : 403);
      expect(await privateKeys()).toHaveLength(write ? 0 : 2);
      expect((await auditRows()).map((row) => row.action)).toEqual(write ? ["application_file.purge"] : []);
    });
  }

  test("nobody: 401", async () => {
    const { application } = await submitted();
    expect((await purge(application.id)).status).toBe(401);
    expect(await privateKeys()).toHaveLength(1);
  });

  test("without a confirmation nothing is deleted: not JSON 415, not an object or not `confirm: true` 400", async () => {
    const { application } = await submitted();
    const cookie = await editor();
    const plain = await call(`${ADMIN_APPLICATIONS}/${application.id}/files/purge`, { method: "POST", cookie });
    expect(plain.status).toBe(415);
    for (const body of [{}, { confirm: false }, { confirm: "true" }, { confirm: 1 }, [], null, "yes"]) {
      const res = await purge(application.id, cookie, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(await privateKeys()).toHaveLength(1);
    expect(await auditRows()).toEqual([]);
  });

  test("every file of the application goes (objects, rows, the counter), one audit row with the count and the ids, and nobody else's file is touched", async () => {
    const { application, batch, files } = await submitted(["family-card", "self-photo", "house-photos"]);
    const keep = await submitted(["family-card"]);
    // A file already marked deleted (a failed delete of an earlier day) is finished by the purge too.
    const marked = await seedFile({ applicationId: application.id, year: batch.year, slot: "debt-proof", size: 300, deleted: Date.now() - 1000 });
    const before = await storage();
    const email = uniqueEmail("editor.purge");
    const cookie = await signedInCookie(email, "editor", ["pendaftaran"]);

    const res = await purge(application.id, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ purged: 3, pending: 0 });
    expect(await privateKeys()).toEqual([keep.files[0]!.key]);
    expect((await fileRows()).map((row) => row.id)).toEqual([keep.files[0]!.id]);
    expect(await storage()).toEqual({ bytes: before.bytes - 4 * 300, files: before.files - 4 });
    expect(marked.id).toBeTruthy();

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_email: email.toLowerCase(), action: "application_file.purge", resource_type: "application", resource_id: application.id });
    const metadata = JSON.parse(rows[0]!.metadata!) as { count: number; fileIds: string[] };
    expect(Object.keys(metadata).sort()).toEqual(["count", "fileIds"]);
    expect(metadata.count).toBe(3);
    expect([...metadata.fileIds].sort()).toEqual(files.map((file) => file.id).sort());
    expect(rows[0]!.metadata).not.toMatch(/family-card|self-photo|slot|\.png|@/);

    // The detail now lists nothing; a second purge finds nothing and writes nothing.
    const after = ((await (await detail(application.id, cookie)).json()) as { item: { files: unknown[] } }).item;
    expect(after.files).toEqual([]);
    const again = await purge(application.id, cookie);
    expect(await again.json()).toEqual({ purged: 0, pending: 0 });
    expect(await auditRows()).toHaveLength(1);
  });

  test("the student no longer reads a purged file", async () => {
    const batch = await openBatch();
    const s = await student();
    const done = await upload(s, "family-card");
    await env.DB.prepare("DELETE FROM application_drafts WHERE id = ?").bind(done.draft.id).run();
    await addApplication(batch.id, { id: done.draft.id, userId: s.id, email: s.email, formData: V3 as never });
    expect((await readOwnFile(done.file.id, s.cookie)).status).toBe(200);
    expect((await purge(done.draft.id, await superAdmin())).status).toBe(200);
    expect((await readOwnFile(done.file.id, s.cookie)).status).toBe(404);
  });

  test("an application that does not exist, a draft's id and a malformed id: 404, and nothing happens", async () => {
    const batch = await addBatch();
    const s = await student();
    const draft = await addDraft(s.id, batch.id);
    const theirs = await seedFile({ applicationId: draft, year: batch.year });
    const cookie = await editor();
    for (const id of [crypto.randomUUID(), draft, "x", "../../x"]) expect((await purge(id, cookie)).status, id).toBe(404);
    expect(await privateKeys()).toEqual([theirs.key]);
    expect(await auditRows()).toEqual([]);
  });

  test("when R2 cannot delete: the rows are marked and invisible, the audit row is written, pending says how many, and the cleanup finishes", async () => {
    const { application } = await submitted(["family-card", "self-photo"]);
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
    const flaky = new Proxy(env.PRIVATE_FILES, {
      get(target, property) {
        if (property === "delete") return () => Promise.reject(new Error("r2 is down"));
        const value = Reflect.get(target, property) as unknown;
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    const cookie = await editor();
    const res = await call(`${ADMIN_APPLICATIONS}/${application.id}/files/purge`, { method: "POST", cookie, json: { confirm: true }, env: { PRIVATE_FILES: flaky } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ purged: 2, pending: 2 });
    expect((await auditRows()).map((row) => row.action)).toEqual(["application_file.purge"]);
    expect((await detail(application.id, cookie).then((r) => r.json())) as { item: { files: unknown[] } }).toMatchObject({ item: { files: [] } });
    expect(await privateKeys()).toHaveLength(2);
    expect(await storage()).toEqual({ bytes: 600, files: 2 });
    expect(lines).toEqual(["[private-files] the objects of removed files could not be deleted; they stay marked for the daily cleanup"]);

    const { runFilesHousekeeping } = await import("../src/private-files/housekeeping");
    expect(await runFilesHousekeeping(env, Date.now() + 2 * 3600_000)).toEqual({ removed: 2, pending: 0 });
    expect(await privateKeys()).toEqual([]);
    expect(await storage()).toEqual({ bytes: 0, files: 0 });
  });

  test("the audit row and the marking are ONE transaction: when the row cannot be written, no file is touched", async () => {
    const { application } = await submitted(["family-card"]);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await env.DB.exec("CREATE TRIGGER fail_purge_audit BEFORE INSERT ON audit_log WHEN NEW.action = 'application_file.purge' BEGIN SELECT RAISE(ABORT, 'no'); END");
    try {
      expect((await purge(application.id, await editor())).status).toBe(500);
    } finally {
      await env.DB.exec("DROP TRIGGER fail_purge_audit");
    }
    expect(await privateKeys()).toHaveLength(1);
    expect((await fileRows())[0]!.deleted_at).toBeNull();
    expect(await storage()).toEqual({ bytes: 300, files: 1 });
  });

  test("20 purges a minute per admin, under a counter of its own (opening files is not limited by it)", async () => {
    const cookie = await editor();
    const { application, files } = await submitted();
    for (let i = 0; i < 20; i++) expect((await purge(crypto.randomUUID(), cookie)).status).toBe(404);
    const limited = await purge(application.id, cookie);
    expect(limited.status).toBe(429);
    expect(await privateKeys()).toHaveLength(1);
    expect((await open(application.id, files[0]!.id, cookie)).status).toBe(200);
  });

  test("a purge needs the Pendaftaran WRITE right, like an open: a viewer with a stray grant row is refused", async () => {
    const { application } = await submitted();
    const email = uniqueEmail("viewer");
    const cookie = await signedInCookie(email, "viewer", ["pendaftaran"]);
    expect((await purge(application.id, cookie)).status).toBe(403);
  });
});
