import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DRAFT_PURGE_MIN_INACTIVE_DAYS, DRAFT_PURGE_MIN_INACTIVE_MS, draftPurgeCutoff, DRAFT_SQL, isDraftPurgeable, purgeableFrom } from "../src/private-files/drafts";
import { runFilesHousekeeping } from "../src/private-files/housekeeping";
import { call, signedInCookie, uniqueEmail } from "./helpers";
import { limiterClock, withFrozenDate } from "./limiter-clock";
import { addApplication, addBatch, MATRIX } from "./pendaftaran-helpers";
import { countRows, draftOf, putStep, racing, readyToSubmit, submit } from "./portal-applications-helpers";
import {
  ADMIN_APPLICATIONS,
  auditRows,
  bytes,
  deleteFile,
  emptyBucketBeforeEach,
  fileRows,
  openBatch,
  privateKeys,
  readOwnFile,
  seedFile,
  storage,
  student,
  upload,
} from "./private-files-helpers";
import {
  bareStudent,
  countingDb,
  DAY,
  draftWithFiles,
  editor,
  flakyDeletes,
  formDataOf,
  listDrafts,
  purgeDraft,
  setUpdatedAt,
  STUDENT,
  superAdmin,
  THIRTY_DAYS,
  updatedAtOf,
  viewer,
} from "./private-files-drafts-helpers";

// The manual purge of the files of a draft that was never submitted (SAKEM-093, decided by Dzul on 2026-10-15), and the
// list that finds them: docs/cloudflare/portal-api.md, 12.4. The rule that matters most: a draft may be purged only if it was
// last changed at least 30 days ago, so nobody's ACTIVE draft loses its files to an admin who cannot tell whose it is.
// Negative checks: scripts/negative-checks-portal-drafts.mjs. Cost and plans: test/private-files-drafts-plans.test.ts.
// Every console line of a full run: test/private-files-drafts-privacy.test.ts.

emptyBucketBeforeEach();

afterEach(() => {
  vi.restoreAllMocks();
});

interface Listed {
  id: string;
  batch: { id: string; year: number; name: string };
  files: number;
  bytes: number;
  updatedAt: string;
  purgeable: boolean;
  purgeableAt: string;
}
interface Page {
  items: Listed[];
  page: number;
  pageSize: number;
  total: number;
}

const page = async (res: Response) => (await res.json()) as Page;

describe("the rule: 30 days without a change", () => {
  test("the number is thirty, in one place, and the boundary is inclusive to the millisecond", () => {
    expect(DRAFT_PURGE_MIN_INACTIVE_DAYS).toBe(30);
    expect(DRAFT_PURGE_MIN_INACTIVE_MS).toBe(30 * 24 * 60 * 60 * 1000);
    const now = Date.UTC(2030, 5, 15, 12, 0, 0);
    expect(draftPurgeCutoff(now)).toBe(now - THIRTY_DAYS);
    expect(isDraftPurgeable(now - THIRTY_DAYS, now)).toBe(true); // exactly 30 days: allowed
    expect(isDraftPurgeable(now - THIRTY_DAYS - 1, now)).toBe(true);
    expect(isDraftPurgeable(now - THIRTY_DAYS + 1, now)).toBe(false); // 30 days less one millisecond: not yet
    expect(isDraftPurgeable(now - 29 * DAY, now)).toBe(false);
    expect(isDraftPurgeable(now, now)).toBe(false);
    expect(isDraftPurgeable(now + DAY, now)).toBe(false); // a clock that went backwards never makes a draft purgeable
    expect(purgeableFrom(now).getTime()).toBe(now + THIRTY_DAYS);
  });
});

describe("the list of drafts that hold files (GET /api/admin/applications/drafts/files)", () => {
  for (const { label, role, areas, write } of MATRIX) {
    test(`${label}: ${write ? "200" : "403, and nothing of the drafts is said"}`, async () => {
      const cookie = await signedInCookie(uniqueEmail(role), role, areas);
      await draftWithFiles();
      const res = await listDrafts(cookie);
      expect(res.status).toBe(write ? 200 : 403);
      if (write) expect((await page(res)).total).toBe(1);
      else expect(await res.json()).toEqual({ error: "forbidden" });
    });
  }

  test("nobody: 401 and not a single D1 statement; a student's portal cookie is no session on the admin: 401", async () => {
    await draftWithFiles();
    const counted = countingDb();
    const res = await listDrafts(undefined, "", { env: { DB: counted.db } });
    expect(res.status).toBe(401);
    expect(counted.used()).toBe(0);
    const s = await student();
    expect((await listDrafts(s.cookie)).status).toBe(401);
    // A student account with an admin-audience cookie is a 403, as for every admin route.
    expect((await listDrafts(await signedInCookie(uniqueEmail("siswa")))).status).toBe(403);
  });

  test("a draft with live files is a row: its id, its batch, how many files and how many bytes, when it last changed", async () => {
    const batch = await addBatch({ name: "Gen 9 - Contoh" });
    const updatedAt = Date.now() - 40 * DAY;
    const draft = await draftWithFiles({ batch, slots: ["family-card", "self-photo", "electricity-bill"], size: 300, updatedAt });
    const res = await listDrafts(await editor());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await page(res);
    expect(body).toEqual({
      items: [
        {
          id: draft.id,
          batch: { id: batch.id, year: batch.year, name: "Gen 9 - Contoh" },
          files: 3,
          bytes: 900,
          updatedAt: new Date(updatedAt).toISOString(),
          purgeable: true,
          purgeableAt: new Date(updatedAt + THIRTY_DAYS).toISOString(),
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
  });

  test("only a draft with a LIVE file is listed: not one with no file, not one whose files were all removed, not a submitted application's files", async () => {
    const withFiles = await draftWithFiles({ slots: ["family-card", "self-photo"] });
    const batch = await addBatch();
    const empty = await bareStudent();
    await env.DB.prepare("INSERT INTO application_drafts (id, user_id, batch_id) VALUES (?, ?, ?)").bind(crypto.randomUUID(), empty.id, batch.id).run();
    const removed = await draftWithFiles({ slots: ["family-card"] });
    await env.DB.prepare("UPDATE application_files SET deleted_at = ? WHERE application_id = ?").bind(Date.now(), removed.id).run();
    // A submitted application with files: the draft is gone, the files stay with the application's id.
    const submittedBatch = await addBatch();
    const application = await addApplication(submittedBatch.id);
    await seedFile({ applicationId: application.id, year: submittedBatch.year });
    // The same id as a draft AND an application (never made by the code): not offered, because the purge would refuse it.
    const both = await draftWithFiles({ slots: ["family-card"] });
    await addApplication(both.batch.id, { id: both.id, userId: both.userId });
    // One live and one marked file in the same draft: only the live one counts.
    const mixed = await draftWithFiles({ slots: ["family-card"], size: 400 });
    await seedFile({ applicationId: mixed.id, year: mixed.batch.year, slot: "self-photo", size: 700, deleted: true });

    const body = await page(await listDrafts(await editor()));
    expect(body.items.map((item) => item.id).sort()).toEqual([withFiles.id, mixed.id].sort());
    expect(body.total).toBe(2);
    expect(body.items.find((item) => item.id === withFiles.id)).toMatchObject({ files: 2, bytes: 600 });
    expect(body.items.find((item) => item.id === mixed.id)).toMatchObject({ files: 1, bytes: 400 });
  });

  test("oldest change first (so the drafts that may be purged come first), and what is still active says from when it may be purged", async () => {
    const now = Date.now();
    const newest = await draftWithFiles({ ageDays: 2 });
    const oldest = await draftWithFiles({ ageDays: 90 });
    const middle = await draftWithFiles({ ageDays: 31 });
    const recent = await draftWithFiles({ ageDays: 29 });
    const body = await page(await listDrafts(await editor()));
    expect(body.items.map((item) => item.id)).toEqual([oldest.id, middle.id, recent.id, newest.id]);
    expect(body.items.map((item) => item.purgeable)).toEqual([true, true, false, false]);
    const last = body.items[3]!;
    expect(Date.parse(last.purgeableAt)).toBeGreaterThan(now + 27 * DAY);
    expect(Date.parse(last.purgeableAt)).toBe(Date.parse(last.updatedAt) + THIRTY_DAYS);
  });

  test("`purgeable` follows the server's clock to the millisecond, and the list never disagrees with the purge", async () => {
    await withFrozenDate(async (clock) => {
      const now = clock.now;
      const cookie = await editor();
      const exactly = await draftWithFiles({ updatedAt: now - THIRTY_DAYS });
      const justYounger = await draftWithFiles({ updatedAt: now - THIRTY_DAYS + 1 });
      const justOlder = await draftWithFiles({ updatedAt: now - THIRTY_DAYS - 1 });
      const body = await page(await listDrafts(cookie));
      const flag = (id: string) => body.items.find((item) => item.id === id)!.purgeable;
      expect([flag(exactly.id), flag(justYounger.id), flag(justOlder.id)]).toEqual([true, false, true]);
      for (const draft of [exactly, justYounger, justOlder]) {
        const res = await purgeDraft(draft.id, cookie);
        expect(res.status, draft.id).toBe(flag(draft.id) ? 200 : 409);
      }
    });
  });

  test("an explicit field list: the id, the batch, the counts, two instants and a flag; no name, address, answer, slot, type, file id or key", async () => {
    const owner = await bareStudent({ name: STUDENT.name, email: STUDENT.email });
    const draft = await draftWithFiles({
      student: owner,
      slots: ["family-card", "self-photo"],
      formData: { identity: { fullName: STUDENT.fullName, homeAddress: STUDENT.answer }, interview: { motivationSakem: STUDENT.answer } },
    });
    const res = await listDrafts(await editor());
    const text = await res.text();
    const body = JSON.parse(text) as Page;
    expect(Object.keys(body).sort()).toEqual(["items", "page", "pageSize", "total"]);
    expect(Object.keys(body.items[0]!).sort()).toEqual(["batch", "bytes", "files", "id", "purgeable", "purgeableAt", "updatedAt"]);
    expect(Object.keys(body.items[0]!.batch).sort()).toEqual(["id", "name", "year"]);
    for (const secret of [STUDENT.name, STUDENT.localPart, STUDENT.email, STUDENT.answer, STUDENT.fullName, owner.id, ...draft.files.map((file) => file.id), "family-card", "self-photo", "image/png", "applications/", "@"]) {
      expect(text, `the list carries ${secret}`).not.toContain(secret);
    }
  });

  test("pages: 20 by default, never more than 50 whatever is asked, no overlap, every draft once, and the total", async () => {
    for (let i = 0; i < 53; i++) await draftWithFiles({ ageDays: 40 + i, slots: ["self-photo"], size: 100 });
    const cookie = await editor();
    const first = await page(await listDrafts(cookie));
    expect([first.page, first.pageSize, first.total, first.items.length]).toEqual([1, 20, 53, 20]);
    const big = await page(await listDrafts(cookie, "?pageSize=1000"));
    expect([big.pageSize, big.items.length]).toEqual([50, 50]);
    const seen = new Set<string>();
    for (let n = 1; n <= 3; n++) for (const item of (await page(await listDrafts(cookie, `?page=${n}&pageSize=20`))).items) seen.add(item.id);
    expect(seen.size).toBe(53);
    const beyond = await page(await listDrafts(cookie, "?page=9&pageSize=20"));
    expect(beyond.items).toEqual([]);
    expect(beyond.total).toBe(53);
    // Junk in the query is clamped, never an error.
    const junk = await listDrafts(cookie, "?page=abc&pageSize=-5&sort=x&q=y");
    expect(junk.status).toBe(200);
    expect(await page(junk)).toMatchObject({ page: 1, pageSize: 20 });
  }, 60_000);

  test("it is the drafts' own route: an application's id still goes to its own page, `drafts` is not an application id", async () => {
    const cookie = await editor();
    const batch = await addBatch();
    const application = await addApplication(batch.id);
    expect((await call(`${ADMIN_APPLICATIONS}/${application.id}`, { cookie })).status).toBe(200);
    expect((await call(`${ADMIN_APPLICATIONS}/drafts`, { cookie })).status).toBe(404);
    expect((await listDrafts(cookie)).status).toBe(200);
  });
});

describe("the purge (POST /api/admin/applications/drafts/:id/files/purge)", () => {
  for (const { label, role, areas, write } of MATRIX) {
    test(`${label}: ${write ? "200" : "403, nothing deleted, no audit row, the draft untouched"}`, async () => {
      const cookie = await signedInCookie(uniqueEmail(role), role, areas);
      const draft = await draftWithFiles({ slots: ["family-card", "self-photo"] });
      const before = await updatedAtOf(draft.id);
      const res = await purgeDraft(draft.id, cookie);
      expect(res.status).toBe(write ? 200 : 403);
      expect(await privateKeys()).toHaveLength(write ? 0 : 2);
      expect((await auditRows()).map((row) => row.action)).toEqual(write ? ["application_file.purge"] : []);
      if (!write) {
        expect(await res.json()).toEqual({ error: "forbidden" });
        expect(await updatedAtOf(draft.id)).toBe(before);
      }
    });
  }

  test("nobody: 401 and not a single D1 statement, nothing deleted", async () => {
    const draft = await draftWithFiles();
    const counted = countingDb();
    const res = await purgeDraft(draft.id, undefined, { confirm: true }, { env: { DB: counted.db } });
    expect(res.status).toBe(401);
    expect(counted.used()).toBe(0);
    expect(await privateKeys()).toHaveLength(1);
    const s = await student();
    expect((await purgeDraft(draft.id, s.cookie)).status).toBe(401);
    expect(await privateKeys()).toHaveLength(1);
  });

  test("a confirmation in the body or nothing happens: not JSON 415, not `confirm: true` 400, and the draft is not even looked at", async () => {
    const draft = await draftWithFiles();
    const cookie = await editor();
    const plain = await call(`${ADMIN_APPLICATIONS}/drafts/${draft.id}/files/purge`, { method: "POST", cookie });
    expect(plain.status).toBe(415);
    for (const body of [{}, { confirm: false }, { confirm: "true" }, { confirm: 1 }, [], null, "yes"]) {
      expect((await purgeDraft(draft.id, cookie, body)).status, JSON.stringify(body)).toBe(400);
    }
    // Even for an id that does not exist: the confirmation is asked first, so the answer cannot be used to probe ids.
    expect((await purgeDraft(crypto.randomUUID(), cookie, {})).status).toBe(400);
    expect(await privateKeys()).toHaveLength(1);
    expect(await auditRows()).toEqual([]);
  });

  test("every file of the draft goes (objects, rows, the counter), one audit row with the count and the ids, and nobody else's file is touched", async () => {
    const owner = await bareStudent({ name: STUDENT.name, email: STUDENT.email });
    const formData = { identity: { fullName: STUDENT.fullName }, documents: { dtksRegistered: "tidak" } };
    const draft = await draftWithFiles({ student: owner, slots: ["family-card", "self-photo", "house-photos"], formData });
    const other = await draftWithFiles({ slots: ["family-card"] });
    const submittedBatch = await addBatch();
    const application = await addApplication(submittedBatch.id);
    const theirs = await seedFile({ applicationId: application.id, year: submittedBatch.year, slot: "family-card", size: 300 });
    // A row marked earlier (a failed delete of an earlier day; its bytes left the counter when it was marked) is finished too.
    await seedFile({ applicationId: draft.id, year: draft.batch.year, slot: "debt-proof", size: 300, deleted: Date.now() - 1000 });
    const before = await storage();
    const updatedBefore = await updatedAtOf(draft.id);
    const email = uniqueEmail("editor.purge");
    const cookie = await signedInCookie(email, "editor", ["pendaftaran"]);

    const res = await purgeDraft(draft.id, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ purged: 3, pending: 0 });
    expect(await privateKeys()).toEqual([other.files[0]!.key, theirs.key].sort());
    expect((await fileRows()).map((row) => row.id).sort()).toEqual([other.files[0]!.id, theirs.id].sort());
    // The three live files' share goes; the marked one was out of the counter already, so it is not taken out twice.
    expect(await storage()).toEqual({ bytes: before.bytes - 3 * 300, files: before.files - 3 });

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_email: email.toLowerCase(), action: "application_file.purge", resource_type: "application_draft", resource_id: draft.id });
    const metadata = JSON.parse(rows[0]!.metadata!) as { count: number; fileIds: string[] };
    expect(Object.keys(metadata).sort()).toEqual(["count", "fileIds"]);
    expect(metadata.count).toBe(3);
    expect([...metadata.fileIds].sort()).toEqual(draft.files.map((file) => file.id).sort());
    for (const secret of [STUDENT.name, STUDENT.localPart, STUDENT.email, STUDENT.fullName, owner.id, "family-card", "self-photo", "house-photos", "slot", ".png", "@", "image/"]) {
      // The row names the ADMIN who did it (the actor); what it says about the draft is ids and a count, so its metadata and its resource id hold no trace of the student.
      expect(`${rows[0]!.metadata} ${rows[0]!.resource_id}`, `the audit row carries ${secret}`).not.toContain(secret);
    }

    // Only the files go: the student, the draft and what they typed are exactly as they were.
    expect(await formDataOf(draft.id)).toBe(JSON.stringify(formData));
    expect((await env.DB.prepare("SELECT name, email FROM users WHERE id = ?").bind(owner.id).first())).toEqual({ name: STUDENT.name, email: STUDENT.email });
    // The version moves by ONE millisecond: a submit that read the draft a moment ago finds it changed, and the draft does not look recently used.
    expect(await updatedAtOf(draft.id)).toBe(updatedBefore + 1);

    // The list no longer offers it; a second purge finds nothing, writes nothing, and may still be asked.
    expect((await page(await listDrafts(cookie))).items.map((item) => item.id)).toEqual([other.id]);
    const again = await purgeDraft(draft.id, cookie);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ purged: 0, pending: 0 });
    expect(await auditRows()).toHaveLength(1);
    expect(await updatedAtOf(draft.id)).toBe(updatedBefore + 1);
  });

  test("the boundary, to the millisecond: exactly 30 days is purged, 30 days less one millisecond is refused (409 draft_active) and nothing changes", async () => {
    await withFrozenDate(async (clock) => {
      const now = clock.now;
      const cookie = await editor();
      const exactly = await draftWithFiles({ updatedAt: now - THIRTY_DAYS });
      const older = await draftWithFiles({ updatedAt: now - THIRTY_DAYS - 1 });
      const younger = await draftWithFiles({ updatedAt: now - THIRTY_DAYS + 1, slots: ["family-card", "self-photo"] });
      const countersBefore = await storage();

      const refused = await purgeDraft(younger.id, cookie);
      expect(refused.status).toBe(409);
      expect(await refused.json()).toEqual({
        error: "draft_active",
        message: "Draf ini baru diubah. Berkasnya baru bisa dihapus setelah 30 hari tanpa perubahan.",
        minInactiveDays: 30,
        purgeableAt: new Date(now + 1).toISOString(),
      });
      expect(await privateKeys()).toHaveLength(4);
      expect(await auditRows()).toEqual([]);
      expect(await updatedAtOf(younger.id)).toBe(now - THIRTY_DAYS + 1);
      expect(await storage()).toEqual(countersBefore);

      expect((await purgeDraft(exactly.id, cookie)).status).toBe(200);
      expect((await purgeDraft(older.id, cookie)).status).toBe(200);
      expect(await privateKeys()).toEqual(younger.files.map((file) => file.key).sort());
      // One millisecond later the younger draft has turned 30 days old.
      clock.advance(1);
      expect((await purgeDraft(younger.id, cookie)).status).toBe(200);
      expect(await privateKeys()).toEqual([]);
    });
  });

  test("an active draft is refused whatever its age below 30 days: just changed, a day, two weeks, 29 days; a draft with no file too", async () => {
    const cookie = await editor();
    for (const ageDays of [0, 1, 14, 29]) {
      const draft = await draftWithFiles({ ageDays });
      const res = await purgeDraft(draft.id, cookie);
      expect(res.status, `${ageDays} days`).toBe(409);
      expect(((await res.json()) as { error: string }).error).toBe("draft_active");
    }
    expect(await privateKeys()).toHaveLength(4);
    expect(await auditRows()).toEqual([]);
    const batch = await addBatch();
    const noFiles = await bareStudent();
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO application_drafts (id, user_id, batch_id) VALUES (?, ?, ?)").bind(id, noFiles.id, batch.id).run();
    expect((await purgeDraft(id, cookie)).status).toBe(409);
    // An old draft with no file is not an error: there is nothing to purge, and nothing is written.
    await setUpdatedAt(id, Date.now() - 40 * DAY);
    const none = await purgeDraft(id, cookie);
    expect(none.status).toBe(200);
    expect(await none.json()).toEqual({ purged: 0, pending: 0 });
    expect(await auditRows()).toEqual([]);
  });

  test("what the student does moves the clock: a step save, an upload, a replace and a delete each make the draft active again", async () => {
    await openBatch();
    const s = await student();
    const first = await upload(s, "family-card", bytes.png(500));
    const cookie = await editor();
    const aged = () => setUpdatedAt(first.draft.id, Date.now() - 31 * DAY);
    const asked = async () => (await purgeDraft(first.draft.id, cookie)).status;

    await aged();
    expect((await listDrafts(cookie).then(page)).items[0]).toMatchObject({ id: first.draft.id, purgeable: true });
    // A step saved.
    expect((await putStep(s, "marketing", { instagramUsername: "akun.contoh" })).status).toBe(200);
    expect(await asked()).toBe(409);
    await aged();
    // An upload of a second file.
    await upload(s, "self-photo", bytes.jpeg(400));
    expect(await asked()).toBe(409);
    await aged();
    // A replace.
    const replaced = await upload(s, "family-card", bytes.png(600), { replace: first.file.id });
    expect(await asked()).toBe(409);
    await aged();
    // A delete of one's own file.
    expect((await deleteFile(replaced.file.id, s.cookie)).status).toBe(204);
    expect(await asked()).toBe(409);
    // And once it has been quiet for 30 days again, the one file left goes.
    await aged();
    expect(await (await purgeDraft(first.draft.id, cookie)).json()).toEqual({ purged: 1, pending: 0 });
  });

  test("a draft of the portal, end to end: the student can no longer read a purged file, keeps their answers and may upload again", async () => {
    await openBatch();
    const s = await student();
    const done = await upload(s, "family-card", bytes.png(500));
    await upload(s, "self-photo", bytes.jpeg(400));
    await setUpdatedAt(done.draft.id, Date.now() - 45 * DAY);
    expect((await readOwnFile(done.file.id, s.cookie)).status).toBe(200);

    const res = await purgeDraft(done.draft.id, await superAdmin());
    expect(await res.json()).toEqual({ purged: 2, pending: 0 });
    expect((await readOwnFile(done.file.id, s.cookie)).status).toBe(404);
    expect(await privateKeys()).toEqual([]);
    expect(await storage()).toEqual({ bytes: 0, files: 0 });
    // The draft is still theirs: an upload goes into it again, and the draft is active again.
    const again = await upload(s, "family-card", bytes.png(500));
    expect(again.draft.id).toBe(done.draft.id);
    expect((await purgeDraft(done.draft.id, await superAdmin())).status).toBe(409);
  });

  test("not a draft, not purged: a missing id, a malformed one, a user's id, a file's id and a submitted application's id are all the same 404, and nothing happens", async () => {
    const cookie = await editor();
    const draft = await draftWithFiles({ slots: ["family-card"] });
    const batch = await addBatch();
    const application = await addApplication(batch.id);
    const stored = await seedFile({ applicationId: application.id, year: batch.year, slot: "family-card", size: 300 });
    const before = await storage();
    const seen = new Set<string>();
    for (const id of [crypto.randomUUID(), "x", "../../x", draft.id.toUpperCase(), draft.userId, draft.files[0]!.id, draft.batch.id, application.id, `${draft.id}/`, "drafts"]) {
      const res = await purgeDraft(id, cookie);
      expect(res.status, id).toBe(404);
      seen.add(JSON.stringify(await res.json()));
    }
    expect([...seen]).toEqual(['{"error":"not_found"}']);
    expect(await privateKeys()).toEqual([draft.files[0]!.key, stored.key].sort());
    expect(await auditRows()).toEqual([]);
    expect(await storage()).toEqual(before);
  });

  test("a submitted application's files are never reachable through a draft's route, even when a draft row with its id exists", async () => {
    const cookie = await editor();
    const draft = await draftWithFiles({ slots: ["family-card", "self-photo"] });
    // The state the submit never leaves (it deletes the draft in the batch that inserts the application): both rows at once.
    await addApplication(draft.batch.id, { id: draft.id, userId: draft.userId });
    const res = await purgeDraft(draft.id, cookie);
    expect(res.status).toBe(404);
    expect(await privateKeys()).toHaveLength(2);
    expect(await auditRows()).toEqual([]);
    // The route for applications is for applications: with the draft's row gone it purges as it always did.
    await env.DB.prepare("DELETE FROM application_drafts WHERE id = ?").bind(draft.id).run();
    expect((await call(`${ADMIN_APPLICATIONS}/${draft.id}/files/purge`, { method: "POST", cookie, json: { confirm: true } })).status).toBe(200);
    expect(await privateKeys()).toEqual([]);
    expect((await auditRows()).map((row) => row.resource_type)).toEqual(["application"]);
  });

  test("the rule is in the writes, not only in the check before them: a student who saves between the check and the write keeps every file", async () => {
    const draft = await draftWithFiles({ slots: ["family-card", "self-photo"] });
    const before = await storage();
    // The student's save lands right after the Worker has read the draft and found it old enough, and just before its batch.
    const db = racing(env.DB, /UPDATE application_files SET deleted_at/, () => setUpdatedAt(draft.id, Date.now()));
    const res = await purgeDraft(draft.id, await editor(), { confirm: true }, { env: { DB: db } });
    // The admin is told the truth: nothing was deleted because the draft is active now (not "0 purged").
    expect(res.status).toBe(409);
    const refusal = (await res.json()) as { error: string; message: string; purgeableAt: string };
    expect(refusal.error).toBe("draft_active");
    expect(Date.parse(refusal.purgeableAt)).toBeGreaterThan(Date.now() + 29 * DAY);
    expect(await privateKeys()).toHaveLength(2);
    expect((await fileRows()).filter((row) => row.deleted_at === null)).toHaveLength(2);
    expect(await storage()).toEqual(before);
    expect(await auditRows()).toEqual([]);
    // The student's own change stays as it is: the purge did not move it.
    expect(Date.now() - (await updatedAtOf(draft.id))).toBeLessThan(5 * DAY);
  });

  test("a submit that wins the race keeps its files: the application's files are not marked by the draft's route", async () => {
    const draft = await draftWithFiles({ slots: ["family-card"] });
    const db = racing(env.DB, /UPDATE application_files SET deleted_at/, async () => {
      // The student's submit commits right now: the draft goes, an application with its id comes.
      await env.DB.prepare("DELETE FROM application_drafts WHERE id = ?").bind(draft.id).run();
      await addApplication(draft.batch.id, { id: draft.id, userId: draft.userId });
    });
    const res = await purgeDraft(draft.id, await editor(), { confirm: true }, { env: { DB: db } });
    // Not "0 purged": the draft is gone, so it is not a draft any more.
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(await privateKeys()).toEqual([draft.files[0]!.key]);
    expect((await fileRows())[0]!.deleted_at).toBeNull();
    expect(await auditRows()).toEqual([]);
  });

  test("the guard of the writes also refuses a draft that an application has appeared beside (a state the submit never makes): nothing is marked, nothing is written", async () => {
    const draft = await draftWithFiles({ slots: ["family-card", "self-photo"] });
    const before = await storage();
    const db = racing(env.DB, /UPDATE application_files SET deleted_at/, async () => void (await addApplication(draft.batch.id, { id: draft.id, userId: draft.userId })));
    const res = await purgeDraft(draft.id, await editor(), { confirm: true }, { env: { DB: db } });
    expect(res.status).toBe(404);
    expect(await privateKeys()).toHaveLength(2);
    expect((await fileRows()).filter((row) => row.deleted_at === null)).toHaveLength(2);
    expect(await storage()).toEqual(before);
    expect(await auditRows()).toEqual([]);
  });

  test("a purge that wins the race against a submit: the submit finds the draft changed (409 draft_changed) and no application is made with the files gone", async () => {
    const { who, draft } = await readyToSubmit();
    await setUpdatedAt(draft.id, Date.now() - 45 * DAY);
    const cookie = await editor();
    // The submit has read the draft and its files; the admin's purge commits; then the submit writes.
    const db = racing(env.DB, /INSERT INTO student_applications/, async () => {
      expect((await purgeDraft(draft.id, cookie)).status).toBe(200);
    });
    const res = await submit(who, { env: { DB: db } });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("draft_changed");
    expect(await countRows("student_applications")).toBe(0);
    expect((await draftOf(who.id))?.id).toBe(draft.id);
    // Everything the purge was asked to remove is gone, and the student's next submit says what is missing.
    expect((await fileRows()).filter((row) => row.deleted_at === null)).toEqual([]);
    const next = await submit(who);
    expect(next.status).toBe(422);
    expect(((await next.json()) as { error: string }).error).toBe("incomplete");
  });

  test("when R2 cannot delete: the rows are marked and invisible, the audit row is written, pending says how many, a repeat finishes it, and so does the cleanup", async () => {
    const draft = await draftWithFiles({ slots: ["family-card", "self-photo"] });
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
    const cookie = await editor();
    const res = await purgeDraft(draft.id, cookie, { confirm: true }, { env: { PRIVATE_FILES: flakyDeletes() } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ purged: 2, pending: 2 });
    expect((await auditRows()).map((row) => row.resource_type)).toEqual(["application_draft"]);
    expect((await page(await listDrafts(cookie))).items).toEqual([]);
    expect(await privateKeys()).toHaveLength(2);
    // Out of the counter at the mark (it is the bytes of the live files), though both objects are still in the bucket.
    expect(await storage()).toEqual({ bytes: 0, files: 0 });
    expect(lines).toEqual(["[private-files] the objects of removed files could not be deleted; they stay marked for the daily cleanup"]);

    // A repeat of the purge finishes the delete (the draft still looks as old as it was), writes no second row and releases nothing twice.
    const repeat = await purgeDraft(draft.id, cookie);
    expect(await repeat.json()).toEqual({ purged: 0, pending: 0 });
    expect(await privateKeys()).toEqual([]);
    expect(await fileRows()).toEqual([]);
    expect(await auditRows()).toHaveLength(1);
    expect(await storage()).toEqual({ bytes: 0, files: 0 });
  });

  test("the daily cleanup finishes what the bucket refused, and the counter is what the live rows say", async () => {
    const draft = await draftWithFiles({ slots: ["family-card", "self-photo"] });
    const kept = await draftWithFiles({ ageDays: 2, slots: ["family-card"] });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await purgeDraft(draft.id, await editor(), { confirm: true }, { env: { PRIVATE_FILES: flakyDeletes() } });
    expect(await privateKeys()).toHaveLength(3);
    expect(await runFilesHousekeeping(env, Date.now() + 2 * 3600_000)).toEqual({ removed: 2, pending: 0 });
    expect(await privateKeys()).toEqual([kept.files[0]!.key]);
    expect(await storage()).toEqual({ bytes: 300, files: 1 });
  });

  test("the audit row, the counter and the marking are ONE transaction: when the row cannot be written, no file is touched and the draft's version stays", async () => {
    const draft = await draftWithFiles({ slots: ["family-card"] });
    const before = await updatedAtOf(draft.id);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await env.DB.exec("CREATE TRIGGER fail_draft_purge_audit BEFORE INSERT ON audit_log WHEN NEW.action = 'application_file.purge' BEGIN SELECT RAISE(ABORT, 'no'); END");
    try {
      expect((await purgeDraft(draft.id, await editor())).status).toBe(500);
    } finally {
      await env.DB.exec("DROP TRIGGER fail_draft_purge_audit");
    }
    expect(await privateKeys()).toHaveLength(1);
    expect((await fileRows())[0]!.deleted_at).toBeNull();
    expect(await storage()).toEqual({ bytes: 300, files: 1 });
    expect(await updatedAtOf(draft.id)).toBe(before);
  });

  test("20 purges a minute per admin, ONE allowance for deleting files: a draft's and an application's purge share it", async () => {
    const cookie = await editor();
    const other = await editor();
    const draft = await draftWithFiles();
    for (let i = 0; i < 10; i++) expect((await purgeDraft(crypto.randomUUID(), cookie)).status).toBe(404);
    for (let i = 0; i < 10; i++) expect((await call(`${ADMIN_APPLICATIONS}/${crypto.randomUUID()}/files/purge`, { method: "POST", cookie, json: { confirm: true } })).status).toBe(404);
    const limited = await purgeDraft(draft.id, cookie);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(await privateKeys()).toHaveLength(1);
    // The allowance is the admin's own, and it comes back with the minute.
    expect((await purgeDraft(draft.id, other)).status).toBe(200);
    limiterClock.advance(60_000);
    expect((await purgeDraft(crypto.randomUUID(), cookie)).status).toBe(404);
    // Reading the list is not a purge: it is not limited by it.
    expect((await listDrafts(cookie)).status).toBe(200);
  });

  test("without the bucket binding: 503 storage_unavailable, nothing marked, no audit row", async () => {
    const draft = await draftWithFiles();
    const res = await purgeDraft(draft.id, await editor(), { confirm: true }, { env: { PRIVATE_FILES: undefined } });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("storage_unavailable");
    expect((await fileRows())[0]!.deleted_at).toBeNull();
    expect(await auditRows()).toEqual([]);
  });

  test("the Aktivitas page shows the row with its own resource type, no details and no link to an application", async () => {
    const draft = await draftWithFiles({ slots: ["family-card", "self-photo"] });
    await purgeDraft(draft.id, await editor());
    const res = await call("/api/admin/audit?resource=application_draft", { cookie: await superAdmin() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { action: string; resourceType: string; resourceId: string; details: unknown }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ action: "application_file.purge", resourceType: "application_draft", resourceId: draft.id, details: null });
    // The purge of an application's files stays under its own type.
    expect((await call("/api/admin/audit?resource=application", { cookie: await superAdmin() })).status).toBe(200);
  });
});

describe("the files of a submitted application are the other purge's, and it is unchanged by this one", () => {
  test("a draft's id is still a 404 on the application purge, and the DRAFT route's list never mentions an application", async () => {
    const cookie = await editor();
    const draft = await draftWithFiles();
    const res = await call(`${ADMIN_APPLICATIONS}/${draft.id}/files/purge`, { method: "POST", cookie, json: { confirm: true } });
    expect(res.status).toBe(404);
    expect(await privateKeys()).toHaveLength(1);
    const batch = await addBatch();
    const application = await addApplication(batch.id);
    await seedFile({ applicationId: application.id, year: batch.year });
    expect((await page(await listDrafts(cookie))).items.map((item) => item.id)).toEqual([draft.id]);
  });
});
