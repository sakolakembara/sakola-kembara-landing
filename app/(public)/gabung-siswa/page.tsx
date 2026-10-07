"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  BookOpen,
  ClipboardList,
  FolderOpen,
  GraduationCap,
  Sparkles,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Heading } from "@/components/ui/heading";
import { SectionHeader } from "@/components/ui/section-header";

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
      <section className="relative bg-gradient-to-br from-primary-blue to-accent-navy text-white pb-16 md:pb-24 pt-[var(--hero-top,8rem)] overflow-hidden">
        <Container>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="max-w-[760px]"
          >
            <span className="inline-block px-3 py-1 mb-5 text-xs font-semibold uppercase tracking-wider bg-white/15 rounded-full border border-white/25">
              Open Recruitment Gen 6
            </span>
            <Heading level="page" className="mb-5">
              Wujudkan Mimpimu Bersama Sakola Kembara
            </Heading>
            <p className="text-base md:text-lg text-white/90 max-w-[600px] mb-8 leading-relaxed">
              Bergabunglah dengan ratusan siswa lain yang berhasil menembus
              perguruan tinggi terbaik di Indonesia melalui program pembinaan
              intensif gratis dari Sakola Kembara.
            </p>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <Button href="/portal/daftar" variant="white-on-navy" size="lg">
                <ClipboardList size={18} />
                Daftar Sekarang
              </Button>
              <Button href="#manfaat" variant="outline-on-navy" size="lg">
                Pelajari Program
              </Button>
              <Link
                href="/gabung-siswa/docs"
                className="inline-flex items-center gap-2 px-6 py-3.5 text-white/90 hover:text-white font-semibold underline underline-offset-4 decoration-white/40 hover:decoration-white transition-colors"
              >
                <FolderOpen size={16} />
                Pusat Dokumen
              </Link>
            </div>
          </motion.div>
        </Container>
      </section>

      {/* Benefits */}
      <section id="manfaat" className="py-20 bg-gray-50">
        <Container>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="mb-14"
          >
            <SectionHeader
              title="Manfaat Bergabung dengan Sakola Kembara"
              lead="Bukan hanya bimbingan belajar. Kami menyiapkan kamu untuk sukses di perguruan tinggi dan kehidupan setelahnya."
            />
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
                <Heading level="card" className="text-gray-900 mb-3">
                  {benefit.title}
                </Heading>
                <p className="text-gray-600 leading-relaxed">
                  {benefit.description}
                </p>
              </motion.div>
            ))}
          </div>
        </Container>
      </section>

      {/* Flow */}
      <section className="py-20 bg-white">
        <Container>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="mb-12"
          >
            <SectionHeader
              title="Alur Pendaftaran"
              lead="Empat langkah singkat dari pendaftaran sampai kamu resmi menjadi bagian dari Sakola Kembara Gen 6."
            />
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
                <div className="text-primary-blue font-[family-name:var(--font-display)] text-3xl mb-3">
                  {f.step}
                </div>
                <h3 className="font-bold text-gray-900 mb-2">{f.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  {f.body}
                </p>
              </motion.div>
            ))}
          </div>
        </Container>
      </section>

      {/* Bottom CTA */}
      <section className="py-16 bg-gradient-to-br from-primary-blue to-accent-navy text-white">
        <Container size="reading" className="text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <SectionHeader
              tone="dark"
              title="Siap Bergabung dengan Sakola Kembara?"
              lead="Isi formulir pendaftaran sekarang. Formulir dibagi menjadi beberapa bagian dan progres kamu akan tersimpan otomatis di browser ini."
              className="mb-8"
            />
            <Button href="/portal/daftar" variant="white-on-navy" size="lg">
              <ClipboardList size={18} />
              Daftar Sekarang
            </Button>
          </motion.div>
        </Container>
      </section>
    </main>
  );
}
