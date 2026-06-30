import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Calendar, User, ArrowLeft } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import BlogPostContent from "@/components/blog/BlogPostContent";
import {
  blogArticles,
  getBlogArticleBySlug,
  getBlogArticlesSorted,
  cleanExcerpt,
} from "@/lib/blog";
import { articleJsonLd, buildPageMetadata, jsonLdScript } from "@/lib/seo";

interface BlogDetailPageProps {
  params: Promise<{ id: string }>;
}

export async function generateStaticParams() {
  return blogArticles.map((article) => ({ id: article.id }));
}

export async function generateMetadata({
  params,
}: BlogDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const article = getBlogArticleBySlug(id);
  if (!article) {
    return { title: "Artikel tidak ditemukan" };
  }
  return buildPageMetadata({
    title: article.title,
    description: cleanExcerpt(article.excerpt),
    path: `/blog/${id}`,
    ogImage: article.image,
  });
}

export default async function BlogDetailPage({ params }: BlogDetailPageProps) {
  const { id } = await params;
  const article = getBlogArticleBySlug(id);

  if (!article) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen flex items-center justify-center bg-gray-50 pt-24">
          <div className="text-center px-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-4">
              Artikel tidak ditemukan
            </h1>
            <Link href="/blog" className="text-primary-blue font-semibold hover:underline">
              Kembali ke Blog
            </Link>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  const sorted = getBlogArticlesSorted();
  const related = sorted
    .filter((a) => a.id !== article.id)
    .filter(
      (a) =>
        a.category === article.category ||
        Math.abs(
          new Date(a.dateISO).getTime() - new Date(article.dateISO).getTime()
        ) <
          1000 * 60 * 60 * 24 * 180
    )
    .slice(0, 3);

  const fallbackRelated = sorted.filter((a) => a.id !== article.id).slice(0, 3);
  const relatedArticles = related.length > 0 ? related : fallbackRelated;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(articleJsonLd(article)) }}
      />
      <Navbar />
      <main className="min-h-screen bg-gray-50">
        <section className="relative h-[320px] md:h-[420px] pt-20">
          {article.image ? (
            <Image
              src={article.image}
              alt={article.title}
              fill
              className="object-cover"
              unoptimized
              priority
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-primary-blue to-accent-navy" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/50 to-black/20" />
          <div className="absolute inset-0 flex items-end">
            <div className="max-w-[800px] mx-auto px-6 pb-10 w-full">
              <Link
                href="/blog"
                className="inline-flex items-center gap-2 text-white/90 text-sm font-medium mb-4 hover:text-white transition-colors"
              >
                <ArrowLeft size={16} />
                Kembali ke Blog
              </Link>
              <span className="inline-block text-xs font-semibold text-white bg-primary-blue px-3 py-1 rounded-full mb-3">
                {article.category}
              </span>
              <h1 className="font-[var(--font-display)] text-3xl md:text-4xl lg:text-5xl text-white leading-tight">
                {article.title}
              </h1>
              <div className="flex flex-wrap items-center gap-4 mt-4 text-sm text-white/85">
                <span className="inline-flex items-center gap-1.5">
                  <Calendar size={14} />
                  {article.date}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <User size={14} />
                  {article.author}
                </span>
              </div>
            </div>
          </div>
        </section>

        <article className="py-12 pb-16">
          <div className="max-w-[800px] mx-auto px-6">
            <div className="bg-white rounded-2xl shadow-sm p-6 md:p-10 -mt-8 relative z-10">
              <BlogPostContent
                markdown={article.contentMarkdown}
                html={article.content}
              />
            </div>
          </div>
        </article>

        {relatedArticles.length > 0 && (
          <section className="py-12 pb-24 bg-white border-t border-gray-100">
            <div className="max-w-[1200px] mx-auto px-6">
              <h2 className="text-sm font-semibold text-primary-blue uppercase tracking-wider mb-6">
                Artikel Lainnya
              </h2>
              <div className="grid md:grid-cols-3 gap-6">
                {relatedArticles.map((item) => (
                  <Link
                    key={item.id}
                    href={`/blog/${item.id}`}
                    className="group bg-gray-50 rounded-xl overflow-hidden border border-gray-100 hover:shadow-md transition-all"
                  >
                    <div className="h-[160px] relative overflow-hidden">
                      {item.image ? (
                        <Image
                          src={item.image}
                          alt={item.title}
                          fill
                          className="object-cover group-hover:scale-105 transition-transform duration-300"
                          unoptimized
                        />
                      ) : (
                        <div className="absolute inset-0 bg-primary-blue/10" />
                      )}
                      <span className="absolute top-3 left-3 text-[10px] font-semibold text-white bg-primary-blue/90 px-2 py-1 rounded">
                        {item.category}
                      </span>
                    </div>
                    <div className="p-4">
                      <p className="text-xs text-gray-400 mb-2">{item.date}</p>
                      <h3 className="text-sm font-semibold text-gray-900 line-clamp-2 group-hover:text-primary-blue transition-colors">
                        {item.title}
                      </h3>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>
      <Footer />
    </>
  );
}
