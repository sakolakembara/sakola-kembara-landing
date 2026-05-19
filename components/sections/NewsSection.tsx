"use client";

import { motion } from "framer-motion";
import { useInView } from "framer-motion";
import { useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { newsArticles } from "@/lib/data";

export default function NewsSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  // Only show first 3 articles
  const displayArticles = newsArticles.slice(0, 3);

  return (
    <section className="py-16 bg-white" id="blog">
      <div className="max-w-[1200px] mx-auto px-6" ref={ref}>
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="flex justify-between items-center mb-8"
        >
          <div>
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-primary-blue uppercase tracking-wider mb-2">
              <span className="w-2 h-2 bg-secondary-yellow rounded-full" />
              Blog
            </div>
            <h2 className="font-[var(--font-display)] text-3xl md:text-4xl text-gray-900">
              Cerita & Inspirasi
            </h2>
          </div>
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 text-[15px] font-semibold text-primary-blue hover:underline"
          >
            Lihat Semua
            <ArrowRight size={16} />
          </Link>
        </motion.div>

        {/* Compact Article List */}
        <div className="grid md:grid-cols-3 gap-6">
          {displayArticles.map((article, index) => (
            <motion.article
              key={article.id}
              initial={{ opacity: 0, y: 20 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.1 + index * 0.1 }}
              className="group bg-gray-50 rounded-xl overflow-hidden border border-gray-100 hover:shadow-lg hover:-translate-y-1 transition-all"
            >
              <div className="h-[160px] relative overflow-hidden">
                <Image
                  src={article.image}
                  alt={article.title}
                  fill
                  className="object-cover group-hover:scale-105 transition-transform duration-300"
                  unoptimized
                />
                <span className="absolute top-3 left-3 text-[10px] font-semibold text-white bg-primary-blue/90 px-2 py-1 rounded">
                  {article.category}
                </span>
              </div>
              <div className="p-4">
                <p className="text-xs text-gray-400 mb-2">{article.date}</p>
                <h3 className="text-sm font-semibold text-gray-900 leading-tight line-clamp-2 group-hover:text-primary-blue transition-colors">
                  {article.title}
                </h3>
              </div>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
