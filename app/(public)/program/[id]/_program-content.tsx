"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { CheckCircle2, Clock, Download, FileText } from "lucide-react";
import { programs } from "@/lib/data";
import type { GalleryPhoto } from "@/lib/gallery";

interface ProgramContentProps {
  programId: string;
  /** Read from disk by the server page — see lib/gallery.ts. */
  gallery: GalleryPhoto[];
}

export default function ProgramContent({
  programId,
  gallery,
}: ProgramContentProps) {

  const program = programs.find((p) => p.id === programId);

  if (!program) {
    return (
      <>
        <main className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-4">
              Program tidak ditemukan
            </h1>
            <Link
              href="/#activities"
              className="text-primary-blue hover:underline"
            >
              Kembali ke halaman utama
            </Link>
          </div>
        </main>
      </>
    );
  }

  const currentIndex = programs.findIndex((p) => p.id === programId);
  const nextProgram =
    currentIndex < programs.length - 1 ? programs[currentIndex + 1] : null;

  return (
    <>
      <main className="min-h-screen bg-white">
        {/* Shared hero: the three stages read as one journey. The page's h1 is
            the stage title below, so each URL keeps its own heading. */}
        <section className="bg-gradient-to-br from-primary-blue to-accent-navy text-white pt-[var(--hero-top,8rem)] pb-28 md:pb-32">
          <div className="max-w-[1200px] mx-auto px-6 text-center">
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-secondary-yellow uppercase tracking-wider mb-4">
              <span className="w-2 h-2 bg-secondary-yellow rounded-full" />
              Program Kami
            </div>
            <p className="font-[family-name:var(--font-display)] text-[28px] sm:text-4xl md:text-[44px] leading-tight max-w-[760px] mx-auto text-balance">
              Apa saja yang dilalui penerima manfaat Sakola Kembara?
            </p>
          </div>
        </section>

        {/* Stage tabs. Each tab is a link to that stage's own URL, so stages
            stay shareable, server-rendered, and work with Back. */}
        <div className="max-w-[1200px] mx-auto px-6 -mt-20 md:-mt-24 relative z-10">
          <nav
            aria-label="Tahapan program"
            className="bg-white rounded-2xl border border-gray-100 shadow-xl shadow-primary-blue/10 px-3 py-5 sm:px-8 sm:py-7"
          >
            <ol className="relative grid grid-cols-3 gap-2 sm:gap-4">
              {/* Connector from the first circle's centre to the last one's */}
              <span
                aria-hidden
                className="absolute top-5 sm:top-[22px] left-[16.67%] right-[16.67%] h-0.5 bg-gray-200"
              />
              {programs.map((stage, index) => {
                const active = stage.id === program.id;
                return (
                  <li key={stage.id} className="relative">
                    <Link
                      href={`/program/${stage.id}`}
                      aria-current={active ? "page" : undefined}
                      className="group flex flex-col items-center gap-2 text-center rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-blue"
                    >
                      <span
                        className={`flex w-10 h-10 sm:w-11 sm:h-11 items-center justify-center rounded-full border-2 font-bold transition-colors ${
                          active
                            ? "bg-primary-blue border-primary-blue text-white"
                            : "bg-white border-gray-200 text-gray-500 group-hover:border-primary-blue/50 group-hover:text-primary-blue"
                        }`}
                      >
                        {index + 1}
                      </span>
                      <span
                        className={`text-[11px] sm:text-xs font-bold uppercase tracking-wider ${
                          active ? "text-primary-blue" : "text-gray-500"
                        }`}
                      >
                        {stage.tag}
                      </span>
                      <span
                        className={`hidden sm:block text-base font-bold ${
                          active ? "text-primary-blue" : "text-gray-700 group-hover:text-primary-blue"
                        }`}
                      >
                        {stage.title}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </nav>
        </div>

        {/* Stage intro */}
        <section className="pt-12 md:pt-16 pb-6">
          <motion.div
            key={program.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="max-w-[1200px] mx-auto px-6 grid md:grid-cols-2 gap-8 md:gap-12 items-center"
          >
            <div className="relative h-[240px] sm:h-[320px] md:h-[360px] rounded-2xl overflow-hidden">
              <Image
                src={program.image}
                alt={program.title}
                fill
                sizes="(max-width: 768px) 100vw, 50vw"
                className="object-cover"
                priority
              />
            </div>
            <div className="flex flex-col items-start gap-4">
              <span className="bg-primary-blue text-white px-3 py-1.5 rounded-md text-sm font-semibold">
                Tahap {currentIndex + 1} · {program.tag}
              </span>
              <h1 className="font-[family-name:var(--font-display)] text-3xl sm:text-4xl md:text-[40px] leading-tight text-gray-900">
                {program.title}
              </h1>
              <p className="text-base md:text-lg text-gray-700 leading-relaxed">
                {program.description}
              </p>
              <ul className="space-y-2.5">
                {program.points.map((point) => (
                  <li
                    key={point}
                    className="flex gap-2.5 text-[15px] text-gray-700 leading-relaxed"
                  >
                    <span className="mt-2 w-1.5 h-1.5 rounded-full bg-secondary-green flex-shrink-0" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        </section>

        {/* Sub Programs Section */}
        <section className="py-12 md:py-16">
          <div className="max-w-[1200px] mx-auto px-6">
            <h2 className="font-[family-name:var(--font-display)] text-3xl md:text-4xl text-gray-900 mb-8 md:mb-10">
              Kegiatan
            </h2>

            <div className="grid md:grid-cols-2 gap-6">
              {program.subPrograms.map((subProgram, index) => (
                <motion.div
                  key={subProgram.title}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.1 + index * 0.08 }}
                  className="bg-gray-50 rounded-2xl border border-gray-100 overflow-hidden hover:border-primary-blue/20 hover:shadow-lg transition-all duration-300 flex flex-col"
                >
                  {subProgram.image && (
                    <div className="relative h-[180px] sm:h-[220px] w-full">
                      <Image
                        src={subProgram.image}
                        alt={`Kegiatan ${subProgram.title}`}
                        fill
                        sizes="(max-width: 768px) 100vw, 50vw"
                        className="object-cover"
                      />
                    </div>
                  )}

                  <div className="p-6 md:p-8 flex-1 flex flex-col">
                    <div className="flex items-start gap-4">
                      <div className="flex-shrink-0">
                        <div className="w-10 h-10 bg-primary-blue/10 rounded-full flex items-center justify-center">
                          <CheckCircle2
                            className="text-primary-blue"
                            size={20}
                          />
                        </div>
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-xl font-bold text-gray-900 mb-2">
                          {subProgram.title}
                        </h3>
                        {subProgram.hours && (
                          <span className="inline-flex items-center gap-1.5 mb-3 px-3 py-1 rounded-full bg-primary-blue/10 text-primary-blue text-sm font-semibold">
                            <Clock size={14} aria-hidden />
                            {subProgram.hours}
                          </span>
                        )}
                        <p className="text-gray-600 leading-relaxed">
                          {subProgram.description}
                        </p>
                      </div>
                    </div>

                    {subProgram.attachment && (
                      <a
                        href={subProgram.attachment.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-5 sm:ml-14 inline-flex items-center justify-center sm:justify-start gap-2 px-4 py-2.5 rounded-lg border border-primary-blue/30 bg-white text-primary-blue text-sm font-semibold hover:bg-primary-blue hover:text-white transition-colors"
                      >
                        <FileText size={16} aria-hidden />
                        {subProgram.attachment.label} (PDF)
                      </a>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Timeline Placeholder */}
        <section className="py-16 bg-gray-50">
          <div className="max-w-[1200px] mx-auto px-6 text-center">
            <h2 className="font-[family-name:var(--font-display)] text-3xl md:text-4xl text-gray-900 mb-4">
              Timeline Kegiatan
            </h2>
            <p className="text-gray-600 mb-8">
              Jadwal dan timeline kegiatan akan segera diperbarui.
            </p>
            <div className="bg-white rounded-2xl p-12 border border-gray-200">
              <p className="text-gray-400">Konten timeline akan ditambahkan</p>
            </div>
          </div>
        </section>

        {/* Gallery */}
        <section className="py-16">
          <div className="max-w-[1200px] mx-auto px-6">
            <h2 className="font-[family-name:var(--font-display)] text-3xl md:text-4xl text-gray-900 mb-4">
              Galeri Foto
            </h2>
            <p className="text-gray-600 mb-8">
              Dokumentasi kegiatan program {program.title}.
            </p>
            {gallery.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
                {gallery.map((photo, index) => (
                  <div
                    key={photo.name}
                    className="relative aspect-[4/3] rounded-xl overflow-hidden bg-gray-100"
                  >
                    <Image
                      src={photo.src}
                      alt={`Dokumentasi ${program.title} ${index + 1}`}
                      fill
                      sizes="(min-width: 768px) 33vw, 50vw"
                      className="object-cover hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-gray-50 rounded-2xl p-12 border border-gray-200 text-center">
                <p className="text-gray-400">Galeri foto akan ditambahkan</p>
              </div>
            )}
          </div>
        </section>

        <section className="pb-16 md:pb-24">
          <div className="max-w-[1200px] mx-auto px-6 flex flex-col gap-8">
            {/* Next stage */}
            {nextProgram && (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-6 md:p-8 border border-gray-200 rounded-2xl">
                <div>
                  <span className="block text-sm text-gray-500 mb-1">
                    Tahap berikutnya
                  </span>
                  <span className="text-lg md:text-xl font-bold text-gray-900">
                    {nextProgram.tag} · {nextProgram.title}
                  </span>
                </div>
                <Link
                  href={`/program/${nextProgram.id}`}
                  className="self-start sm:self-auto inline-flex h-11 items-center px-5 rounded-lg border-[1.5px] border-primary-blue text-primary-blue text-[15px] font-semibold hover:bg-primary-blue/5 transition-colors"
                >
                  Lanjut ke Tahap {currentIndex + 2}
                </Link>
              </div>
            )}

            {/* Download PitchDeck CTA */}
            <div className="bg-gradient-to-br from-primary-blue to-accent-navy rounded-2xl p-8 md:p-10 text-center relative overflow-hidden">
              <div className="absolute inset-0">
                <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-secondary-yellow/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />
              </div>
              <div className="relative z-10">
                <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">
                  Ingin Tahu Lebih Lanjut?
                </h2>
                <p className="text-white/80 mb-6 max-w-[500px] mx-auto">
                  Download PitchDeck kami untuk informasi lengkap tentang program, dampak, dan cara berkontribusi.
                </p>
                <a
                  href="/files/pitchdeck-sakola-kembara.pdf"
                  download
                  className="inline-flex items-center gap-2 px-8 py-4 bg-secondary-yellow text-gray-900 font-semibold rounded-xl hover:bg-yellow-400 transition-colors"
                >
                  <Download size={20} />
                  Download PitchDeck
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
