"use client";

import { motion } from "framer-motion";
import { Download, FileText } from "lucide-react";
import { PageHero } from "@/components/layout/page-hero";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Heading } from "@/components/ui/heading";
import type { Report } from "@/lib/db/schema";
import {
  formatBytes,
  formatAcademicYear,
  REPORT_CATEGORY_LABEL,
  REPORT_CATEGORY_TONE,
} from "@/lib/report-types";
import { Tag } from "@/components/ui/tag";

interface LaporanContentProps {
  grouped: { year: string; reports: Report[] }[];
}

export function LaporanContent({ grouped }: LaporanContentProps) {
  const totalReports = grouped.reduce((sum, g) => sum + g.reports.length, 0);

  return (
    <main className="min-h-screen bg-gray-50">
      <PageHero
        title="Laporan"
        lead="Komitmen kami untuk transparansi. Laporan tahunan, keuangan, dampak, dan donasi tersedia untuk diunduh dan dipelajari oleh donor, mitra, dan publik."
      />

      {/* Reports listing */}
      <section className="py-16 md:py-20">
        <Container>
          {totalReports === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="bg-white rounded-2xl border border-gray-200 p-12 text-center"
            >
              <FileText size={32} className="mx-auto text-gray-300 mb-4" />
              <Heading level="card" as="h2" className="text-gray-900 mb-2">
                Laporan akan segera tersedia
              </Heading>
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
                    <Heading level="subsection" className="text-gray-900">
                      {formatAcademicYear(year)}
                    </Heading>
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
                          <Tag tone={REPORT_CATEGORY_TONE[r.category]} size="sm">
                            {REPORT_CATEGORY_LABEL[r.category]}
                          </Tag>
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
                        <Button href={r.filePath} target="_blank" rel="noopener noreferrer">
                          <Download size={16} />
                          Unduh Laporan
                        </Button>
                      </article>
                    ))}
                  </div>
                </motion.section>
              ))}
            </div>
          )}
        </Container>
      </section>

      {/* Trust footer */}
      <section className="py-16 bg-white border-t border-gray-100">
        <Container size="reading" className="text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <Heading level="subsection" className="text-gray-900 mb-3">
              Punya pertanyaan tentang laporan kami?
            </Heading>
            <p className="text-gray-600 mb-6">
              Tim kami senang membantu menjelaskan angka-angka di balik
              laporan ini. Hubungi kami untuk diskusi lebih lanjut.
            </p>
            <Button href="/kontak">Hubungi Tim Kami</Button>
          </motion.div>
        </Container>
      </section>
    </main>
  );
}
