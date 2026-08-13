import "server-only";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  admissionBatches,
  studentApplications,
  type ApplicationStatus,
} from "@/lib/db/schema";

export interface PortalApplication {
  id: string;
  status: ApplicationStatus;
  submittedAt: Date;
  reviewNotes: string | null;
  batch: {
    id: string;
    year: number;
    name: string;
    resultsPublishedAt: Date | null;
  } | null;
}

/** Every application belonging to a given student user, newest first. */
export async function getApplicationsForUser(
  userId: string,
): Promise<PortalApplication[]> {
  const rows = await db
    .select({
      id: studentApplications.id,
      status: studentApplications.status,
      submittedAt: studentApplications.submittedAt,
      reviewNotes: studentApplications.reviewNotes,
      batchId: admissionBatches.id,
      batchYear: admissionBatches.year,
      batchName: admissionBatches.name,
      batchPublishedAt: admissionBatches.resultsPublishedAt,
    })
    .from(studentApplications)
    .leftJoin(admissionBatches, eq(studentApplications.batchId, admissionBatches.id))
    .where(eq(studentApplications.userId, userId))
    .orderBy(desc(studentApplications.submittedAt));

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    submittedAt: r.submittedAt,
    reviewNotes: r.reviewNotes,
    batch: r.batchId
      ? {
          id: r.batchId,
          year: r.batchYear!,
          name: r.batchName!,
          resultsPublishedAt: r.batchPublishedAt,
        }
      : null,
  }));
}

export async function getUserApplicationForBatch(
  userId: string,
  batchId: string,
) {
  return db.query.studentApplications.findFirst({
    where: and(
      eq(studentApplications.userId, userId),
      eq(studentApplications.batchId, batchId),
    ),
    columns: { id: true, status: true, submittedAt: true },
  });
}

/**
 * Batches where this user was accepted AND the batch's results have been
 * publicly published. Used to build the `acceptedInBatches` claim on the
 * SSO JWT — LMS gates course-content access on this list.
 *
 * Not-yet-published acceptances are intentionally excluded so the SSO
 * claim matches what the student sees on /portal/status. See the "privacy
 * contract" in docs/architecture/student-portal.md.
 */
export async function getAcceptedPublishedBatchIds(
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({ batchId: admissionBatches.id })
    .from(studentApplications)
    .innerJoin(
      admissionBatches,
      eq(studentApplications.batchId, admissionBatches.id),
    )
    .where(
      and(
        eq(studentApplications.userId, userId),
        eq(studentApplications.status, "accepted"),
        isNotNull(admissionBatches.resultsPublishedAt),
      ),
    );
  return rows.map((r) => r.batchId);
}
