"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth-helpers";
import { writeAudit } from "@/lib/audit";
import { getBatchStatusCounts } from "@/lib/admission-batches";
import { db } from "@/lib/db";
import { admissionBatches } from "@/lib/db/schema";

const NUMBER_YEAR = z.coerce
  .number()
  .int()
  .gte(2024, "Tahun terlalu jauh ke belakang")
  .lte(2100, "Tahun terlalu jauh ke depan");

const baseSchema = z.object({
  year: NUMBER_YEAR,
  name: z.string().trim().min(3, "Nama minimal 3 karakter").max(120),
  description: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  opensAt: z
    .string()
    .min(1, "Tanggal buka wajib diisi")
    .transform((v) => new Date(v))
    .refine((d) => !Number.isNaN(d.getTime()), "Format tanggal tidak valid"),
  closesAt: z
    .string()
    .min(1, "Tanggal tutup wajib diisi")
    .transform((v) => new Date(v))
    .refine((d) => !Number.isNaN(d.getTime()), "Format tanggal tidak valid"),
});

const createSchema = baseSchema.refine((v) => v.closesAt > v.opensAt, {
  message: "Tanggal tutup harus setelah tanggal buka",
  path: ["closesAt"],
});
const updateSchema = baseSchema
  .extend({ id: z.string().uuid() })
  .refine((v) => v.closesAt > v.opensAt, {
    message: "Tanggal tutup harus setelah tanggal buka",
    path: ["closesAt"],
  });

export type BatchFormState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
};

function invalidate(id?: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/batches");
  if (id) revalidatePath(`/admin/batches/${id}`);
  revalidatePath("/portal");
  revalidatePath("/portal/status");
  revalidatePath("/gabung-siswa");
}

export async function createBatch(
  _prev: BatchFormState,
  formData: FormData,
): Promise<BatchFormState> {
  const admin = await requireAdmin();
  const parsed = createSchema.safeParse({
    year: formData.get("year"),
    name: formData.get("name"),
    description: formData.get("description"),
    opensAt: formData.get("opensAt"),
    closesAt: formData.get("closesAt"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Periksa kembali isian formulir.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  const duplicateYear = await db.query.admissionBatches.findFirst({
    where: eq(admissionBatches.year, data.year),
    columns: { id: true },
  });
  if (duplicateYear) {
    return {
      status: "error",
      message: `Sudah ada batch untuk tahun ${data.year}.`,
      fieldErrors: { year: ["Tahun sudah dipakai batch lain"] },
    };
  }

  const [inserted] = await db
    .insert(admissionBatches)
    .values({
      year: data.year,
      name: data.name,
      description: data.description ?? null,
      opensAt: data.opensAt,
      closesAt: data.closesAt,
      createdBy: admin.userId,
    })
    .returning({ id: admissionBatches.id });

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.userId,
    action: "batch.create",
    resourceType: "batch",
    resourceId: inserted.id,
    metadata: { year: data.year, name: data.name },
  });

  invalidate(inserted.id);
  redirect(`/admin/batches/${inserted.id}?created=1`);
}

export async function updateBatch(
  _prev: BatchFormState,
  formData: FormData,
): Promise<BatchFormState> {
  const admin = await requireAdmin();
  const parsed = updateSchema.safeParse({
    id: formData.get("id"),
    year: formData.get("year"),
    name: formData.get("name"),
    description: formData.get("description"),
    opensAt: formData.get("opensAt"),
    closesAt: formData.get("closesAt"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Periksa kembali isian formulir.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  const conflict = await db.query.admissionBatches.findFirst({
    where: and(eq(admissionBatches.year, data.year), ne(admissionBatches.id, data.id)),
    columns: { id: true },
  });
  if (conflict) {
    return {
      status: "error",
      message: `Tahun ${data.year} sudah dipakai batch lain.`,
      fieldErrors: { year: ["Tahun sudah dipakai batch lain"] },
    };
  }

  await db
    .update(admissionBatches)
    .set({
      year: data.year,
      name: data.name,
      description: data.description ?? null,
      opensAt: data.opensAt,
      closesAt: data.closesAt,
      updatedAt: new Date(),
    })
    .where(eq(admissionBatches.id, data.id));

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.userId,
    action: "batch.update",
    resourceType: "batch",
    resourceId: data.id,
    metadata: { year: data.year, name: data.name },
  });

  invalidate(data.id);
  return { status: "success", message: "Perubahan berhasil disimpan." };
}

/**
 * Publish results for an entire batch: sets `resultsPublishedAt = now()`.
 * Guarded so at least one application exists and none are still pending /
 * under review — publishing while decisions are pending would surface
 * blank statuses to students.
 */
export async function publishBatchResults(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/admin/batches?error=Batch+tidak+ditemukan");

  const batch = await db.query.admissionBatches.findFirst({
    where: eq(admissionBatches.id, id),
  });
  if (!batch) redirect("/admin/batches?error=Batch+tidak+ditemukan");

  if (batch!.resultsPublishedAt) {
    redirect(`/admin/batches/${id}?error=Hasil+sudah+dipublikasikan`);
  }

  const counts = await getBatchStatusCounts(id);
  if (counts.total === 0) {
    redirect(
      `/admin/batches/${id}?error=Belum+ada+pendaftar+di+batch+ini`,
    );
  }
  if (counts.pending > 0 || counts.under_review > 0) {
    redirect(
      `/admin/batches/${id}?error=Masih+ada+${counts.pending + counts.under_review}+pendaftar+yang+belum+diputuskan`,
    );
  }

  await db
    .update(admissionBatches)
    .set({ resultsPublishedAt: new Date(), updatedAt: new Date() })
    .where(eq(admissionBatches.id, id));

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.userId,
    action: "batch.publish_results",
    resourceType: "batch",
    resourceId: id,
    metadata: {
      accepted: counts.accepted,
      rejected: counts.rejected,
    },
  });

  invalidate(id);
  redirect(`/admin/batches/${id}?published=1`);
}

export async function unpublishBatchResults(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/admin/batches?error=Batch+tidak+ditemukan");

  await db
    .update(admissionBatches)
    .set({ resultsPublishedAt: null, updatedAt: new Date() })
    .where(eq(admissionBatches.id, id));

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.userId,
    action: "batch.unpublish_results",
    resourceType: "batch",
    resourceId: id,
  });

  invalidate(id);
  redirect(`/admin/batches/${id}?unpublished=1`);
}
