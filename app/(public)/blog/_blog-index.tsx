"use client";

import { motion } from "framer-motion";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { cleanExcerpt, type BlogArticle } from "@/lib/blog-types";

interface BlogIndexProps {
  featured: BlogArticle | null;
  others: BlogArticle[];
  currentPage: number;
  totalPages: number;
}

export function BlogIndex({
  featured,
  others,
  currentPage,
  totalPages,
}: BlogIndexProps) {
  return (
    <main className="min-h-screen bg-gray-50">
      <section className="bg-gradient-to-br from-primary-blue to-accent-navy text-white pb-20 pt-[var(--hero-top,8rem)]">
        <div className="max-w-[1200px] mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="font-[var(--font-display)] text-4xl md:text-5xl lg:text-6xl mb-4">
              Blog & Cerita
            </h1>
            <p className="text-lg md:text-xl text-white/90 max-w-[600px]">
              Ikuti perjalanan kami dalam membuka akses pendidikan. Cerita
              inspiratif, kegiatan terbaru, dan update dari Sakola Kembara.
            </p>
          </motion.div>
        </div>
      </section>

      {featured && (
        <section className="py-12">
          <div className="max-w-[1200px] mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <h2 className="text-sm font-semibold text-primary-blue uppercase tracking-wider mb-6">
                Artikel Terbaru
              </h2>
              <Link
                href={`/blog/${featured.id}`}
                className="group block bg-white rounded-3xl overflow-hidden shadow-lg hover:shadow-xl transition-all"
              >
                <div className="grid md:grid-cols-2 gap-0">
                  <div className="h-[300px] md:h-[400px] relative overflow-hidden">
                    {featured.image && (
                      <Image
                        src={featured.image}
                        alt={featured.title}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    )}
                    <span className="absolute top-4 left-4 text-xs font-semibold text-white bg-primary-blue px-3 py-1.5 rounded-full">
                      {featured.category}
                    </span>
                  </div>
                  <div className="p-8 md:p-10 flex flex-col justify-center">
                    <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
                      <Calendar size={14} />
                      {featured.date}
                    </div>
                    <h3 className="text-2xl md:text-3xl font-bold text-gray-900 mb-4 group-hover:text-primary-blue transition-colors">
                      {featured.title}
                    </h3>
                    <p className="text-gray-600 leading-relaxed mb-6">
                      {cleanExcerpt(featured.excerpt)}
                    </p>
                    <span className="inline-flex items-center gap-2 text-primary-blue font-semibold group-hover:underline">
                      Baca Selengkapnya
                      <span>→</span>
                    </span>
                  </div>
                </div>
              </Link>
            </motion.div>
          </div>
        </section>
      )}

      <section className="py-12 pb-24 bg-white">
        <div className="max-w-[1200px] mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            <div className="flex items-baseline justify-between mb-6 gap-4 flex-wrap">
              <h2 className="text-sm font-semibold text-primary-blue uppercase tracking-wider">
                Semua Artikel
              </h2>
              {totalPages > 1 && (
                <span className="text-xs text-gray-500">
                  Halaman {currentPage} dari {totalPages}
                </span>
              )}
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {others.map((article, index) => (
                <motion.article
                  key={article.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.5,
                    delay: Math.min(0.1 + index * 0.05, 0.5),
                  }}
                  className="group bg-gray-50 rounded-2xl overflow-hidden shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all"
                >
                  <div className="h-[200px] relative overflow-hidden">
                    {article.image && (
                      <Image
                        src={article.image}
                        alt={article.title}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    )}
                    <span className="absolute top-3 left-3 text-[11px] font-semibold text-white bg-primary-blue/90 px-2.5 py-1 rounded-full">
                      {article.category}
                    </span>
                  </div>
                  <div className="p-6">
                    <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
                      <Calendar size={12} />
                      {article.date}
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 mb-3 line-clamp-2 group-hover:text-primary-blue transition-colors">
                      {article.title}
                    </h3>
                    <p className="text-sm text-gray-600 line-clamp-2 mb-4">
                      {cleanExcerpt(article.excerpt)}
                    </p>
                    <Link
                      href={`/blog/${article.id}`}
                      className="inline-flex items-center gap-1 text-sm text-primary-blue font-semibold hover:underline"
                    >
                      Baca Selengkapnya
                      <span>→</span>
                    </Link>
                  </div>
                </motion.article>
              ))}
            </div>
            {totalPages > 1 && (
              <Pagination currentPage={currentPage} totalPages={totalPages} />
            )}
          </motion.div>
        </div>
      </section>
    </main>
  );
}

function Pagination({
  currentPage,
  totalPages,
}: {
  currentPage: number;
  totalPages: number;
}) {
  const pages = pageNumbers(currentPage, totalPages);
  const prevHref = currentPage > 1 ? hrefFor(currentPage - 1) : null;
  const nextHref = currentPage < totalPages ? hrefFor(currentPage + 1) : null;

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-center gap-2 mt-12 flex-wrap"
    >
      {prevHref ? (
        <Link
          href={prevHref}
          className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 hover:text-primary-blue rounded-lg border border-gray-200 hover:border-primary-blue transition-colors"
        >
          <ChevronLeft size={16} /> Sebelumnya
        </Link>
      ) : (
        <span className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-300 rounded-lg border border-gray-100">
          <ChevronLeft size={16} /> Sebelumnya
        </span>
      )}
      <div className="flex items-center gap-1">
        {pages.map((p, i) =>
          p === "…" ? (
            <span
              key={`gap-${i}`}
              className="px-2 text-sm text-gray-400 select-none"
            >
              …
            </span>
          ) : p === currentPage ? (
            <span
              key={p}
              aria-current="page"
              className="min-w-[36px] px-2 py-2 text-sm font-semibold text-white bg-primary-blue rounded-lg text-center"
            >
              {p}
            </span>
          ) : (
            <Link
              key={p}
              href={hrefFor(p)}
              className="min-w-[36px] px-2 py-2 text-sm font-medium text-gray-700 hover:text-primary-blue rounded-lg border border-gray-200 hover:border-primary-blue text-center transition-colors"
            >
              {p}
            </Link>
          ),
        )}
      </div>
      {nextHref ? (
        <Link
          href={nextHref}
          className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 hover:text-primary-blue rounded-lg border border-gray-200 hover:border-primary-blue transition-colors"
        >
          Berikutnya <ChevronRight size={16} />
        </Link>
      ) : (
        <span className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-300 rounded-lg border border-gray-100">
          Berikutnya <ChevronRight size={16} />
        </span>
      )}
    </nav>
  );
}

function hrefFor(page: number) {
  return page === 1 ? "/blog" : `/blog?page=${page}`;
}

function pageNumbers(
  current: number,
  total: number,
): (number | "…")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const out: (number | "…")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push("…");
  for (let p = start; p <= end; p++) out.push(p);
  if (end < total - 1) out.push("…");
  out.push(total);
  return out;
}
