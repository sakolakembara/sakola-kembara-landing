"use client";

import { motion } from "framer-motion";
import { GraduationCap, BookOpen, Users, Sparkles } from "lucide-react";

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

export default function GabungSiswaPage() {
  return (
    <>
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
                <a
                  href="mailto:contact@sakolakembara.org?subject=Pendaftaran%20Siswa%20Sakola%20Kembara"
                  className="px-8 py-4 bg-primary-blue text-white font-semibold rounded-xl hover:bg-primary-blue-dark transition-colors"
                >
                  Hubungi Tim Pendaftaran
                </a>
              </div>
            </motion.div>
          </div>
        </section>
      </main>
    </>
  );
}
