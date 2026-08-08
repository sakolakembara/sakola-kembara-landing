import "server-only";
import { and, desc, eq, gt, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  admissionBatches,
  applicationStatus,
  studentApplications,
  type AdmissionBatch,
} from "@/lib/db/schema";

/**
 * Return the batch that is currently open for registrations, or null when no
 * such batch exists. A batch is "open" when now is between `opensAt` and
 * `closesAt`. If multiple batches overlap (shouldn't happen because of the
 * per-year unique constraint, but defense in depth), the most recent by
 * `opensAt` wins.
 */
export async function getCurrentOpenBatch(): Promise<AdmissionBatch | null> {
  const now = new Date();
  const row = await db.query.admissionBatches.findFirst({
    where: and(lte(admissionBatches.opensAt, now), gt(admissionBatches.closesAt, now)),
    orderBy: [desc(admissionBatches.opensAt)],
  });
  return row ?? null;
}

export async function getAllBatches(): Promise<AdmissionBatch[]> {
  return db
    .select()
    .from(admissionBatches)
    .orderBy(desc(admissionBatches.year));
}

export async function getBatchById(id: string): Promise<AdmissionBatch | null> {
  const row = await db.query.admissionBatches.findFirst({
    where: eq(admissionBatches.id, id),
  });
  return row ?? null;
}

/**
 * Return status counts for a batch — used by the "Publikasikan hasil" guard
 * and the admin batch detail view.
 */
export async function getBatchStatusCounts(
  batchId: string,
): Promise<Record<(typeof applicationStatus)[number], number> & { total: number }> {
  const rows = await db
    .select({
      status: studentApplications.status,
      value: sql<number>`cast(count(*) as int)`,
    })
    .from(studentApplications)
    .where(eq(studentApplications.batchId, batchId))
    .groupBy(studentApplications.status);

  const counts = {
    pending: 0,
    under_review: 0,
    accepted: 0,
    rejected: 0,
    total: 0,
  };
  for (const r of rows) {
    counts[r.status] = Number(r.value);
    counts.total += Number(r.value);
  }
  return counts;
}
