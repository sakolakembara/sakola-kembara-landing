import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Bindings } from "../src/env";
import worker from "../src/worker";
import { call, signedInCookie, uniqueEmail } from "./helpers";
import { addApplication } from "./pendaftaran-helpers";
import {
  ADMIN_APPLICATIONS,
  addDraft,
  bytes,
  deleteFile,
  emptyBucketBeforeEach,
  fileRows,
  openBatch,
  privateKeys,
  putFile,
  readOwnFile,
  seedFile,
  streamOf,
  student,
  upload,
} from "./private-files-helpers";
import { disguises } from "./uploads-helpers";

// PRIVACY is the hard requirement of the private files (SAKEM-083): applicants are mostly minors and the files are scans
// of identity documents. This reads EVERY console line of a run that uses every route, the happy paths and the
// failures that do log, and proves that no line carries an address, a name, an id, a key, a cookie or a byte of a file:
// the only lines are fixed sentences and counts. It also proves that no route calls out to anything (no public URL is
// built, no presigned link is asked for) and that no answer of the student's API ever carries an object key.

emptyBucketBeforeEach();

afterEach(() => {
  vi.restoreAllMocks();
});

/** The lines this code may write: fixed sentences, and counts. Nothing else is allowed to appear. */
const ALLOWED: RegExp[] = [
  /^\[private-files\] the objects of removed files could not be deleted; they stay marked for the daily cleanup$/,
  /^\[private-files\] the rows of removed files could not be deleted; they stay marked for the daily cleanup$/,
  /^\[private-files\] a file row has no object in the bucket$/,
  /^\[private-files\] the audit row of a file open could not be written; the file was not served$/,
  /^\[private-files\] could not remove the object of a refused upload$/,
  /^\[private-files\] could not give a storage reservation back$/,
  /^\[cron\] cleanup: sessions=\d+ verifications=\d+ audit=\d+ retention=(\d+|off)$/,
  /^\[cron\] private files: removed=\d+ pending=\d+$/,
  // The Worker's own last resort: the MESSAGE of an error (never the request).
  /^\[portal\] unhandled error: (the private bucket refused an object|D1_ERROR: [^\n]*)$/,
  /^\[worker\] unhandled error: (D1_ERROR: [^\n]*)$/,
];

function flakyDeletes(): R2Bucket {
  return new Proxy(env.PRIVATE_FILES, {
    get(target, property) {
      if (property === "delete") return () => Promise.reject(new Error("r2 is down"));
      const value = Reflect.get(target, property) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

describe("a full run of every route", () => {
  test("every console line is a fixed sentence or a count; nothing identifies a child, a file or a key; nothing calls out", async () => {
    const lines: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
    const outbound = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      throw new Error(`unexpected outbound request: ${typeof input === "string" ? input : input instanceof URL ? input.href : input.url}`);
    });

    const batch = await openBatch();
    const s = await student("anak.rahasia");
    const other = await student("anak.lain");
    const admin = await signedInCookie(uniqueEmail("admin.rahasia"), "editor", ["pendaftaran"]);

    // ── the student: upload (every accepted type), replace, refusals of every kind, read, delete
    const family = await upload(s, "family-card", bytes.png(900));
    const pdf = await upload(s, "electricity-bill", bytes.pdf(1200));
    const jpeg = await upload(s, "self-photo", bytes.jpeg(800));
    await upload(s, "house-photos", bytes.webp(700));
    const swapped = await upload(s, "self-photo", bytes.png(600), { replace: jpeg.file.id });
    for (const attempt of [
      putFile("family-card", disguises.exe, { cookie: s.cookie, headers: { "x-file-name": "Kartu Keluarga Rahasia.pdf" } }),
      putFile("family-card", streamOf([bytes.png(100)]), { cookie: s.cookie, contentLength: 9000 }),
      putFile("nope", bytes.png(100), { cookie: s.cookie }),
      putFile("self-photo", bytes.png(100), { cookie: s.cookie }), // slot_full
      putFile("family-card", bytes.png(100), { cookie: s.cookie, replace: crypto.randomUUID() }),
      putFile("family-card", bytes.png(100)), // nobody
      putFile("family-card", bytes.png(100), { cookie: s.cookie, env: { PRIVATE_FILES_BUDGET_BYTES: "10" } }),
    ])
      await attempt;
    for (const id of [family.file.id, pdf.file.id, swapped.file.id]) expect((await readOwnFile(id, s.cookie)).status).toBe(200);
    expect((await readOwnFile(family.file.id, other.cookie)).status).toBe(404);
    expect((await deleteFile(family.file.id, other.cookie)).status).toBe(404);
    expect((await deleteFile(pdf.file.id, s.cookie)).status).toBe(204);

    // ── the failures that DO log, each with a fixed sentence: R2 cannot delete, an object is missing
    expect((await deleteFile(swapped.file.id, s.cookie, { env: { PRIVATE_FILES: flakyDeletes() } })).status).toBe(204);
    const missing = await upload(s, "vehicle-photos", bytes.png(300));
    await env.PRIVATE_FILES.delete((await privateKeys()).find((key) => key.includes(missing.file.id))!);
    expect((await readOwnFile(missing.file.id, s.cookie)).status).toBe(404);

    // ── the submit, and the admin: the list, opens (and the ones that are refused), a failing audit write, the purge
    await env.DB.prepare("DELETE FROM application_drafts WHERE id = ?").bind(family.draft.id).run();
    const application = await addApplication(batch.id, { id: family.draft.id, userId: s.id, email: s.email, formData: { formVersion: 3 } as never });
    const stored = (await fileRows()).filter((row) => row.deleted_at === null);
    expect((await call(`${ADMIN_APPLICATIONS}/${application.id}`, { cookie: admin })).status).toBe(200);
    for (const row of stored) expect((await call(`${ADMIN_APPLICATIONS}/${application.id}/files/${row.id}`, { cookie: admin })).status).toBeLessThan(500);
    expect((await call(`${ADMIN_APPLICATIONS}/${application.id}/files/${crypto.randomUUID()}`, { cookie: admin })).status).toBe(404);
    await env.DB.exec("CREATE TRIGGER fail_view BEFORE INSERT ON audit_log WHEN NEW.action = 'application_file.view' BEGIN SELECT RAISE(ABORT, 'no'); END");
    try {
      expect((await call(`${ADMIN_APPLICATIONS}/${application.id}/files/${stored[0]!.id}`, { cookie: admin })).status).toBe(503);
    } finally {
      await env.DB.exec("DROP TRIGGER fail_view");
    }
    const purged = await call(`${ADMIN_APPLICATIONS}/${application.id}/files/purge`, { method: "POST", cookie: admin, json: { confirm: true }, env: { PRIVATE_FILES: flakyDeletes() } });
    expect(purged.status).toBe(200);

    // ── a refused write that fails inside D1, and the daily chores
    await seedFile({ applicationId: await addDraft(other.id, batch.id), year: batch.year });
    await env.DB.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON application_files BEGIN SELECT RAISE(ABORT, 'no'); END");
    try {
      expect((await putFile("family-card", bytes.png(100), { cookie: other.cookie })).status).toBe(500);
    } finally {
      await env.DB.exec("DROP TRIGGER fail_insert");
    }
    const ctx = createExecutionContext();
    await worker.scheduled!(createScheduledController({ scheduledTime: Date.now() + 3 * 3600_000, cron: "17 3 * * *" }), env as Bindings, ctx);
    await waitOnExecutionContext(ctx);

    // ── what was logged
    expect(lines.length).toBeGreaterThan(3); // the failures above really did log something: this is not a test of silence
    for (const line of lines) expect(ALLOWED.some((pattern) => pattern.test(line)), `an unexpected console line: ${line}`).toBe(true);

    const everything = lines.join("\n");
    const markers = [
      s.email,
      s.email.split("@")[0]!,
      other.email,
      s.id,
      other.id,
      family.draft.id,
      application.id,
      family.file.id,
      pdf.file.id,
      jpeg.file.id,
      swapped.file.id,
      missing.file.id,
      batch.id,
      "applications/",
      "family-card",
      "electricity-bill",
      "self-photo",
      "house-photos",
      "Kartu Keluarga",
      "rahasia",
      "image/png",
      "application/pdf",
      "session_token",
      "cookie",
    ];
    for (const marker of markers) expect(everything, `a console line carries ${marker}`).not.toContain(marker);
    expect(outbound).not.toHaveBeenCalled();
  });
});

describe("no way to a public file", () => {
  test("no answer of the student's API carries an object key or a link of any kind", async () => {
    await openBatch();
    const s = await student();
    const done = await upload(s, "family-card", bytes.png(500));
    const bodies = [JSON.stringify(done)];
    for (const res of [await putFile("family-card", disguises.exe, { cookie: s.cookie }), await readOwnFile(crypto.randomUUID(), s.cookie), await deleteFile(crypto.randomUUID(), s.cookie)]) bodies.push(await res.text());
    for (const body of bodies) {
      expect(body).not.toMatch(/applications\/\d{4}|\.png|\.pdf|https?:|r2\.dev|signed|presign|checksum|PRIVATE/i);
    }
  });

  test("the development route of the public uploads never serves an applicant's file, even in development and even for a key that looks public", async () => {
    await openBatch();
    const s = await student();
    const done = await upload(s, "family-card", bytes.png(500));
    const [key] = await privateKeys();
    // The same bytes under a key shaped like a public upload, in the PRIVATE bucket.
    const lookalike = `uploads/team-photo/2026/${crypto.randomUUID()}-foto.png`;
    await env.PRIVATE_FILES.put(lookalike, bytes.png(500));
    for (const path of [`/${key}`, `/uploads/${key}`, `/${lookalike}`, `/uploads/${done.file.id}.png`]) {
      const res = await call(path, { env: { ENVIRONMENT: "development" } });
      expect(res.status, path).toBe(404);
    }
  });
});
