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

const schema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(applicationStatus),
    reviewNotes: z.string().trim().max(2000).optional().or(z.literal("")),
  })
  .refine(
    (v) => v.status === "pending" || v.status === "under_review" || (v.reviewNotes && v.reviewNotes.length > 0),
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
    // Surface the first error as a query string so the page can display it.
    const firstError =
      parsed.error.flatten().fieldErrors.reviewNotes?.[0] ??
      parsed.error.flatten().formErrors[0] ??
      "Permintaan tidak valid.";
    redirect(
      `/admin/applications/${formData.get("id")}?error=${encodeURIComponent(firstError)}`,
    );
  }

  const data = parsed.data;

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
    action: `application.${data.status}`,
    resourceType: "application",
    resourceId: data.id,
    metadata: data.reviewNotes ? { reviewNotes: data.reviewNotes } : undefined,
  });

  revalidatePath("/admin");
  revalidatePath("/admin/applications");
  revalidatePath(`/admin/applications/${data.id}`);
}
