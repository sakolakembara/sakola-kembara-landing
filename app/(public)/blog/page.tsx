import { getBlogArticlesSorted } from "@/lib/blog";
import { BLOG_PAGE_SIZE, buildBlogIndex } from "@/lib/blog-types";
import { BlogIndex } from "./_blog-index";

interface BlogPageProps {
  searchParams: Promise<{ page?: string }>;
}

export default async function BlogPage({ searchParams }: BlogPageProps) {
  const { page } = await searchParams;
  const sorted = await getBlogArticlesSorted();

  const requested = Number.parseInt(page ?? "1", 10);
  const index = buildBlogIndex(
    sorted,
    Number.isNaN(requested) ? 1 : requested,
    BLOG_PAGE_SIZE,
  );
  const featured = index.page === 1 ? index.featured : null;

  return (
    <BlogIndex
      featured={featured}
      others={index.items}
      currentPage={index.page}
      totalPages={index.totalPages}
    />
  );
}
