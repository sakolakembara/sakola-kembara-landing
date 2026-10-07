"use client";

import { motion } from "framer-motion";
import { useInView } from "framer-motion";
import { useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { SectionHeader } from "@/components/ui/section-header";
import { Tag } from "@/components/ui/tag";
import type { BlogArticle } from "@/lib/blog-types";

interface NewsSectionProps {
  articles: BlogArticle[];
}

export default function NewsSection({ articles }: NewsSectionProps) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  const displayArticles = articles;

  return (
    <section className="py-14 md:py-16 bg-white" id="blog">
      <Container ref={ref}>
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-8"
        >
          <SectionHeader align="left" eyebrow="Blog" title="Cerita & Inspirasi" />
          <Button href="/blog" variant="outline" className="self-start sm:self-auto">
            Lihat Semua
          </Button>
        </motion.div>

        {/* Compact Article List */}
        <div className="grid md:grid-cols-3 gap-6">
          {displayArticles.map((article, index) => (
            <motion.article
              key={article.id}
              initial={{ opacity: 0, y: 20 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.1 + index * 0.1 }}
            >
              <Link
                href={`/blog/${article.id}`}
                className="group block bg-gray-50 rounded-xl overflow-hidden border border-gray-100 hover:shadow-lg hover:-translate-y-1 transition-all"
              >
                <div className="h-[160px] relative overflow-hidden">
                  <Image
                    src={article.image}
                    alt={article.title}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <Tag size="sm" className="absolute top-3 left-3">
                    {article.category}
                  </Tag>
                </div>
                <div className="p-4">
                  <p className="text-xs text-gray-400 mb-2">{article.date}</p>
                  <h3 className="text-sm font-semibold text-gray-900 leading-tight line-clamp-2 group-hover:text-primary-blue transition-colors">
                    {article.title}
                  </h3>
                </div>
              </Link>
            </motion.article>
          ))}
        </div>
      </Container>
    </section>
  );
}
