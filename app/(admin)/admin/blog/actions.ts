"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ALLOWED_DOMAIN, auth } from "@/auth";
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
import { db } from "@/lib/db";
import { adminUsers } from "@/lib/db/schema";

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
    actorId: admin.actorId,
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
    actorId: admin.actorId,
    action: "blog.update",
    resourceType: "blog",
    resourceId: existing.id,
    metadata: { title: data.title, category: data.category },
  });

  return { status: "success", message: "Artikel berhasil disimpan." };
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
    actorId: admin.actorId,
    action: "blog.delete",
    resourceType: "blog",
    resourceId: slug,
    metadata: { title: existing.title },
  });
  redirect("/admin/blog?deleted=1");
}
