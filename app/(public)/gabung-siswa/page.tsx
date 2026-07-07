"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  ClipboardList,
  FolderOpen,
  GraduationCap,
  Sparkles,
  Users,
} from "lucide-react";

const benefits = [
  {
    icon: BookOpen,
    title: "Kurikulum Khusus",
    description:
      "Belajar dengan kurikulum yang dirancang khusus, menggabungkan materi SD–SMA agar bisa dikuasai dalam satu tahun pembelajaran intensif.",
  },
  {
    icon: Users,
    title: "Mentoring Intensif",
    description:
      "Dapatkan pendampingan langsung dari mentor berpengalaman yang berasal dari berbagai universitas terbaik di Indonesia.",
  },
  {
    icon: Sparkles,
    title: "Talents Mapping",
    description:
      "Bekerja sama dengan talentsmapping.id untuk membantu kamu memetakan bakat dan memilih jurusan yang paling sesuai.",
  },
  {
    icon: GraduationCap,
    title: "Pendampingan Beasiswa",
    description:
      "Setelah diterima di perguruan tinggi, kami dampingi proses pencarian beasiswa hingga kamu bisa memulai kuliah dengan tenang.",
  },
];

const flow = [
  {
    step: "01",
    title: "Isi Formulir Pendaftaran",
    body: "Lengkapi seluruh bagian formulir dengan jujur dan sesuai kenyataan.",
  },
  {
    step: "02",
    title: "Verifikasi Berkas",
    body: "Tim kesiswaan akan memverifikasi data dan berkas yang kamu kirim.",
  },
  {
    step: "03",
    title: "Wawancara Lanjutan",
    body: "Kandidat terpilih akan diundang untuk sesi wawancara singkat via daring.",
  },
  {
    step: "04",
    title: "Pengumuman & Onboarding",
    body: "Hasil seleksi diumumkan dan siswa terpilih memulai program bersama Gen 6.",
  },
];

export default function GabungSiswaPage() {
  return (
    <main className="min-h-screen bg-white">
      {/* Hero Section */}
      <section className="relative bg-gradient-to-br from-primary-blue to-accent-navy text-white pb-24 pt-[var(--hero-top,8rem)] overflow-hidden">
        <div className="max-w-[1200px] mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="max-w-[820px]"
          >
            <span className="inline-block px-3 py-1 mb-5 text-xs font-semibold uppercase tracking-wider bg-white/15 rounded-full border border-white/25">
              Open Recruitment Gen 6
            </span>
            <h1 className="font-[var(--font-display)] text-4xl md:text-5xl lg:text-6xl mb-5 leading-tight">
              Wujudkan Mimpimu Bersama Sakola Kembara
            </h1>
            <p className="text-lg md:text-xl text-white/90 max-w-[700px] mb-8 leading-relaxed">
              Bergabunglah dengan ratusan siswa lain yang berhasil menembus
              perguruan tinggi terbaik di Indonesia melalui program pembinaan
              intensif gratis dari Sakola Kembara.
            </p>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <Link
                href="/gabung-siswa/form"
                className="inline-flex items-center gap-2 px-7 py-3.5 bg-white text-primary-blue font-bold rounded-xl hover:bg-gray-50 transition-colors shadow-lg"
              >
                <ClipboardList size={18} />
                Daftar Sekarang
                <ArrowRight size={18} />
              </Link>
              <a
                href="#manfaat"
                className="inline-flex items-center gap-2 px-6 py-3.5 border-2 border-white/40 text-white font-semibold rounded-xl hover:bg-white/10 transition-colors"
              >
                Pelajari Program
              </a>
              <Link
                href="/gabung-siswa/docs"
                className="inline-flex items-center gap-2 px-6 py-3.5 text-white/90 hover:text-white font-semibold underline underline-offset-4 decoration-white/40 hover:decoration-white transition-colors"
              >
                <FolderOpen size={16} />
                Pusat Dokumen
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Benefits */}
      <section id="manfaat" className="py-20 bg-gray-50">
        <div className="max-w-[1200px] mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-14"
          >
            <h2 className="font-[var(--font-display)] text-3xl md:text-4xl text-gray-900 mb-4">
              Manfaat Bergabung dengan Sakola Kembara
            </h2>
            <p className="text-lg text-gray-600 max-w-[640px] mx-auto">
              Bukan hanya bimbingan belajar. Kami menyiapkan kamu untuk sukses
              di perguruan tinggi dan kehidupan setelahnya.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-6">
            {benefits.map((benefit, index) => (
              <motion.div
                key={benefit.title}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.1 + index * 0.1 }}
                className="bg-white rounded-2xl p-8 border border-gray-100 hover:-translate-y-1 hover:shadow-lg transition-all duration-300"
              >
                <div className="w-14 h-14 bg-primary-blue/10 rounded-2xl flex items-center justify-center mb-5">
                  <benefit.icon className="w-7 h-7 text-primary-blue" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">
                  {benefit.title}
                </h3>
                <p className="text-gray-600 leading-relaxed">
                  {benefit.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Flow */}
      <section className="py-20 bg-white">
        <div className="max-w-[1100px] mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-12"
          >
            <h2 className="font-[var(--font-display)] text-3xl md:text-4xl text-gray-900 mb-4">
              Alur Pendaftaran
            </h2>
            <p className="text-lg text-gray-600 max-w-[600px] mx-auto">
              Empat langkah singkat dari pendaftaran sampai kamu resmi menjadi
              bagian dari Sakola Kembara Gen 6.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {flow.map((f, i) => (
              <motion.div
                key={f.step}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.1 + i * 0.1 }}
                className="rounded-2xl border border-gray-200 p-6 bg-gray-50/60"
              >
                <div className="text-primary-blue font-[var(--font-display)] text-3xl mb-3">
                  {f.step}
                </div>
                <h3 className="font-bold text-gray-900 mb-2">{f.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  {f.body}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-16 bg-gradient-to-br from-primary-blue to-accent-navy text-white">
        <div className="max-w-[820px] mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="font-[var(--font-display)] text-3xl md:text-4xl mb-4">
              Siap Bergabung dengan Sakola Kembara?
            </h2>
            <p className="text-lg text-white/90 mb-8 leading-relaxed">
              Isi formulir pendaftaran sekarang. Formulir dibagi menjadi
              beberapa bagian dan progres kamu akan tersimpan otomatis di
              browser ini.
            </p>
            <Link
              href="/gabung-siswa/form"
              className="inline-flex items-center gap-2 px-8 py-4 bg-white text-primary-blue font-bold rounded-xl hover:bg-gray-50 transition-colors shadow-lg"
            >
              <ClipboardList size={18} />
              Daftar Sekarang
              <ArrowRight size={18} />
            </Link>
          </motion.div>
        </div>
      </section>
    </main>
  );
}
