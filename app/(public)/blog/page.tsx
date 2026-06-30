"use client";

import { motion } from "framer-motion";
import { Calendar } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { getBlogArticlesSorted, cleanExcerpt } from "@/lib/blog";

export default function BlogPage() {
  const sortedArticles = getBlogArticlesSorted();
  const featuredArticle = sortedArticles.find((a) => a.featured) || sortedArticles[0];
  const otherArticles = sortedArticles.filter((a) => a.id !== featuredArticle?.id);

  return (
    <>
      <main className="min-h-screen bg-gray-50">
        {/* Hero Section */}
        <section className="bg-gradient-to-br from-primary-blue to-accent-navy text-white pt-32 pb-20">
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
                Ikuti perjalanan kami dalam membuka akses pendidikan. Cerita inspiratif,
                kegiatan terbaru, dan update dari Sakola Kembara.
              </p>
            </motion.div>
          </div>
        </section>

        {/* Featured Article */}
        {featuredArticle && (
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
                  href={`/blog/${featuredArticle.id}`}
                  className="group block bg-white rounded-3xl overflow-hidden shadow-lg hover:shadow-xl transition-all"
                >
                  <div className="grid md:grid-cols-2 gap-0">
                    <div className="h-[300px] md:h-[400px] relative overflow-hidden">
                      <Image
                        src={featuredArticle.image}
                        alt={featuredArticle.title}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                      <span className="absolute top-4 left-4 text-xs font-semibold text-white bg-primary-blue px-3 py-1.5 rounded-full">
                        {featuredArticle.category}
                      </span>
                    </div>
                    <div className="p-8 md:p-10 flex flex-col justify-center">
                      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
                        <Calendar size={14} />
                        {featuredArticle.date}
                      </div>
                      <h3 className="text-2xl md:text-3xl font-bold text-gray-900 mb-4 group-hover:text-primary-blue transition-colors">
                        {featuredArticle.title}
                      </h3>
                      <p className="text-gray-600 leading-relaxed mb-6">
                        {cleanExcerpt(featuredArticle.excerpt)}
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

        {/* All Articles Grid */}
        <section className="py-12 pb-24 bg-white">
          <div className="max-w-[1200px] mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
            >
              <h2 className="text-sm font-semibold text-primary-blue uppercase tracking-wider mb-6">
                Semua Artikel
              </h2>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                {otherArticles.map((article, index) => (
                  <motion.article
                    key={article.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: Math.min(0.1 + index * 0.05, 0.5) }}
                    className="group bg-gray-50 rounded-2xl overflow-hidden shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all"
                  >
                    <div className="h-[200px] relative overflow-hidden">
                      <Image
                        src={article.image}
                        alt={article.title}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                      />
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
            </motion.div>
          </div>
        </section>
      </main>
    </>
  );
}
