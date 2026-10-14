import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test } from "vitest";
import * as schema from "../src/db/schema";
import { applicationFilesQuery } from "../src/private-files/list";
import { MARK_SQL, TOUCH_SQL } from "../src/private-files/delete";
import { APPLICATION_FILE_SQL, OWN_FILE_SQL } from "../src/private-files/lookup";
import { APPLICATION_SQL, AUDIT_PURGE_SQL, MARK_ALL_SQL, MARKED_SQL } from "../src/private-files/purge";
import { ANY_DRAFT_SQL, COUNTS_SQL, GATE_SQL, REPLACED_SQL } from "../src/private-files/state";
import { CREATE_DRAFT_SQL, INSERT_FILE_SQL, MARK_REPLACED_SQL, TOUCH_DRAFT_SQL, USAGE_SQL } from "../src/private-files/upload";

// What the file routes cost D1 (docs/cloudflare/portal-architecture.md, section 10; docs/cloudflare/admin-crud.md#12):
// every statement a student's or an admin's request runs is a seek on an index or a primary key, never a walk of a table
// that grows (`application_files` holds up to 35 rows per applicant, `application_drafts` and `student_applications`
// one per student per batch). Workers Free: 10 ms CPU a request, and 5M rows read a day on D1 Free.
// The one deliberate walk is the daily cleanup's look for marked rows (MARKED_SQL of housekeeping), which has no index
// because it is rare and bounded; it is not on a request.

const GROWING = /^SCAN (application_files|application_drafts|student_applications)\b/;

/** `EXPLAIN QUERY PLAN` of a statement, with `count` placeholders bound (the plan does not depend on the values). */
async function plan(sql: string, count: number): Promise<string[]> {
  const params = Array.from({ length: count }, (_, i) => (i % 2 === 0 ? "x" : 1));
  const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...params).all<{ detail: string }>();
  return results.map((row) => row.detail);
}

const placeholders = (sql: string) => Math.max(0, ...[...sql.matchAll(/\?(\d+)/g)].map((match) => Number(match[1])));

const STATEMENTS: [string, string][] = [
  ["the gate", GATE_SQL],
  ["the live counts of the open batch's draft", COUNTS_SQL],
  ["the file a replace names", REPLACED_SQL],
  ["any draft of the student", ANY_DRAFT_SQL],
  ["a student's own file", OWN_FILE_SQL],
  ["an admin's file of an application", APPLICATION_FILE_SQL],
  ["the guarded insert of a file row", INSERT_FILE_SQL],
  ["the replaced row marked", MARK_REPLACED_SQL],
  ["the draft's version moved after an upload", TOUCH_DRAFT_SQL],
  ["the draft created by the first upload", CREATE_DRAFT_SQL],
  ["the usage after an upload", USAGE_SQL],
  ["a student's file marked deleted", MARK_SQL],
  ["the draft's version moved after a delete", TOUCH_SQL],
  ["the application of a purge", APPLICATION_SQL],
  ["the audit row of a purge", AUDIT_PURGE_SQL],
  ["every live file of an application marked", MARK_ALL_SQL],
  ["every marked file of an application", MARKED_SQL],
];

describe("plans: no statement of a request walks a table that grows", () => {
  test.each(STATEMENTS)("%s", async (_label, sql) => {
    const lines = await plan(sql, placeholders(sql));
    expect(lines.filter((line) => GROWING.test(line.trim())), lines.join(" | ")).toEqual([]);
  });

  test("the file list of an application and the counts are seeks on the (application_id, slot) index", async () => {
    for (const sql of [USAGE_SQL, MARK_ALL_SQL, MARKED_SQL]) {
      const lines = (await plan(sql, placeholders(sql))).join(" | ");
      expect(lines).toContain("USING INDEX application_files_application_slot_idx (application_id=?)");
    }
    const listed = await plan(applicationFilesQuery(drizzle(env.DB, { schema }), "x").toSQL().sql, 1);
    expect(listed.join(" | ")).toContain("SEARCH application_files USING INDEX application_files_application_slot_idx (application_id=?)");
  });

  test("a file is found by its primary key", async () => {
    for (const sql of [OWN_FILE_SQL, APPLICATION_FILE_SQL]) {
      const lines = (await plan(sql, placeholders(sql))).join(" | ");
      expect(lines).toContain("SEARCH f USING INDEX sqlite_autoindex_application_files_1 (id=?)");
    }
  });

  test("the gate finds the open batch on the opens_at index and a student's rows on their unique indexes", async () => {
    const gate = (await plan(GATE_SQL, 2)).join(" | ");
    expect(gate).toContain("SEARCH b USING INDEX admission_batches_opens_at_idx");
    expect(gate).toContain("student_applications_user_batch_unique");
    expect(gate).toContain("application_drafts_user_batch_unique");
  });
});
