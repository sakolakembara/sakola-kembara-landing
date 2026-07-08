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
import {
  adminUsers,
  resourceCategory,
  resourceContentType,
  siteResources,
} from "@/lib/db/schema";

const MAX_BYTES = 25_000_000; // 25 MB

function slugSafe(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "resource"
  );
}

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
  revalidateTag("site-resources", "max");
  revalidatePath("/admin/resources");
  revalidatePath("/gabung-siswa/docs");
  revalidatePath("/gabung-siswa/form");
}

const baseSchema = z
  .object({
    title: z.string().trim().min(2, "Judul minimal 2 karakter").max(200),
    description: z
      .string()
      .trim()
      .max(1000, "Deskripsi maksimal 1000 karakter")
      .optional()
      .or(z.literal("")),
    category: z.enum(resourceCategory),
    displayOrder: z.coerce
      .number({ invalid_type_error: "Wajib diisi" })
      .int()
      .min(0, "Tidak boleh negatif")
      .max(9999, "Maksimal 9999"),
    contentType: z.enum(resourceContentType),
    externalUrl: z
      .string()
      .trim()
      .max(500)
      .url("Format URL tidak valid")
      .optional()
      .or(z.literal("")),
    bodyText: z
      .string()
      .trim()
      .max(10_000, "Teks maksimal 10.000 karakter")
      .optional()
      .or(z.literal("")),
    notes: z
      .string()
      .trim()
      .max(500)
      .optional()
      .or(z.literal("")),
  })
  .superRefine((data, ctx) => {
    if (data.contentType === "url" && !data.externalUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "URL wajib diisi untuk tipe Link Eksternal.",
        path: ["externalUrl"],
      });
    }
    if (data.contentType === "text" && !data.bodyText) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Isi teks yang bisa disalin.",
        path: ["bodyText"],
      });
    }
  });

const updateSchema = baseSchema.and(z.object({ id: z.string().uuid() }));

export type ResourceFormState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
};

async function saveFileFromForm(
  file: File | null,
  titleForSlug: string,
): Promise<{ path: string; size: number } | null> {
  if (!file || file.size === 0) return null;
  if (file.size > MAX_BYTES) {
    throw new Error("Ukuran file maksimal 25 MB.");
  }
  const extMatch = file.name.match(/\.([a-z0-9]+)$/i);
  const ext = extMatch?.[1].toLowerCase() ?? "bin";
  const stamp = Math.random().toString(36).slice(2, 8);
  const filename = `${slugSafe(titleForSlug)}-${stamp}.${ext}`;
  const relPath = `/resources/${filename}`;
  const absPath = path.join(process.cwd(), "public", relPath);
  const buffer = Buffer.from(await file.arrayBuffer());
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, buffer);
  return { path: relPath, size: file.size };
}

async function unlinkIfLocal(rel: string | null) {
  if (!rel || !rel.startsWith("/resources/")) return;
  try {
    await unlink(path.join(process.cwd(), "public", rel));
  } catch (err) {
    console.error("[resources] file cleanup failed:", err);
  }
}

export async function createResource(
  _prev: ResourceFormState,
  formData: FormData,
): Promise<ResourceFormState> {
  const admin = await requireAdmin();
  const parsed = baseSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    category: formData.get("category"),
    displayOrder: formData.get("displayOrder"),
    contentType: formData.get("contentType"),
    externalUrl: formData.get("externalUrl"),
    bodyText: formData.get("bodyText"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Periksa kembali isian formulir.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  let filePath: string | null = null;
  let fileSize: number | null = null;
  if (data.contentType === "file") {
    const raw = formData.get("file");
    const file = raw instanceof File ? raw : null;
    if (!file || file.size === 0) {
      return {
        status: "error",
        message: "Upload file untuk tipe File.",
        fieldErrors: { file: ["File wajib diupload."] },
      };
    }
    try {
      const uploaded = await saveFileFromForm(file, data.title);
      if (uploaded) {
        filePath = uploaded.path;
        fileSize = uploaded.size;
      }
    } catch (err) {
      return {
        status: "error",
        message: err instanceof Error ? err.message : "Upload gagal.",
        fieldErrors: { file: ["Upload gagal."] },
      };
    }
  }

  const [inserted] = await db
    .insert(siteResources)
    .values({
      title: data.title,
      description: data.description || null,
      category: data.category,
      displayOrder: data.displayOrder,
      contentType: data.contentType,
      filePath,
      fileSize,
      externalUrl:
        data.contentType === "url" ? (data.externalUrl || null) : null,
      bodyText: data.contentType === "text" ? (data.bodyText || null) : null,
      notes: data.notes || null,
      updatedBy: admin.actorId,
    })
    .returning({ id: siteResources.id });

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.actorId,
    action: "resource.create",
    resourceType: "site_resource",
    resourceId: inserted.id,
    metadata: {
      title: data.title,
      category: data.category,
      contentType: data.contentType,
    },
  });

  invalidate();
  redirect("/admin/resources?created=1");
}

export async function updateResource(
  _prev: ResourceFormState,
  formData: FormData,
): Promise<ResourceFormState> {
  const admin = await requireAdmin();
  const parsed = updateSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title"),
    description: formData.get("description"),
    category: formData.get("category"),
    displayOrder: formData.get("displayOrder"),
    contentType: formData.get("contentType"),
    externalUrl: formData.get("externalUrl"),
    bodyText: formData.get("bodyText"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Periksa kembali isian formulir.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  const existing = await db.query.siteResources.findFirst({
    where: eq(siteResources.id, data.id),
  });
  if (!existing) {
    return { status: "error", message: "Berkas tidak ditemukan." };
  }

  // Handle file swap / removal based on content type.
  let nextFilePath: string | null = existing.filePath;
  let nextFileSize: number | null = existing.fileSize;

  const removeFile = formData.get("removeFile") === "on";
  const rawFile = formData.get("file");
  const uploadedFile = rawFile instanceof File && rawFile.size > 0 ? rawFile : null;

  if (data.contentType !== "file") {
    // Switching away from file — drop any existing upload.
    await unlinkIfLocal(existing.filePath);
    nextFilePath = null;
    nextFileSize = null;
  } else {
    // Still file: either replace, remove, or keep existing.
    if (uploadedFile) {
      try {
        const uploaded = await saveFileFromForm(uploadedFile, data.title);
        if (uploaded) {
          await unlinkIfLocal(existing.filePath);
          nextFilePath = uploaded.path;
          nextFileSize = uploaded.size;
        }
      } catch (err) {
        return {
          status: "error",
          message: err instanceof Error ? err.message : "Upload gagal.",
          fieldErrors: { file: ["Upload gagal."] },
        };
      }
    } else if (removeFile) {
      await unlinkIfLocal(existing.filePath);
      nextFilePath = null;
      nextFileSize = null;
    }
    if (!nextFilePath) {
      return {
        status: "error",
        message: "Upload file untuk tipe File.",
        fieldErrors: { file: ["File wajib diupload."] },
      };
    }
  }

  await db
    .update(siteResources)
    .set({
      title: data.title,
      description: data.description || null,
      category: data.category,
      displayOrder: data.displayOrder,
      contentType: data.contentType,
      filePath: nextFilePath,
      fileSize: nextFileSize,
      externalUrl:
        data.contentType === "url" ? (data.externalUrl || null) : null,
      bodyText: data.contentType === "text" ? (data.bodyText || null) : null,
      notes: data.notes || null,
      updatedBy: admin.actorId,
      updatedAt: new Date(),
    })
    .where(eq(siteResources.id, data.id));

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.actorId,
    action: "resource.update",
    resourceType: "site_resource",
    resourceId: data.id,
    metadata: {
      title: data.title,
      category: data.category,
      contentType: data.contentType,
    },
  });

  invalidate();
  return {
    status: "success",
    message: "Perubahan tersimpan.",
  };
}

export async function deleteResource(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("id"));
  const existing = await db.query.siteResources.findFirst({
    where: eq(siteResources.id, id),
  });
  if (!existing) redirect("/admin/resources");

  await db.delete(siteResources).where(eq(siteResources.id, id));
  await unlinkIfLocal(existing!.filePath);

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.actorId,
    action: "resource.delete",
    resourceType: "site_resource",
    resourceId: id,
    metadata: { title: existing!.title, category: existing!.category },
  });

  invalidate();
  redirect("/admin/resources?deleted=1");
}
