import { z } from "zod";
import { applicationStatus, type ApplicationStatus } from "../db/schema";

// The review of an application: what the admin may change and the rules of a decision. Pure (no I/O), so every
// rule is tested without a database (test/admission-rules.test.ts); the route is in src/api/applications.ts.
//
// A port of app/(admin)/admin/applications/[id]/actions.ts. The rules are the legacy ones, and only these:
//
//   - any status can be set from any other (there is no "pending -> under_review -> decided" machine in the
//     legacy code, only the two rules below);
//   - accepting or rejecting needs a review note (pending and under_review do not);
//   - revoking an acceptance (accepted -> rejected) needs a note of at least 20 characters, and is logged as
//     `application.revoke` instead of `application.rejected`.

/** Shortest reason for revoking an acceptance: enough to force a sentence, not "n/a". */
export const REVOCATION_NOTES_MIN = 20;
export const REVIEW_NOTES_MAX = 2000;

export const REVIEW_MESSAGES = {
  unknownStatus: "Status tidak dikenal",
  notesRequired: "Catatan review wajib diisi saat menerima atau menolak.",
  notesTooLong: `Catatan review maksimal ${REVIEW_NOTES_MAX} karakter`,
  revocationNotes: `Alasan pencabutan wajib diisi minimal ${REVOCATION_NOTES_MIN} karakter — jelaskan mengapa penerimaan ini dibatalkan.`,
  notFound: "Pendaftar tidak ditemukan.",
} as const;

/** The body of `POST /api/admin/applications/:id/status`. `reviewNotes` ends up trimmed, "" when there is none. */
export const reviewInput = z
  .object({
    status: z.enum(applicationStatus, { error: REVIEW_MESSAGES.unknownStatus }),
    reviewNotes: z
      .string()
      .trim()
      .max(REVIEW_NOTES_MAX, REVIEW_MESSAGES.notesTooLong)
      .nullish()
      .transform((value) => value ?? ""),
  })
  .refine((value) => value.status === "pending" || value.status === "under_review" || value.reviewNotes.length > 0, {
    message: REVIEW_MESSAGES.notesRequired,
    path: ["reviewNotes"],
  });

export type ReviewInput = z.output<typeof reviewInput>;

/** Accepted and then rejected: the one transition with a stricter rule and an action of its own. */
export function isRevocation(previous: ApplicationStatus, next: ApplicationStatus): boolean {
  return previous === "accepted" && next === "rejected";
}

/**
 * The refusal for a revocation whose note is too short, or null. Checked once the current status is known:
 * a form cannot know it was already accepted when it was loaded an hour ago.
 */
export function revocationProblem(previous: ApplicationStatus, input: Pick<ReviewInput, "status" | "reviewNotes">): { field: "reviewNotes"; message: string } | null {
  if (isRevocation(previous, input.status) && input.reviewNotes.length < REVOCATION_NOTES_MIN) {
    return { field: "reviewNotes", message: REVIEW_MESSAGES.revocationNotes };
  }
  return null;
}

/**
 * The audit action of a decision: `application.<status>`, or `application.revoke` for a revocation, so someone
 * reading the log can find revocations without opening every row.
 */
export function reviewAction(previous: ApplicationStatus, next: ApplicationStatus): `application.${ApplicationStatus}` | "application.revoke" {
  return isRevocation(previous, next) ? "application.revoke" : `application.${next}`;
}

/** The columns a decision writes, by name: what the audit row records (never the note itself). */
export const REVIEW_FIELDS = ["status", "reviewNotes", "reviewedBy", "reviewedAt"] as const;
