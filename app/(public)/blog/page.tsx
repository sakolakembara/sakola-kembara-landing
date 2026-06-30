import { getBlogArticlesSorted } from "@/lib/blog";
import { BlogIndex } from "./_blog-index";

export default async function BlogPage() {
  const sorted = await getBlogArticlesSorted();
  const featured = sorted.find((a) => a.featured) ?? sorted[0] ?? null;
  const others = sorted.filter((a) => a.id !== featured?.id);
  return <BlogIndex featured={featured} others={others} />;
}
