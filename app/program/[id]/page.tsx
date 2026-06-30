"use client";

import { motion } from "framer-motion";
import { useParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { CheckCircle2, Download } from "lucide-react";
import { programs } from "@/lib/data";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export default function ProgramDetailPage() {
  const params = useParams();
  const programId = params.id as string;

  const program = programs.find((p) => p.id === programId);

  if (!program) {
    return (
      <>
        <Navbar />
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
        <Footer />
      </>
    );
  }

  const currentIndex = programs.findIndex((p) => p.id === programId);
  const prevProgram = currentIndex > 0 ? programs[currentIndex - 1] : null;
  const nextProgram =
    currentIndex < programs.length - 1 ? programs[currentIndex + 1] : null;

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-white">
        {/* Hero Section */}
        <section className="relative h-[400px] md:h-[500px]">
          <Image
            src={program.image}
            alt={program.title}
            fill
            className="object-cover"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />

          <div className="absolute inset-0 flex items-end">
            <div className="max-w-[1200px] mx-auto px-6 pb-12 w-full">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
              >
                <span className="block mb-3">
                  <span className="bg-secondary-yellow text-gray-900 px-3 py-1.5 rounded-md text-sm font-semibold">
                    {program.tag}
                  </span>
                </span>
                <h1 className="font-[var(--font-display)] text-4xl md:text-5xl lg:text-6xl text-white mb-4">
                  {program.title}
                </h1>
                <p className="text-lg md:text-xl text-white/90 max-w-[700px]">
                  {program.description}
                </p>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Sub Programs Section */}
        <section className="py-16 md:py-24">
          <div className="max-w-[1200px] mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <h2 className="font-[var(--font-display)] text-3xl md:text-4xl text-gray-900 mb-12 text-center">
                Kegiatan dalam {program.title}
              </h2>

              <div className="grid md:grid-cols-2 gap-6">
                {program.subPrograms.map((subProgram, index) => (
                  <motion.div
                    key={subProgram.title}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.3 + index * 0.1 }}
                    className="bg-gray-50 rounded-2xl p-6 md:p-8 border border-gray-100 hover:border-primary-blue/20 hover:shadow-lg transition-all duration-300"
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex-shrink-0">
                        <div className="w-10 h-10 bg-primary-blue/10 rounded-full flex items-center justify-center">
                          <CheckCircle2
                            className="text-primary-blue"
                            size={20}
                          />
                        </div>
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-gray-900 mb-2">
                          {subProgram.title}
                        </h3>
                        <p className="text-gray-600 leading-relaxed">
                          {subProgram.description}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            {/* Download PitchDeck CTA */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.5 }}
              className="mt-16 bg-gradient-to-br from-primary-blue to-accent-navy rounded-2xl p-8 md:p-10 text-center relative overflow-hidden"
            >
              <div className="absolute inset-0">
                <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-secondary-yellow/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />
              </div>
              <div className="relative z-10">
                <h3 className="text-2xl md:text-3xl font-bold text-white mb-3">
                  Ingin Tahu Lebih Lanjut?
                </h3>
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
            </motion.div>
          </div>
        </section>

        {/* Timeline Placeholder */}
        <section className="py-16 bg-gray-50">
          <div className="max-w-[1200px] mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="text-center"
            >
              <h2 className="font-[var(--font-display)] text-3xl md:text-4xl text-gray-900 mb-4">
                Timeline Kegiatan
              </h2>
              <p className="text-gray-600 mb-8">
                Jadwal dan timeline kegiatan akan segera diperbarui.
              </p>
              <div className="bg-white rounded-2xl p-12 border border-gray-200">
                <p className="text-gray-400">Konten timeline akan ditambahkan</p>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Gallery Placeholder */}
        <section className="py-16">
          <div className="max-w-[1200px] mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.5 }}
              className="text-center"
            >
              <h2 className="font-[var(--font-display)] text-3xl md:text-4xl text-gray-900 mb-4">
                Galeri Foto
              </h2>
              <p className="text-gray-600 mb-8">
                Dokumentasi kegiatan program {program.title}.
              </p>
              <div className="bg-gray-50 rounded-2xl p-12 border border-gray-200">
                <p className="text-gray-400">Galeri foto akan ditambahkan</p>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Navigation to other programs */}
        <section className="py-16 bg-gray-50">
          <div className="max-w-[1200px] mx-auto px-6">
            <h2 className="font-[var(--font-display)] text-2xl text-gray-900 mb-8 text-center">
              Program Lainnya
            </h2>
            <div className="grid md:grid-cols-2 gap-6">
              {prevProgram && (
                <Link href={`/program/${prevProgram.id}`}>
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.5 }}
                    className="bg-white rounded-xl p-6 border border-gray-200 hover:border-primary-blue/30 hover:shadow-md transition-all group"
                  >
                    <span className="text-sm text-gray-500 mb-1 block">
                      Sebelumnya
                    </span>
                    <span className="text-lg font-semibold text-gray-900 group-hover:text-primary-blue transition-colors">
                      {prevProgram.title}
                    </span>
                  </motion.div>
                </Link>
              )}
              {nextProgram && (
                <Link
                  href={`/program/${nextProgram.id}`}
                  className={prevProgram ? "" : "md:col-start-2"}
                >
                  <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.5 }}
                    className="bg-white rounded-xl p-6 border border-gray-200 hover:border-primary-blue/30 hover:shadow-md transition-all group text-right"
                  >
                    <span className="text-sm text-gray-500 mb-1 block">
                      Selanjutnya
                    </span>
                    <span className="text-lg font-semibold text-gray-900 group-hover:text-primary-blue transition-colors">
                      {nextProgram.title}
                    </span>
                  </motion.div>
                </Link>
              )}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
