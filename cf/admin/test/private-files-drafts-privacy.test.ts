import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Bindings } from "../src/env";
import worker from "../src/worker";
import { signedInCookie, uniqueEmail } from "./helpers";
import { addApplication, addBatch } from "./pendaftaran-helpers";
import { captureConsole } from "./portal-applications-helpers";
import { auditRows, emptyBucketBeforeEach, seedFile } from "./private-files-helpers";
import { bareStudent, draftWithFiles, flakyDeletes, listDrafts, purgeDraft, STUDENT, viewer } from "./private-files-drafts-helpers";

// PRIVACY of the draft purge (SAKEM-093). A draft holds a child's half-filled answers and scans of identity documents, and the
// admin who purges it is deliberately NOT told whose it is. This reads EVERY console line of a run that uses both routes,
// the refusals and the failures that do log, and proves that no line carries a name, an address, an answer, an id, a key or a
// slot: the only lines are the fixed sentences the file routes already had. It also proves the audit row and every answer of
// the two routes hold none of it, and that nothing calls out.

emptyBucketBeforeEach();

afterEach(() => {
  vi.restoreAllMocks();
});

/** The lines this code may write: the fixed sentences of the private files, and the Worker's own last resort (the MESSAGE of an error). */
const ALLOWED: RegExp[] = [
  /^\[private-files\] the objects of removed files could not be deleted; they stay marked for the daily cleanup$/,
  /^\[private-files\] the rows of removed files could not be deleted; they stay marked for the daily cleanup$/,
  /^\[cron\] cleanup: sessions=\d+ verifications=\d+ audit=\d+ retention=(\d+|off)$/,
  /^\[cron\] private files: removed=\d+ pending=\d+$/,
  /^\[worker\] unhandled error: (D1_ERROR: [^\n]*)$/,
];

describe("a full run of both routes", () => {
  test("every console line is a fixed sentence or a count; nothing names a child, a draft, a file or a key; no answer or audit row holds them; nothing calls out", async () => {
    const console_ = captureConsole();
    const outbound = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      throw new Error(`unexpected outbound request: ${typeof input === "string" ? input : input instanceof URL ? input.href : input.url}`);
    });

    const owner = await bareStudent({ name: STUDENT.name, email: STUDENT.email });
    const formData = { identity: { fullName: STUDENT.fullName, homeAddress: STUDENT.answer }, interview: { motivationSakem: STUDENT.answer } };
    const old = await draftWithFiles({ student: owner, slots: ["family-card", "self-photo", "house-photos"], formData });
    const young = await draftWithFiles({ ageDays: 3, slots: ["family-card"] });
    const down = await draftWithFiles({ slots: ["electricity-bill", "debt-proof"] });
    const failing = await draftWithFiles({ slots: ["parent-permission"] });
    const submittedBatch = await addBatch();
    const application = await addApplication(submittedBatch.id);
    const theirs = await seedFile({ applicationId: application.id, year: submittedBatch.year, slot: "dtks" });
    const cookie = await signedInCookie(uniqueEmail("admin.rahasia"), "editor", ["pendaftaran"]);

    const answers: string[] = [];
    const keep = async (res: Response) => {
      answers.push(await res.text());
      return res;
    };

    // The list, for the one who may and for the one who may not; the purge and its refusals.
    expect((await keep(await listDrafts(cookie))).status).toBe(200);
    expect((await keep(await listDrafts(await viewer()))).status).toBe(403);
    expect((await keep(await listDrafts())).status).toBe(401);
    expect((await keep(await purgeDraft(young.id, cookie))).status).toBe(409);
    expect((await keep(await purgeDraft(application.id, cookie))).status).toBe(404);
    expect((await keep(await purgeDraft(crypto.randomUUID(), cookie))).status).toBe(404);
    expect((await keep(await purgeDraft(old.id, cookie, {}))).status).toBe(400);
    expect((await keep(await purgeDraft(old.id, cookie))).status).toBe(200);
    expect((await keep(await purgeDraft(old.id, cookie))).status).toBe(200); // a second one finds nothing
    // The failures that DO log, each with a fixed sentence: R2 cannot delete, the audit row cannot be written.
    expect((await keep(await purgeDraft(down.id, cookie, { confirm: true }, { env: { PRIVATE_FILES: flakyDeletes() } }))).status).toBe(200);
    await env.DB.exec("CREATE TRIGGER fail_draft_audit BEFORE INSERT ON audit_log WHEN NEW.action = 'application_file.purge' BEGIN SELECT RAISE(ABORT, 'no'); END");
    try {
      expect((await keep(await purgeDraft(failing.id, cookie))).status).toBe(500);
    } finally {
      await env.DB.exec("DROP TRIGGER fail_draft_audit");
    }
    // The daily chores finish what the bucket refused.
    const ctx = createExecutionContext();
    await worker.scheduled!(createScheduledController({ scheduledTime: Date.now() + 3 * 3600_000, cron: "17 3 * * *" }), env as Bindings, ctx);
    await waitOnExecutionContext(ctx);
    const lines = console_.lines;
    console_.restore();

    // What was logged: the failures above really did log something, so this is not a test of silence.
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) expect(ALLOWED.some((pattern) => pattern.test(line)), `an unexpected console line: ${line}`).toBe(true);

    const rows = await auditRows();
    expect(rows.map((row) => [row.action, row.resource_type])).toEqual([
      ["application_file.purge", "application_draft"],
      ["application_file.purge", "application_draft"],
    ]);
    const markers = [
      STUDENT.name,
      STUDENT.localPart,
      STUDENT.email,
      STUDENT.answer,
      STUDENT.fullName,
      owner.id,
      old.userId,
      young.id,
      down.id,
      failing.id,
      application.id,
      theirs.id,
      old.batch.id,
      ...old.files.map((file) => file.id),
      ...down.files.map((file) => file.id),
      "applications/",
      "family-card",
      "self-photo",
      "house-photos",
      "electricity-bill",
      "debt-proof",
      "image/png",
      "application/pdf",
      "session_token",
      "cookie",
    ];
    const everything = lines.join("\n");
    for (const marker of markers) expect(everything, `a console line carries ${marker}`).not.toContain(marker);

    // The answers say only what the contract says: ids of the draft asked about, counts, a code. Not who, not what.
    for (const text of answers) {
      for (const marker of [STUDENT.name, STUDENT.localPart, STUDENT.email, STUDENT.answer, STUDENT.fullName, owner.id, "family-card", "self-photo", "image/png", "applications/", ...old.files.map((file) => file.id)]) {
        expect(text, `an answer carries ${marker}`).not.toContain(marker);
      }
    }
    // The audit rows of the two purges: the draft and the file ids, a count; never a name, a slot or a size.
    for (const row of rows) {
      for (const marker of [STUDENT.name, STUDENT.localPart, STUDENT.fullName, STUDENT.answer, "family-card", "self-photo", "slot", "size", "image/", ".png", "applications/"]) {
        expect(`${row.metadata} ${row.resource_id}`, `an audit row carries ${marker}`).not.toContain(marker);
      }
    }
    expect(outbound).not.toHaveBeenCalled();
  });
});
