import { existsSync } from "fs";
import { unlink, writeFile } from "fs/promises";
import path from "path";
import matter from "gray-matter";
import { revalidatePath, revalidateTag } from "next/cache";
import type { BlogArticle } from "@/lib/blog-types";

const BLOG_DIR = path.join(process.cwd(), "content/blog");

const MONTHS_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/** "2026-05-21" → "21 Mei 2026". Falls back to input on parse failure. */
export function formatDateIndonesian(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateIso;
  return `${d.getUTCDate()} ${MONTHS_ID[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Lowercase, ASCII-fold, dash-separated. Strips diacritics. Length ≤ 80. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Append -2, -3, … until no file collides. Safe up to 1000 collisions. */
export async function uniqueSlug(base: string): Promise<string> {
  const safeBase = base || "post";
  let slug = safeBase;
  let n = 2;
  while (existsSync(path.join(BLOG_DIR, `${slug}.md`))) {
    slug = `${safeBase}-${n}`;
    n++;
    if (n > 1000) throw new Error("Could not generate unique slug");
  }
  return slug;
}

/**
 * Write a single article back to content/blog/<id>.md. Used by the admin
 * editor. Re-validates every public surface that renders blog data.
 */
export async function saveArticle(article: BlogArticle): Promise<void> {
  const frontmatter = {
    id: article.id,
    wpId: article.wpId,
    title: article.title,
    category: article.category,
    date: article.date,
    dateISO: article.dateISO,
    excerpt: article.excerpt,
    featured: article.featured,
    image: article.image,
    author: article.author,
    sourceUrl: article.sourceUrl,
    modifiedISO: article.modifiedISO,
  };
  const file = matter.stringify(article.contentMarkdown || "", frontmatter);
  const filePath = path.join(BLOG_DIR, `${article.id}.md`);
  await writeFile(filePath, file, "utf8");
  invalidateBlog(article.id);
}

export async function deleteArticle(slug: string): Promise<void> {
  const filePath = path.join(BLOG_DIR, `${slug}.md`);
  if (existsSync(filePath)) {
    await unlink(filePath);
  }
  invalidateBlog(slug);
}

function invalidateBlog(slug: string) {
  // Next 16: revalidateTag now takes a cache-life profile as 2nd arg.
  // "max" is the canonical "evict immediately" profile.
  revalidateTag("blog", "max");
  revalidatePath("/");
  revalidatePath("/blog");
  revalidatePath(`/blog/${slug}`);
  revalidatePath("/sitemap.xml");
}
