"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { CheckCircle2, Clock, Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Heading } from "@/components/ui/heading";
import { SectionHeader } from "@/components/ui/section-header";
import { Tag } from "@/components/ui/tag";
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
            <Heading level="panel" as="h1" className="text-gray-900 mb-4">
              Program tidak ditemukan
            </Heading>
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
          <Container>
            {/* The same header as the homepage's Activities section. */}
            <SectionHeader
              tone="dark"
              as="p"
              eyebrow="Program Kami"
              title="Apa saja yang dilalui penerima manfaat Sakola Kembara?"
            />
          </Container>
        </section>

        {/* Stage tabs. Each tab is a link to that stage's own URL, so stages
            stay shareable, server-rendered, and work with Back. */}
        <Container className="-mt-20 md:-mt-24 relative z-10">
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
        </Container>

        {/* Stage intro */}
        <Container as="section" className="pt-12 md:pt-16 pb-6">
          <motion.div
            key={program.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="grid md:grid-cols-2 gap-8 md:gap-12 items-center"
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
              <Tag>
                Tahap {currentIndex + 1} · {program.tag}
              </Tag>
              <Heading level="article" className="text-gray-900">
                {program.title}
              </Heading>
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
        </Container>

        {/* Sub Programs Section */}
        <section className="py-12 md:py-16">
          <Container>
            <SectionHeader align="left" title="Kegiatan" className="mb-8 md:mb-10" />

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
                        <Heading level="card" className="text-gray-900 mb-2">
                          {subProgram.title}
                        </Heading>
                        {subProgram.hours && (
                          <Tag tone="soft" className="mb-3">
                            <Clock size={14} aria-hidden />
                            {subProgram.hours}
                          </Tag>
                        )}
                        <p className="text-gray-600 leading-relaxed">
                          {subProgram.description}
                        </p>
                      </div>
                    </div>

                    {subProgram.attachment && (
                      <Button
                        href={subProgram.attachment.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        variant="outline"
                        className="mt-5 sm:ml-14 sm:self-start"
                      >
                        <FileText size={16} aria-hidden />
                        {subProgram.attachment.label} (PDF)
                      </Button>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </Container>
        </section>

        {/* Timeline Placeholder */}
        <section className="py-16 bg-gray-50">
          <Container className="text-center">
            <SectionHeader
              title="Timeline Kegiatan"
              lead="Jadwal dan timeline kegiatan akan segera diperbarui."
              className="mb-8"
            />
            <div className="bg-white rounded-2xl p-12 border border-gray-200">
              <p className="text-gray-400">Konten timeline akan ditambahkan</p>
            </div>
          </Container>
        </section>

        {/* Gallery */}
        <section className="py-16">
          <Container>
            <SectionHeader
              align="left"
              title="Galeri Foto"
              lead={`Dokumentasi kegiatan program ${program.title}.`}
              className="mb-8"
            />
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
          </Container>
        </section>

        <section className="pb-16 md:pb-24">
          <Container className="flex flex-col gap-8">
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
                <Button
                  href={`/program/${nextProgram.id}`}
                  variant="outline"
                  className="self-start sm:self-auto"
                >
                  Lanjut ke Tahap {currentIndex + 2}
                </Button>
              </div>
            )}

            {/* Download PitchDeck CTA */}
            <div className="bg-gradient-to-br from-primary-blue to-accent-navy rounded-2xl p-8 md:p-10 text-center relative overflow-hidden">
              <div className="absolute inset-0">
                <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-secondary-yellow/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />
              </div>
              <div className="relative z-10">
                <Heading level="panel" as="h2" className="text-white mb-3">
                  Ingin Tahu Lebih Lanjut?
                </Heading>
                <p className="text-white/80 mb-6 max-w-[600px] mx-auto">
                  Download PitchDeck kami untuk informasi lengkap tentang program, dampak, dan cara berkontribusi.
                </p>
                <Button
                  href="/files/pitchdeck-sakola-kembara.pdf"
                  download
                  variant="yellow-on-navy"
                  size="lg"
                >
                  <Download size={20} />
                  Download PitchDeck
                </Button>
              </div>
            </div>
          </Container>
        </section>
      </main>
    </>
  );
}
