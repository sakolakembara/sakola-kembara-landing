import { getBlogArticlesSorted } from "@/lib/blog";
import { BlogIndex } from "./_blog-index";

const PAGE_SIZE = 15;

interface BlogPageProps {
  searchParams: Promise<{ page?: string }>;
}

export default async function BlogPage({ searchParams }: BlogPageProps) {
  const { page } = await searchParams;
  const sorted = await getBlogArticlesSorted();

  const featuredArticle = sorted.find((a) => a.featured) ?? sorted[0] ?? null;
  const grid = sorted.filter((a) => a.id !== featuredArticle?.id);

  const totalPages = Math.max(1, Math.ceil(grid.length / PAGE_SIZE));
  const requested = Number.parseInt(page ?? "1", 10);
  const currentPage = Math.min(
    Math.max(1, Number.isNaN(requested) ? 1 : requested),
    totalPages,
  );
  const pageItems = grid.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const featured = currentPage === 1 ? featuredArticle : null;

  return (
    <BlogIndex
      featured={featured}
      others={pageItems}
      currentPage={currentPage}
      totalPages={totalPages}
    />
  );
}
