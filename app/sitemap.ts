import type { MetadataRoute } from "next";
import { blogArticles } from "@/lib/blog";
import { programs } from "@/lib/data";
import { SITE_URL } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { path: "/", priority: 1.0, changeFrequency: "weekly" as const },
    { path: "/blog", priority: 0.9, changeFrequency: "weekly" as const },
    { path: "/donasi", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/gabung-siswa", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/tim", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/kontak", priority: 0.7, changeFrequency: "yearly" as const },
  ].map(({ path, priority, changeFrequency }) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  }));

  const programRoutes: MetadataRoute.Sitemap = programs.map((program) => ({
    url: `${SITE_URL}/program/${program.id}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  const blogRoutes: MetadataRoute.Sitemap = blogArticles.map((article) => ({
    url: `${SITE_URL}/blog/${article.id}`,
    lastModified: new Date(article.modifiedISO || article.dateISO),
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [...staticRoutes, ...programRoutes, ...blogRoutes];
}
