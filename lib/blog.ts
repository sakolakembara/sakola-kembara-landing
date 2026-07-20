import "server-only";
import { readFile, readdir } from "fs/promises";
import path from "path";
import matter from "gray-matter";
import { unstable_cache } from "next/cache";
import type { BlogArticle } from "@/lib/blog-types";

// Blog content lives in content/blog/<slug>.md and is the source of truth.
// We read directly from the filesystem (cached via unstable_cache + the "blog"
// tag) so admin writes from /admin/blog show up immediately after the action
// calls revalidateTag("blog"). lib/blog-posts.json is no longer the runtime
// source — it's kept around as a legacy build-time artifact for now.
//
// This module is server-only: it imports `fs/promises`. Anything that needs to
// be importable from a client component should go in lib/blog-types.ts.

export { BLOG_CATEGORIES, cleanExcerpt } from "@/lib/blog-types";
export type { BlogArticle, BlogCategory } from "@/lib/blog-types";

const BLOG_DIR = path.join(process.cwd(), "content/blog");

async function readAllArticles(): Promise<BlogArticle[]> {
  const files = await readdir(BLOG_DIR);
  const mdFiles = files.filter((f) => f.endsWith(".md") && f !== "README.md");
  const articles = await Promise.all(
    mdFiles.map(async (f) => {
      const raw = await readFile(path.join(BLOG_DIR, f), "utf8");
      const { data, content } = matter(raw);
      return {
        id: (data.id as string) ?? f.replace(/\.md$/, ""),
        wpId: (data.wpId as number) ?? 0,
        category: (data.category as string) ?? "Uncategorized",
        date: (data.date as string) ?? "",
        dateISO: (data.dateISO as string) ?? "1970-01-01",
        title: (data.title as string) ?? "(untitled)",
        excerpt: (data.excerpt as string) ?? "",
        contentMarkdown: content.trim(),
        featured: Boolean(data.featured),
        image: (data.image as string) ?? "",
        author: (data.author as string) ?? "Sakola Kembara",
        sourceUrl: (data.sourceUrl as string) ?? "",
        modifiedISO:
          (data.modifiedISO as string) ??
          (data.dateISO as string) ??
          "1970-01-01",
      } satisfies BlogArticle;
    }),
  );
  return articles;
}

const getCachedArticles = unstable_cache(
  () => readAllArticles(),
  ["blog-articles-fs"],
  { tags: ["blog"] },
);

export async function getAllArticles(): Promise<BlogArticle[]> {
  return getCachedArticles();
}

export async function getBlogArticlesSorted(): Promise<BlogArticle[]> {
  const all = await getCachedArticles();
  return [...all].sort(
    (a, b) => new Date(b.dateISO).getTime() - new Date(a.dateISO).getTime(),
  );
}

export async function getBlogArticleBySlug(
  slug: string,
): Promise<BlogArticle | null> {
  const all = await getCachedArticles();
  return all.find((a) => a.id === slug) ?? null;
}
