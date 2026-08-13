"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth-helpers";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  applicationStatus,
  studentApplications,
} from "@/lib/db/schema";

// Minimum length for a revocation note — enough to force the admin to
// type an actual reason, not "n/a". Regular decision notes stay
// short-friendly.
const REVOCATION_NOTES_MIN = 20;

const schema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(applicationStatus),
    reviewNotes: z.string().trim().max(2000).optional().or(z.literal("")),
  })
  .refine(
    (v) =>
      v.status === "pending" ||
      v.status === "under_review" ||
      (v.reviewNotes && v.reviewNotes.length > 0),
    {
      message: "Catatan review wajib diisi saat menerima atau menolak.",
      path: ["reviewNotes"],
    },
  );

export async function updateApplicationStatus(formData: FormData) {
  const admin = await requireAdmin();

  const parsed = schema.safeParse({
    id: formData.get("id"),
    status: formData.get("status"),
    reviewNotes: formData.get("reviewNotes"),
  });

  if (!parsed.success) {
    const firstError =
      parsed.error.flatten().fieldErrors.reviewNotes?.[0] ??
      parsed.error.flatten().formErrors[0] ??
      "Permintaan tidak valid.";
    redirect(
      `/admin/applications/${formData.get("id")}?error=${encodeURIComponent(firstError)}`,
    );
  }

  const data = parsed.data;

  // Fetch previous status BEFORE the update so we can detect the
  // revocation transition (accepted → rejected). Revocations get a
  // stricter validation floor and a dedicated audit action so an operator
  // trawling the log can spot them without eyeballing every metadata blob.
  const previous = await db.query.studentApplications.findFirst({
    where: eq(studentApplications.id, data.id),
    columns: { id: true, status: true },
  });
  if (!previous) {
    redirect(
      `/admin/applications/${data.id}?error=${encodeURIComponent("Pendaftar tidak ditemukan.")}`,
    );
  }

  const isRevocation =
    previous!.status === "accepted" && data.status === "rejected";

  if (isRevocation && (data.reviewNotes ?? "").length < REVOCATION_NOTES_MIN) {
    redirect(
      `/admin/applications/${data.id}?error=${encodeURIComponent(`Alasan pencabutan wajib diisi minimal ${REVOCATION_NOTES_MIN} karakter — jelaskan mengapa penerimaan ini dibatalkan.`)}`,
    );
  }

  await db
    .update(studentApplications)
    .set({
      status: data.status,
      reviewNotes: data.reviewNotes || null,
      reviewedBy: admin.userId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(studentApplications.id, data.id));

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.userId,
    // Revocation gets its own action for log-filtering. Normal status
    // changes stay on the existing `application.{status}` shape so
    // dashboards + audit queries don't need retroactive rewrites.
    action: isRevocation
      ? "application.revoke"
      : `application.${data.status}`,
    resourceType: "application",
    resourceId: data.id,
    metadata: isRevocation
      ? {
          previousStatus: previous!.status,
          revocationReason: data.reviewNotes ?? null,
        }
      : data.reviewNotes
        ? { reviewNotes: data.reviewNotes }
        : undefined,
  });

  revalidatePath("/admin");
  revalidatePath("/admin/applications");
  revalidatePath(`/admin/applications/${data.id}`);
  revalidatePath("/portal");
  revalidatePath("/portal/status");
}
