"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Download, FileText } from "lucide-react";
import type { Report } from "@/lib/db/schema";
import {
  formatBytes,
  formatAcademicYear,
  REPORT_CATEGORY_LABEL,
  REPORT_CATEGORY_PILL,
} from "@/lib/report-types";

interface LaporanContentProps {
  grouped: { year: string; reports: Report[] }[];
}

export function LaporanContent({ grouped }: LaporanContentProps) {
  const totalReports = grouped.reduce((sum, g) => sum + g.reports.length, 0);

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Hero */}
      <section className="bg-gradient-to-br from-primary-blue to-accent-navy text-white pt-[calc(var(--hero-top,8rem)_+_1.25rem)] md:pt-[calc(var(--hero-top,8rem)_+_2.5rem)] pb-14 md:pb-24">
        <div className="max-w-[1200px] mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="font-[family-name:var(--font-display)] text-3xl sm:text-4xl md:text-5xl lg:text-6xl mb-4">
              Laporan
            </h1>
            <p className="text-base md:text-xl text-white/90 max-w-[700px]">
              Komitmen kami untuk transparansi. Laporan tahunan, keuangan,
              dampak, dan donasi tersedia untuk diunduh dan dipelajari oleh
              donor, mitra, dan publik.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Reports listing */}
      <section className="py-16 md:py-20">
        <div className="max-w-[1100px] mx-auto px-6">
          {totalReports === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="bg-white rounded-2xl border border-gray-200 p-12 text-center"
            >
              <FileText size={32} className="mx-auto text-gray-300 mb-4" />
              <h2 className="text-xl font-bold text-gray-900 mb-2">
                Laporan akan segera tersedia
              </h2>
              <p className="text-gray-600 max-w-md mx-auto">
                Tim kami sedang menyiapkan laporan publik. Periksa kembali
                halaman ini dalam waktu dekat.
              </p>
            </motion.div>
          ) : (
            <div className="space-y-12">
              {grouped.map(({ year, reports }, yearIdx) => (
                <motion.section
                  key={year}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.2 + yearIdx * 0.1 }}
                >
                  <header className="mb-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h2 className="font-[family-name:var(--font-display)] text-3xl text-gray-900">
                      {formatAcademicYear(year)}
                    </h2>
                    <span className="text-sm text-gray-500">
                      {reports.length} laporan
                    </span>
                  </header>
                  <div className="grid md:grid-cols-2 gap-5">
                    {reports.map((r) => (
                      <article
                        key={r.id}
                        className="bg-white rounded-2xl border border-gray-100 p-6 hover:shadow-md hover:-translate-y-0.5 transition-all"
                      >
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <span
                            className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full border ${REPORT_CATEGORY_PILL[r.category]}`}
                          >
                            {REPORT_CATEGORY_LABEL[r.category]}
                          </span>
                          <FileText
                            size={20}
                            className="text-gray-300 shrink-0"
                          />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 mb-2 leading-snug">
                          {r.title}
                        </h3>
                        {r.description && (
                          <p className="text-sm text-gray-600 mb-3 leading-relaxed line-clamp-3">
                            {r.description}
                          </p>
                        )}
                        <div className="text-xs text-gray-500 mb-4">
                          PDF · {formatBytes(r.fileSize)}
                        </div>
                        <a
                          href={r.filePath}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-4 py-2 bg-primary-blue text-white text-sm font-semibold rounded-lg hover:bg-primary-blue-dark transition-colors"
                        >
                          <Download size={14} />
                          Unduh Laporan
                        </a>
                      </article>
                    ))}
                  </div>
                </motion.section>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Trust footer */}
      <section className="py-16 bg-white border-t border-gray-100">
        <div className="max-w-[800px] mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="font-[family-name:var(--font-display)] text-2xl md:text-3xl text-gray-900 mb-3">
              Punya pertanyaan tentang laporan kami?
            </h2>
            <p className="text-gray-600 mb-6">
              Tim kami senang membantu menjelaskan angka-angka di balik
              laporan ini. Hubungi kami untuk diskusi lebih lanjut.
            </p>
            <Link
              href="/kontak"
              className="inline-flex items-center px-6 py-3 bg-primary-blue text-white font-semibold rounded-lg hover:bg-primary-blue-dark transition-colors"
            >
              Hubungi Tim Kami
            </Link>
          </motion.div>
        </div>
      </section>
    </main>
  );
}
