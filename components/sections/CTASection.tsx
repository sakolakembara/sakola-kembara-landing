"use client";

import { motion } from "framer-motion";
import { useInView } from "framer-motion";
import { useRef } from "react";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { SectionHeader } from "@/components/ui/section-header";

const ctaOptions = [
  {
    id: "siswa",
    title: "Menjadi Siswa",
    description:
      "Pembinaan penuh selama satu tahun, Agustus hingga April, tanpa biaya. Terbuka bagi siswa kelas 12 dan lulusan yang menyiapkan UTBK maupun ujian mandiri.",
    buttonText: "Daftar Sekarang",
    href: "/gabung-siswa",
    color: "bg-orange-500",
    hoverColor: "hover:bg-orange-600",
  },
  {
    id: "donatur",
    title: "Menjadi Donatur",
    description:
      "Donasi mulai Rp50.000 dapat membantu menopang kegiatan belajar pekanan, asrama, dan pendampingan beasiswa hingga siswa benar-benar duduk di bangku kuliah.",
    buttonText: "Donasi Sekarang",
    href: "/donasi",
    color: "bg-primary-blue",
    hoverColor: "hover:bg-primary-blue-dark",
  },
  {
    id: "relawan",
    title: "Menjadi Relawan",
    description:
      "Mengajar di kelas pekanan, mendampingi asrama, atau menopang operasional cabang. Sekitar separuh relawan kami adalah alumni yang kembali.",
    buttonText: "Gabung Tim",
    href: "/kontak",
    color: "bg-secondary-green",
    hoverColor: "hover:bg-green-600",
  },
  {
    id: "partner",
    title: "Menjadi Partner",
    description:
      "Dukungan institusi memperluas jangkauan kami dari delapan cabang di tiga provinsi ke daerah yang belum terjangkau.",
    buttonText: "Hubungi Kami",
    href: "/kontak",
    color: "bg-secondary-yellow",
    hoverColor: "hover:bg-secondary-yellow/90",
    textColor: "text-gray-900",
  },
];

export default function CTASection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section className="py-14 md:py-16 bg-gradient-to-br from-primary-blue to-accent-navy relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-white/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-secondary-yellow/20 rounded-full blur-3xl" />
      </div>

      <Container className="relative z-10" ref={ref}>
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="mb-10"
        >
          <SectionHeader
            tone="dark"
            eyebrow="Bergabung Bersama Kami"
            title="Jadilah Bagian dari Perubahan"
            lead="Pintu menuju pendidikan tinggi tidak terbuka dengan sendirinya. Empat peran berikut membuat program kami terus berjalan, dan semuanya terbuka lebar untuk Anda."
          />
        </motion.div>

        {/* CTA Cards. Their colored buttons are a documented exception to the
            Button variants (DESIGN.md, Color). */}
        <div className="grid md:grid-cols-2 gap-5 max-w-[1000px] mx-auto">
          {ctaOptions.map((option, index) => (
            <motion.div
              key={option.id}
              initial={{ opacity: 0, y: 30 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.2 + index * 0.1 }}
              className="bg-white rounded-2xl p-5 sm:p-6 flex flex-col hover:-translate-y-1 hover:shadow-2xl transition-all duration-300"
            >
              <h3 className="text-lg font-bold text-gray-900 mb-1.5">
                {option.title}
              </h3>
              <p className="text-sm text-gray-600 leading-snug mb-4">
                {option.description}
              </p>
              {/* mt-auto keeps the buttons on a common baseline when two
                  cards in a row have blurbs of different lengths. */}
              <Link
                href={option.href}
                className={`mt-auto inline-flex w-full sm:w-auto sm:self-start items-center justify-center sm:min-w-[160px] px-4 py-2.5 sm:py-2 ${option.color} ${option.hoverColor} ${option.textColor || "text-white"} text-sm font-semibold rounded-lg transition-colors`}
              >
                {option.buttonText}
              </Link>
            </motion.div>
          ))}
        </div>

        {/* Bottom text */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.8 }}
          className="text-center text-white/60 mt-8 text-sm"
        >
          Belum yakin peran mana yang paling sesuai? Hubungi kami, dan kami
          bantu mencarikannya.
        </motion.p>
      </Container>
    </section>
  );
}
