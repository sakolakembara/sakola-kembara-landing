import { getBlogArticleBySlug, getBlogArticlesSorted } from "@/lib/blog";
import { pickRelatedArticles } from "@/lib/blog-types";
import { renderBlogHtml } from "@/lib/public-api/blog-html";
import {
  CACHE_CONTENT,
  CACHE_NOT_FOUND,
  publicJson,
} from "@/lib/public-api/http";
import {
  toPublicBlogArticle,
  toPublicBlogSummary,
} from "@/lib/public-api/serializers";
import type { BlogArticleResponse } from "@/lib/public-api/types";

// Runtime-only; see the note in ../../team/route.ts.
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const article = await getBlogArticleBySlug(slug);
  if (!article) {
    return publicJson({ error: "not_found" }, CACHE_NOT_FOUND, 404);
  }

  const related = pickRelatedArticles(article, await getBlogArticlesSorted());
  return publicJson<BlogArticleResponse>(
    {
      article: toPublicBlogArticle(article, renderBlogHtml(article.contentMarkdown)),
      related: related.map(toPublicBlogSummary),
    },
    CACHE_CONTENT,
  );
}
