"use server";

import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth-helpers";
import { writeAudit } from "@/lib/audit";
import { getBlogArticleBySlug } from "@/lib/blog";
import { BLOG_CATEGORIES } from "@/lib/blog-types";
import {
  deleteArticle,
  formatDateIndonesian,
  saveArticle,
  slugify,
  uniqueSlug,
} from "@/lib/blog-writer";

const baseSchema = z.object({
  title: z.string().trim().min(3, "Judul minimal 3 karakter").max(200),
  category: z.enum(BLOG_CATEGORIES),
  excerpt: z
    .string()
    .trim()
    .min(20, "Excerpt minimal 20 karakter")
    .max(500, "Maksimal 500 karakter"),
  body: z
    .string()
    .trim()
    .min(50, "Isi minimal 50 karakter")
    .max(80000, "Terlalu panjang"),
  author: z.string().trim().min(2, "Wajib diisi").max(120),
  image: z.string().trim().max(500).optional().or(z.literal("")),
  featured: z
    .string()
    .optional()
    .transform((v) => v === "on" || v === "true"),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format harus YYYY-MM-DD"),
});

const updateSchema = baseSchema.extend({
  id: z.string().min(1),
});

export type BlogFormState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
};

export async function createBlogPost(
  _prev: BlogFormState,
  formData: FormData,
): Promise<BlogFormState> {
  const admin = await requireAdmin();
  const parsed = baseSchema.safeParse({
    title: formData.get("title"),
    category: formData.get("category"),
    excerpt: formData.get("excerpt"),
    body: formData.get("body"),
    author: formData.get("author"),
    image: formData.get("image"),
    featured: formData.get("featured"),
    date: formData.get("date"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Periksa kembali isian formulir.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;
  const slug = await uniqueSlug(slugify(data.title));
  const today = new Date().toISOString().slice(0, 10);

  await saveArticle({
    id: slug,
    wpId: 0,
    title: data.title,
    category: data.category,
    date: formatDateIndonesian(data.date),
    dateISO: data.date,
    excerpt: data.excerpt,
    contentMarkdown: data.body,
    featured: data.featured,
    image: data.image || "",
    author: data.author,
    sourceUrl: "",
    modifiedISO: today,
  });

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.userId,
    action: "blog.create",
    resourceType: "blog",
    resourceId: slug,
    metadata: { title: data.title, category: data.category },
  });

  redirect(`/admin/blog/${slug}/edit?created=1`);
}

export async function updateBlogPost(
  _prev: BlogFormState,
  formData: FormData,
): Promise<BlogFormState> {
  const admin = await requireAdmin();
  const parsed = updateSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title"),
    category: formData.get("category"),
    excerpt: formData.get("excerpt"),
    body: formData.get("body"),
    author: formData.get("author"),
    image: formData.get("image"),
    featured: formData.get("featured"),
    date: formData.get("date"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Periksa kembali isian formulir.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;
  const existing = await getBlogArticleBySlug(data.id);
  if (!existing) {
    return { status: "error", message: "Artikel tidak ditemukan." };
  }
  const today = new Date().toISOString().slice(0, 10);

  await saveArticle({
    id: existing.id,
    wpId: existing.wpId,
    title: data.title,
    category: data.category,
    date: formatDateIndonesian(data.date),
    dateISO: data.date,
    excerpt: data.excerpt,
    contentMarkdown: data.body,
    featured: data.featured,
    image: data.image || "",
    author: data.author,
    sourceUrl: existing.sourceUrl,
    modifiedISO: today,
  });

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.userId,
    action: "blog.update",
    resourceType: "blog",
    resourceId: existing.id,
    metadata: { title: data.title, category: data.category },
  });

  return { status: "success", message: "Artikel berhasil disimpan." };
}

export type UploadResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

const ALLOWED_IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif"]);
const MAX_IMAGE_BYTES = 5_000_000; // 5 MB

/**
 * Upload an image into public/blog/images/<year>/<month>/<basename>-<rand>.<ext>.
 * Called directly from client components via the React server-action import.
 * Validates the MIME prefix, byte size, and extension. Writes an audit entry.
 */
export async function uploadBlogImage(
  formData: FormData,
): Promise<UploadResult> {
  const admin = await requireAdmin();

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "Tidak ada file." };
  }
  if (file.size === 0) {
    return { ok: false, error: "File kosong." };
  }
  if (!file.type.startsWith("image/")) {
    return { ok: false, error: "Hanya gambar yang diperbolehkan." };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: "Ukuran maksimal 5 MB." };
  }

  const extMatch = file.name.match(/\.([a-z0-9]+)$/i);
  const ext = extMatch?.[1].toLowerCase() ?? "";
  if (!ALLOWED_IMAGE_EXTS.has(ext)) {
    return {
      ok: false,
      error: `Tipe file tidak didukung. Gunakan: ${[...ALLOWED_IMAGE_EXTS].join(", ")}.`,
    };
  }

  const baseName =
    file.name
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "image";

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const stamp = Math.random().toString(36).slice(2, 8);
  const filename = `${baseName}-${stamp}.${ext}`;
  const relPath = `/blog/images/${year}/${month}/${filename}`;
  const absPath = path.join(process.cwd(), "public", relPath);

  const buffer = Buffer.from(await file.arrayBuffer());
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, buffer);

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.userId,
    action: "blog.upload_image",
    resourceType: "blog_image",
    resourceId: filename,
    metadata: { path: relPath, size: file.size, type: file.type },
  });

  return { ok: true, path: relPath };
}

export async function deleteBlogPost(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const slug = String(formData.get("slug"));
  const existing = await getBlogArticleBySlug(slug);
  if (!existing) {
    redirect("/admin/blog?error=not-found");
  }
  await deleteArticle(slug);
  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.userId,
    action: "blog.delete",
    resourceType: "blog",
    resourceId: slug,
    metadata: { title: existing.title },
  });
  redirect("/admin/blog?deleted=1");
}
