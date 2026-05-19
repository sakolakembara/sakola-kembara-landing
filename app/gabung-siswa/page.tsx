"use client";

import { motion } from "framer-motion";
import { Send, GraduationCap, BookOpen, Users, Sparkles, CheckCircle2 } from "lucide-react";
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
    title: "Mentoring Personal",
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
        <section className="bg-gradient-to-br from-secondary-green to-primary-blue text-white py-20">
          <div className="max-w-[1200px] mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <div className="inline-flex items-center gap-2 text-sm font-semibold text-secondary-yellow uppercase tracking-wider mb-4">
                <span className="w-2 h-2 bg-secondary-yellow rounded-full" />
                Gabung Sebagai Siswa
              </div>
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
                <div className="inline-flex items-center gap-2 text-sm font-semibold text-primary-blue uppercase tracking-wider mb-4">
                  <span className="w-2 h-2 bg-secondary-yellow rounded-full" />
                  Persyaratan
                </div>
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
                <div className="inline-flex items-center gap-2 text-sm font-semibold text-primary-blue uppercase tracking-wider mb-4">
                  <span className="w-2 h-2 bg-secondary-yellow rounded-full" />
                  Cara Mendaftar
                </div>
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

        {/* Registration Form Section */}
        <section className="py-20 bg-gray-50">
          <div className="max-w-[800px] mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="text-center mb-12"
            >
              <div className="inline-flex items-center gap-2 text-sm font-semibold text-primary-blue uppercase tracking-wider mb-4">
                <span className="w-2 h-2 bg-secondary-yellow rounded-full" />
                Formulir Pendaftaran
              </div>
              <h2 className="font-[var(--font-display)] text-3xl md:text-4xl text-gray-900 mb-4">
                Daftar Sekarang
              </h2>
              <p className="text-lg text-gray-600">
                Isi formulir di bawah ini untuk memulai proses pendaftaran sebagai
                siswa Sakola Kembara.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="bg-white rounded-3xl p-8 md:p-10 shadow-lg"
            >
              <form className="space-y-5">
                <div className="grid md:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Nama Lengkap
                    </label>
                    <input
                      type="text"
                      placeholder="Masukkan nama lengkap"
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-primary-blue focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Tanggal Lahir
                    </label>
                    <input
                      type="date"
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-primary-blue focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Email
                    </label>
                    <input
                      type="email"
                      placeholder="email@example.com"
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-primary-blue focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Nomor WhatsApp
                    </label>
                    <input
                      type="tel"
                      placeholder="08xxxxxxxxxx"
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-primary-blue focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Asal Sekolah
                    </label>
                    <input
                      type="text"
                      placeholder="Nama sekolah saat ini"
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-primary-blue focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Kelas
                    </label>
                    <select className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-primary-blue focus:outline-none bg-white">
                      <option value="">Pilih kelas</option>
                      <option value="11">Kelas 11</option>
                      <option value="12">Kelas 12</option>
                      <option value="lulusan">Lulusan / Gap Year</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Domisili / Kota
                  </label>
                  <input
                    type="text"
                    placeholder="Kota tempat tinggal saat ini"
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-primary-blue focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Cabang yang Dituju
                  </label>
                  <select className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-primary-blue focus:outline-none bg-white">
                    <option value="">Pilih cabang</option>
                    <option value="cililin">Sakola Kembara Cililin</option>
                    <option value="bojong">Sakola Kembara Bojong</option>
                    <option value="bandung">Sakola Kembara Bandung</option>
                    <option value="cibodas">Sakola Kembara Cibodas</option>
                    <option value="cirebon">Sakola Kembara Cirebon</option>
                    <option value="purbalingga">Sakola Kembara Purbalingga</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Surat Motivasi
                  </label>
                  <textarea
                    placeholder="Ceritakan alasan kamu ingin bergabung dengan Sakola Kembara dan apa cita-citamu setelah lulus..."
                    rows={6}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-primary-blue focus:outline-none resize-none"
                  />
                  <p className="text-xs text-gray-500 mt-2">
                    Minimal 200 kata. Ceritakan dengan jujur dan apa adanya.
                  </p>
                </div>

                <button
                  type="submit"
                  className="w-full inline-flex items-center justify-center gap-2 px-8 py-4 bg-primary-blue text-white font-semibold rounded-xl hover:bg-primary-blue-dark transition-colors"
                >
                  <Send size={18} />
                  Kirim Pendaftaran
                </button>

                <p className="text-center text-xs text-gray-500 mt-2">
                  Dengan mengirim formulir ini, kamu menyetujui untuk dihubungi
                  oleh tim Sakola Kembara terkait proses seleksi.
                </p>
              </form>
            </motion.div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
