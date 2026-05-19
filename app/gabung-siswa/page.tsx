"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { GraduationCap, BookOpen, Users, Sparkles, CheckCircle2 } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const benefits = [
  {
    icon: BookOpen,
    title: "Kurikulum Khusus",
    description:
      "Belajar dengan kurikulum yang dirancang khusus menggabungkan materi SD-SMA agar bisa dipahami dalam 1 tahun pembelajaran intensif.",
  },
  {
    icon: Users,
    title: "Mentoring Intensif",
    description:
      "Dapatkan pendampingan langsung dari mentor berpengalaman dari berbagai universitas terbaik di Indonesia.",
  },
  {
    icon: Sparkles,
    title: "Talents Mapping",
    description:
      "Bekerjasama dengan talentsmapping.id untuk membantu kamu memetakan bakat dan memilih jurusan yang sesuai.",
  },
  {
    icon: GraduationCap,
    title: "Pendampingan Beasiswa",
    description:
      "Setelah diterima di perguruan tinggi, kami dampingi proses pencarian beasiswa hingga kamu bisa mulai kuliah.",
  },
];

const requirements = [
  "Siswa SMA/SMK/MA kelas 11 atau 12, atau lulusan (gap year) yang serius ingin melanjutkan ke Perguruan Tinggi",
  "Berasal dari keluarga dengan keterbatasan ekonomi",
  "Memiliki motivasi tinggi dan komitmen untuk mengikuti program selama 1 tahun penuh",
  "Bersedia mengikuti seleksi berbasis surat motivasi dan wawancara",
  "Tinggal di sekitar wilayah cabang Sakola Kembara atau bersedia mengikuti asrama",
];

const steps = [
  {
    number: "01",
    title: "Daftar Online",
    description: "Isi formulir pendaftaran di bawah ini dengan data diri yang lengkap dan benar.",
  },
  {
    number: "02",
    title: "Kirim Surat Motivasi",
    description: "Tuliskan surat motivasi yang menceritakan alasan kamu ingin bergabung dengan Sakola Kembara.",
  },
  {
    number: "03",
    title: "Wawancara",
    description: "Tim kami akan menghubungi kamu untuk proses wawancara dan verifikasi.",
  },
  {
    number: "04",
    title: "Mulai Belajar",
    description: "Selamat! Bergabung dalam program pembinaan intensif selama 1 tahun.",
  },
];

export default function GabungSiswaPage() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-white">
        {/* Hero Section */}
        <section className="bg-gradient-to-br from-primary-blue to-accent-navy text-white pt-32 pb-20">
          <div className="max-w-[1200px] mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <h1 className="font-[var(--font-display)] text-4xl md:text-5xl lg:text-6xl mb-4">
                Wujudkan Mimpimu Bersama Sakola Kembara
              </h1>
              <p className="text-lg md:text-xl text-white/90 max-w-[700px]">
                Bergabunglah dengan ratusan siswa lain yang berhasil menembus
                perguruan tinggi terbaik di Indonesia melalui program pembinaan
                intensif gratis dari Sakola Kembara.
              </p>
            </motion.div>
          </div>
        </section>

        {/* Benefits Section */}
        <section className="py-20 bg-gray-50">
          <div className="max-w-[1200px] mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="text-center mb-14"
            >
              <div className="inline-flex items-center gap-2 text-sm font-semibold text-primary-blue uppercase tracking-wider mb-4">
                <span className="w-2 h-2 bg-secondary-yellow rounded-full" />
                Apa yang Kamu Dapatkan
              </div>
              <h2 className="font-[var(--font-display)] text-3xl md:text-4xl text-gray-900 mb-4">
                Manfaat Bergabung dengan Sakola Kembara
              </h2>
              <p className="text-lg text-gray-600 max-w-[600px] mx-auto">
                Bukan hanya bimbingan belajar, kami menyiapkan kamu untuk sukses
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

        {/* Requirements + Steps Section */}
        <section className="py-20">
          <div className="max-w-[1200px] mx-auto px-6">
            <div className="grid lg:grid-cols-2 gap-12">
              {/* Requirements */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
              >
                <h2 className="font-[var(--font-display)] text-3xl md:text-4xl text-gray-900 mb-6">
                  Siapa yang Bisa Mendaftar?
                </h2>
                <ul className="space-y-4">
                  {requirements.map((req, index) => (
                    <li key={index} className="flex gap-3">
                      <CheckCircle2 className="w-6 h-6 text-secondary-green flex-shrink-0 mt-0.5" />
                      <span className="text-gray-700 leading-relaxed">{req}</span>
                    </li>
                  ))}
                </ul>
              </motion.div>

              {/* Steps */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.2 }}
              >
                <h2 className="font-[var(--font-display)] text-3xl md:text-4xl text-gray-900 mb-6">
                  Empat Langkah Mudah
                </h2>
                <div className="space-y-5">
                  {steps.map((step) => (
                    <div key={step.number} className="flex gap-4">
                      <div className="font-[var(--font-display)] text-3xl font-bold text-primary-blue/30 leading-none">
                        {step.number}
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-gray-900 mb-1">
                          {step.title}
                        </h3>
                        <p className="text-gray-600 text-sm leading-relaxed">
                          {step.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Registration CTA Section */}
        <section className="py-16 bg-white">
          <div className="max-w-[800px] mx-auto px-6 text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <h2 className="font-[var(--font-display)] text-3xl md:text-4xl text-gray-900 mb-4">
                Tertarik Menjadi Siswa?
              </h2>
              <p className="text-lg text-gray-600 mb-8">
                Hubungi tim kami untuk informasi lebih lanjut mengenai proses
                pendaftaran dan jadwal seleksi di cabang terdekat.
              </p>
              <div className="flex justify-center">
                <Link
                  href="/kontak"
                  className="px-8 py-4 bg-primary-blue text-white font-semibold rounded-xl hover:bg-primary-blue-dark transition-colors"
                >
                  Daftar Sekarang
                </Link>
              </div>
            </motion.div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
