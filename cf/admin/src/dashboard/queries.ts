// What the dashboard reads from D1, and nothing more. The budget (Workers Free:
// 10 ms CPU a request; D1 Free: 5M rows read a day) sets three rules:
//
//   1. One statement per item, three at most: the applications still waiting,
//      the unread messages, the newest batches. A caller who may not see an area
//      does not run that area's statements (an editor of `konten` alone runs
//      none).
//   2. Every statement is an index search or an ordered index walk with a limit,
//      never a scan of a table: the cost follows what needs attention, not the
//      history of the school. test/dashboard.test.ts checks the plans
//      (EXPLAIN QUERY PLAN) and the rows read.
//   3. The statements are known up front, so they go in one `db.batch`: one
//      round trip to D1.
//
// The builders return unexecuted Drizzle queries so the plan test can explain
// exactly what the route runs.

import { count, desc, inArray, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { BatchItem } from "drizzle-orm/batch";
import type { AdminArea } from "../auth/permissions";
import type { Db } from "../db/audit";
import * as schema from "../db/schema";
import { admissionBatches, contactMessages, studentApplications } from "../db/schema";
import { buildDashboard, type BatchRow, type Dashboard, type UndecidedRow } from "./payload";

/** How many of the newest batches are looked at (see `pickBatch`). Admission is yearly. */
export const BATCH_CANDIDATES = 3;

/** Applications still waiting for a decision, per batch and status. Walks the status index for those two values only. */
export const undecidedApplicationsQuery = (db: Db) =>
  db
    .select({ batchId: studentApplications.batchId, status: studentApplications.status, n: count() })
    .from(studentApplications)
    .where(inArray(studentApplications.status, ["pending", "under_review"]))
    .groupBy(studentApplications.batchId, studentApplications.status);

/** Messages nobody has opened yet. Counts the `read_at` index entries that are NULL. */
export const unreadMessagesQuery = (db: Db) => db.select({ n: count() }).from(contactMessages).where(isNull(contactMessages.readAt));

/** The newest batches by opening date: an ordered walk of the `opens_at` index that stops at the limit. */
export const recentBatchesQuery = (db: Db) =>
  db
    .select({
      id: admissionBatches.id,
      year: admissionBatches.year,
      opensAt: admissionBatches.opensAt,
      closesAt: admissionBatches.closesAt,
      resultsPublishedAt: admissionBatches.resultsPublishedAt,
    })
    .from(admissionBatches)
    .orderBy(desc(admissionBatches.opensAt))
    .limit(BATCH_CANDIDATES);

/**
 * The dashboard for someone who may see `visible` areas. `pendaftaran` brings
 * the applicant counts and the batch (two statements), `komunikasi` the unread
 * messages (one); `konten` and `sistem` have nothing on the dashboard.
 */
export async function loadDashboard(d1: D1Database, visible: readonly AdminArea[], now: Date): Promise<Dashboard> {
  const db = drizzle(d1, { schema });
  const wantsAdmission = visible.includes("pendaftaran");
  const wantsMessages = visible.includes("komunikasi");

  const statements: BatchItem<"sqlite">[] = [];
  if (wantsAdmission) statements.push(undecidedApplicationsQuery(db), recentBatchesQuery(db));
  if (wantsMessages) statements.push(unreadMessagesQuery(db));
  if (statements.length === 0) return buildDashboard({}, now);

  const results = await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  let next = 0;
  const rows: Parameters<typeof buildDashboard>[0] = {};
  if (wantsAdmission) {
    rows.undecided = results[next++] as UndecidedRow[];
    rows.batches = results[next++] as BatchRow[];
  }
  if (wantsMessages) rows.unreadMessages = (results[next++] as { n: number }[])[0]?.n ?? 0;
  return buildDashboard(rows, now);
}
