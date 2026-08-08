"use server";

import { redirect } from "next/navigation";
import { revalidatePath, revalidateTag } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth-helpers";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  announcementSeverity,
  announcements,
} from "@/lib/db/schema";

const optionalDate = z
  .string()
  .optional()
  .or(z.literal(""))
  .transform((v) => (v && v.length > 0 ? new Date(v) : null))
  .refine((v) => v === null || !Number.isNaN(v.getTime()), {
    message: "Format tanggal tidak valid",
  });

const baseSchema = z
  .object({
    title: z.string().trim().min(3, "Judul minimal 3 karakter").max(200),
    body: z.string().trim().min(5, "Isi minimal 5 karakter").max(500),
    severity: z.enum(announcementSeverity),
    ctaLabel: z.string().trim().max(60).optional().or(z.literal("")),
    ctaUrl: z.string().trim().max(500).optional().or(z.literal("")),
    active: z
      .string()
      .optional()
      .transform((v) => v === "on" || v === "true"),
    startsAt: optionalDate,
    endsAt: optionalDate,
  })
  .refine(
    (v) =>
      (!v.ctaLabel && !v.ctaUrl) ||
      (v.ctaLabel && v.ctaUrl && v.ctaLabel.length > 0 && v.ctaUrl.length > 0),
    { message: "Label dan URL CTA harus diisi keduanya", path: ["ctaLabel"] },
  )
  .refine(
    (v) =>
      !v.startsAt || !v.endsAt || v.endsAt.getTime() >= v.startsAt.getTime(),
    {
      message: "Tanggal selesai harus setelah tanggal mulai",
      path: ["endsAt"],
    },
  );

const updateSchema = baseSchema.and(
  z.object({ id: z.string().uuid() }),
);

export type AnnouncementFormState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
};

function invalidate() {
  revalidateTag("announcements", "max");
  revalidatePath("/");
  revalidatePath("/blog");
  revalidatePath("/donasi");
  revalidatePath("/kontak");
  revalidatePath("/tim");
  revalidatePath("/gabung-siswa");
  revalidatePath("/admin");
  revalidatePath("/admin/announcements");
}

export async function createAnnouncement(
  _prev: AnnouncementFormState,
  formData: FormData,
): Promise<AnnouncementFormState> {
  const admin = await requireAdmin();
  const parsed = baseSchema.safeParse({
    title: formData.get("title"),
    body: formData.get("body"),
    severity: formData.get("severity"),
    ctaLabel: formData.get("ctaLabel"),
    ctaUrl: formData.get("ctaUrl"),
    active: formData.get("active"),
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Periksa kembali isian formulir.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  const [inserted] = await db
    .insert(announcements)
    .values({
      title: data.title,
      body: data.body,
      severity: data.severity,
      ctaLabel: data.ctaLabel || null,
      ctaUrl: data.ctaUrl || null,
      active: data.active,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      createdBy: admin.userId,
    })
    .returning({ id: announcements.id });

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.userId,
    action: "announcement.create",
    resourceType: "announcement",
    resourceId: inserted.id,
    metadata: {
      title: data.title,
      severity: data.severity,
      active: data.active,
    },
  });

  invalidate();
  redirect(`/admin/announcements/${inserted.id}/edit?created=1`);
}

export async function updateAnnouncement(
  _prev: AnnouncementFormState,
  formData: FormData,
): Promise<AnnouncementFormState> {
  const admin = await requireAdmin();
  const parsed = updateSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title"),
    body: formData.get("body"),
    severity: formData.get("severity"),
    ctaLabel: formData.get("ctaLabel"),
    ctaUrl: formData.get("ctaUrl"),
    active: formData.get("active"),
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Periksa kembali isian formulir.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  await db
    .update(announcements)
    .set({
      title: data.title,
      body: data.body,
      severity: data.severity,
      ctaLabel: data.ctaLabel || null,
      ctaUrl: data.ctaUrl || null,
      active: data.active,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      updatedAt: new Date(),
    })
    .where(eq(announcements.id, data.id));

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.userId,
    action: "announcement.update",
    resourceType: "announcement",
    resourceId: data.id,
    metadata: {
      title: data.title,
      severity: data.severity,
      active: data.active,
    },
  });

  invalidate();
  return { status: "success", message: "Pengumuman berhasil disimpan." };
}

export async function deleteAnnouncement(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("id"));
  const existing = await db.query.announcements.findFirst({
    where: eq(announcements.id, id),
    columns: { id: true, title: true },
  });
  if (!existing) {
    redirect("/admin/announcements?error=not-found");
  }
  await db.delete(announcements).where(eq(announcements.id, id));
  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.userId,
    action: "announcement.delete",
    resourceType: "announcement",
    resourceId: id,
    metadata: { title: existing.title },
  });
  invalidate();
  redirect("/admin/announcements?deleted=1");
}
