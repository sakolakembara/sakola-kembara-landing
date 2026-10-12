import { getBlogArticlesSorted } from "@/lib/blog";
import { BLOG_PAGE_SIZE, buildBlogIndex } from "@/lib/blog-types";
import { CACHE_CONTENT, publicJson } from "@/lib/public-api/http";
import { toPublicBlogSummary } from "@/lib/public-api/serializers";
import type { BlogListResponse } from "@/lib/public-api/types";

// Runtime-only; see the note in ../team/route.ts.
export const dynamic = "force-dynamic";

const MAX_PAGE_SIZE = 50;

/** Integer query value; anything else (missing, "abc", "1.5x") is the fallback. */
function intParam(value: string | null, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isNaN(n) ? fallback : n;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  // Same leniency as /blog?page=: an out-of-range page is clamped, not an error.
  const pageSize = Math.min(
    Math.max(1, intParam(params.get("pageSize"), BLOG_PAGE_SIZE)),
    MAX_PAGE_SIZE,
  );
  const index = buildBlogIndex(
    await getBlogArticlesSorted(),
    intParam(params.get("page"), 1),
    pageSize,
  );

  return publicJson<BlogListResponse>(
    {
      featured: index.featured ? toPublicBlogSummary(index.featured) : null,
      articles: index.items.map(toPublicBlogSummary),
      page: index.page,
      pageSize,
      total: index.total,
      totalPages: index.totalPages,
    },
    CACHE_CONTENT,
  );
}
