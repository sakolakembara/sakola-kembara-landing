import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import {
  AUDIT_DRAFT_PURGE_SQL,
  DRAFT_SQL,
  DRAFTS_PAGE_SQL,
  DRAFTS_TOTAL_SQL,
  listDraftFiles,
  MARK_DRAFT_FILES_SQL,
  purgeDraftFiles,
  RELEASE_DRAFT_CONDITION,
  TOUCH_DRAFT_VERSION_SQL,
} from "../src/private-files/drafts";
import { releaseLiveSql } from "../src/private-files/storage";
import { addApplication, addBatch } from "./pendaftaran-helpers";
import { bareStudent, draftWithFiles } from "./private-files-drafts-helpers";
import { emptyBucketBeforeEach, seedFile } from "./private-files-helpers";
import { instrumentD1 } from "./public-helpers";

// What the list of drafts and the purge of their files cost D1 (docs/cloudflare/portal-api.md, 12.4; the rules of
// docs/cloudflare/admin-crud.md#12): no N+1, one round trip for a page and its total, every file of a draft reached by a
// seek on the (application_id, slot) index, and the one deliberate walk named: the drafts table, which holds only students
// who have not submitted (the submit deletes the draft). Workers Free: 10 ms CPU a request, 5M rows read a day on D1 Free.
// The numbers are the local D1's (`meta.rows_read`); the real one is confirmed on a deployed Worker (SAKEM-084).

emptyBucketBeforeEach();

async function plan(sql: string, binds: unknown[]): Promise<string[]> {
  const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...binds).all<{ detail: string }>();
  return results.map((row) => row.detail);
}

const FILES_INDEX = "application_files_application_slot_idx (application_id=?)";

/** The statements of the list and of the purge with placeholders bound (the plan does not depend on the values). */
const STATEMENTS: [string, string, unknown[]][] = [
  ["the page of the list", DRAFTS_PAGE_SQL, [20, 0]],
  ["the total of the list", DRAFTS_TOTAL_SQL, []],
  ["the draft a purge reads first", DRAFT_SQL, ["x"]],
  ["the audit row of a purge", AUDIT_DRAFT_PURGE_SQL, ["a", "b", "c", "d", 1]],
  ["the marking of the files", MARK_DRAFT_FILES_SQL, [1, "x", 2]],
  ["the bytes given back to the counter", releaseLiveSql(RELEASE_DRAFT_CONDITION, 2), ["x", 1, 2]],
  ["the draft's version moved", TOUCH_DRAFT_VERSION_SQL, ["x", 1]],
];

describe("plans", () => {
  test.each(STATEMENTS)("%s: no walk of the files or of the applications", async (_label, sql, binds) => {
    const lines = await plan(sql, binds);
    expect(lines.filter((line) => /^SCAN (application_files|student_applications|f|a)\b/.test(line.trim())), lines.join(" | ")).toEqual([]);
  });

  test("the list walks the drafts table (the one deliberate scan) and nothing else; each draft's files are a seek on the index, its batch a seek on the primary key", async () => {
    const page = (await plan(DRAFTS_PAGE_SQL, [20, 0])).join(" | ");
    expect(page).toMatch(/^SCAN d USING INDEX/);
    expect(page).toContain(`SEARCH f USING INDEX ${FILES_INDEX}`);
    expect(page).toContain("SEARCH b USING INDEX sqlite_autoindex_admission_batches_1 (id=?)");
    expect(page).toContain("SEARCH a USING COVERING INDEX sqlite_autoindex_student_applications_1 (id=?)");
    const total = (await plan(DRAFTS_TOTAL_SQL, [])).join(" | ");
    expect(total).toMatch(/^SCAN d USING COVERING INDEX/);
    expect(total).toContain(`SEARCH f EXISTS USING INDEX ${FILES_INDEX}`);
  });

  test("a purge reaches the draft, the application and the files by primary key and by the index, in every statement of its batch", async () => {
    expect((await plan(DRAFT_SQL, ["x"])).join(" | ")).toContain("SEARCH d USING INDEX sqlite_autoindex_application_drafts_1 (id=?)");
    for (const [sql, binds] of [
      [AUDIT_DRAFT_PURGE_SQL, ["a", "b", "c", "d", 1]],
      [MARK_DRAFT_FILES_SQL, [1, "x", 2]],
      [releaseLiveSql(RELEASE_DRAFT_CONDITION, 2), ["x", 1, 2]],
      [TOUCH_DRAFT_VERSION_SQL, ["x", 1]],
    ] as [string, unknown[]][]) {
      const lines = (await plan(sql, binds)).join(" | ");
      expect(lines, sql).toContain(FILES_INDEX);
    }
    for (const [sql, binds] of [
      [AUDIT_DRAFT_PURGE_SQL, ["a", "b", "c", "d", 1]],
      [MARK_DRAFT_FILES_SQL, [1, "x", 2]],
    ] as [string, unknown[]][]) {
      const lines = (await plan(sql, binds)).join(" | ");
      expect(lines, "the draft's guard").toContain("sqlite_autoindex_application_drafts_1 (id=?)");
      expect(lines, "the application's guard").toContain("sqlite_autoindex_student_applications_1 (id=?)");
    }
  });
});

describe("round trips and rows read", () => {
  async function drafts(count: number, slots = 4) {
    const batch = await addBatch();
    const all = [];
    const names = ["family-card", "self-photo", "house-photos", "electricity-bill"] as const;
    for (let i = 0; i < count; i++) all.push(await draftWithFiles({ batch, student: await bareStudent(), slots: names.slice(0, slots) as never, size: 100 }));
    return all;
  }

  test("a page of the list and its total are ONE round trip of two statements, and the rows read follow the drafts and their files, not the other files of the bucket", async () => {
    await drafts(10);
    const first = instrumentD1(env.DB);
    const listed = await listDraftFiles({ DB: first.db }, { pageSize: 20, offset: 0 }, Date.now());
    expect(listed.total).toBe(10);
    expect(listed.items).toHaveLength(10);
    expect([first.stats.roundTrips, first.stats.statements.length]).toEqual([1, 2]);
    // 10 drafts of 4 files: about 11 rows a draft (the draft, its files by the index and by the table, the lookups). Measured: 109.
    expect(first.stats.rowsRead).toBeLessThanOrEqual(140);

    // The files of three submitted applications, 90 in all, add nothing: the list never walks `application_files`.
    const batch = await addBatch();
    for (let i = 0; i < 3; i++) {
      const application = await addApplication(batch.id, { userId: (await bareStudent()).id });
      for (let j = 0; j < 30; j++) await seedFile({ applicationId: application.id, year: batch.year, slot: "house-photos", size: 100 });
    }
    const second = instrumentD1(env.DB);
    await listDraftFiles({ DB: second.db }, { pageSize: 20, offset: 0 }, Date.now());
    expect(second.stats.rowsRead).toBe(first.stats.rowsRead);
    expect(second.stats.roundTrips).toBe(1);
  });

  test("a page costs the same number of round trips whatever it holds: no N+1 (1 draft and 40 drafts, the same two statements)", async () => {
    await drafts(1);
    const one = instrumentD1(env.DB);
    await listDraftFiles({ DB: one.db }, { pageSize: 50, offset: 0 }, Date.now());
    await drafts(39);
    const many = instrumentD1(env.DB);
    await listDraftFiles({ DB: many.db }, { pageSize: 50, offset: 0 }, Date.now());
    expect([one.stats.roundTrips, one.stats.statements.length]).toEqual([many.stats.roundTrips, many.stats.statements.length]);
    expect(many.stats.roundTrips).toBe(1);
  }, 60_000);

  test("a purge: the draft read (1), the batch of four writes (1), the marked rows (1), their deletion (1); about fifty rows read for four files", async () => {
    const [draft] = await drafts(1);
    const actor = await bareStudent();
    const counted = instrumentD1(env.DB);
    const outcome = await purgeDraftFiles({ DB: counted.db, PRIVATE_FILES: env.PRIVATE_FILES }, { id: actor.id, email: actor.email }, draft!.id);
    expect(outcome).toEqual({ ok: true, purged: 4, pending: 0 });
    // `first()` (the draft read) is not counted by the instrument: three counted round trips and the read make the four.
    expect(counted.stats.roundTrips).toBe(3);
    expect(counted.stats.statements.filter((sql) => sql.startsWith("INSERT INTO audit_log")).length).toBe(1);
    expect(counted.stats.statements.filter((sql) => sql.startsWith("UPDATE application_files SET deleted_at")).length).toBe(1);
    expect(counted.stats.rowsRead).toBeLessThanOrEqual(80);
  });
});
