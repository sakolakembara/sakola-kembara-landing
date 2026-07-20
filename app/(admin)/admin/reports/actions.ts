"use server";

import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import { redirect } from "next/navigation";
import { revalidatePath, revalidateTag } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ALLOWED_DOMAIN, auth } from "@/auth";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { adminUsers, reportCategory, reports } from "@/lib/db/schema";
import { isValidReportYear } from "@/lib/report-types";

const MAX_PDF_BYTES = 20_000_000; // 20 MB

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "report"
  );
}

const baseSchema = z.object({
  title: z.string().trim().min(3, "Judul minimal 3 karakter").max(200),
  description: z
    .string()
    .trim()
    .max(1000, "Deskripsi maksimal 1000 karakter")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  category: z.enum(reportCategory),
  year: z
    .string()
    .trim()
    .refine(isValidReportYear, {
      message: "Format tahun tidak valid. Contoh: 2025 atau 2025/2026",
    }),
});

const updateSchema = baseSchema.extend({
  id: z.string().uuid(),
});

export type ReportFormState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
};

async function requireAdmin(): Promise<{ email: string; actorId: string | null }> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email || !email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    redirect("/login");
  }
  const actor = await db.query.adminUsers.findFirst({
    where: eq(adminUsers.email, email),
    columns: { id: true },
  });
  return { email, actorId: actor?.id ?? null };
}

function invalidate() {
  revalidateTag("reports", "max");
  revalidatePath("/laporan");
  revalidatePath("/admin");
  revalidatePath("/admin/reports");
}

export async function createReport(
  _prev: ReportFormState,
  formData: FormData,
): Promise<ReportFormState> {
  const admin = await requireAdmin();
  const parsed = baseSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    category: formData.get("category"),
    year: formData.get("year"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Periksa kembali isian formulir.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return {
      status: "error",
      message: "File PDF wajib diupload.",
      fieldErrors: { file: ["File PDF wajib diupload."] },
    };
  }
  if (file.type !== "application/pdf") {
    return {
      status: "error",
      message: "Hanya file PDF yang diperbolehkan.",
      fieldErrors: { file: ["Hanya file PDF yang diperbolehkan."] },
    };
  }
  if (file.size > MAX_PDF_BYTES) {
    return {
      status: "error",
      message: "Ukuran file maksimal 20 MB.",
      fieldErrors: { file: ["Ukuran file maksimal 20 MB."] },
    };
  }

  const data = parsed.data;
  const slug = slugify(data.title);
  const stamp = Math.random().toString(36).slice(2, 8);
  const filename = `${slug}-${stamp}.pdf`;
  // Path segments can't contain "/", so map "2025/2026" → "2025-2026".
  const yearSeg = data.year.replace(/\//g, "-");
  const relPath = `/reports/${yearSeg}/${data.category}/${filename}`;
  const absPath = path.join(process.cwd(), "public", relPath);

  const buffer = Buffer.from(await file.arrayBuffer());
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, buffer);

  const [inserted] = await db
    .insert(reports)
    .values({
      title: data.title,
      description: data.description ?? null,
      category: data.category,
      year: data.year,
      filePath: relPath,
      fileSize: file.size,
      uploadedBy: admin.actorId,
    })
    .returning({ id: reports.id });

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.actorId,
    action: "report.create",
    resourceType: "report",
    resourceId: inserted.id,
    metadata: {
      title: data.title,
      category: data.category,
      year: data.year,
      fileSize: file.size,
      filePath: relPath,
    },
  });

  invalidate();
  redirect("/admin/reports?created=1");
}



export async function updateReport(
  _prev: ReportFormState,
  formData: FormData,
): Promise<ReportFormState> {
  const admin = await requireAdmin();
  const parsed = updateSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title"),
    description: formData.get("description"),
    category: formData.get("category"),
    year: formData.get("year"),
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
    .update(reports)
    .set({
      title: data.title,
      description: data.description ?? null,
      category: data.category,
      year: data.year,
    })
    .where(eq(reports.id, data.id));

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.actorId,
    action: "report.update",
    resourceType: "report",
    resourceId: data.id,
    metadata: {
      title: data.title,
      category: data.category,
      year: data.year,
    },
  });

  invalidate();
  return { status: "success", message: "Metadata laporan berhasil disimpan." };
}

export async function deleteReport(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("id"));
  const existing = await db.query.reports.findFirst({
    where: eq(reports.id, id),
    columns: { id: true, title: true, filePath: true },
  });
  if (!existing) {
    redirect("/admin/reports?error=not-found");
  }

  // Delete DB row first; if the row is gone but the file isn't, the orphan
  // is cheap to clean up. Order matters: a stale row pointing at a missing
  // file would 404 on the public page.
  await db.delete(reports).where(eq(reports.id, id));
  try {
    const absPath = path.join(process.cwd(), "public", existing.filePath);
    await unlink(absPath);
  } catch (err) {
    console.error("[reports] failed to delete file:", existing.filePath, err);
  }

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.actorId,
    action: "report.delete",
    resourceType: "report",
    resourceId: id,
    metadata: { title: existing.title, filePath: existing.filePath },
  });

  invalidate();
  redirect("/admin/reports?deleted=1");
}
