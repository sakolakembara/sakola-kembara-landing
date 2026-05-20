"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Lock, Heart, Users, GraduationCap } from "lucide-react";
import Link from "next/link";
import { donationTiers } from "@/lib/data";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import StakeholderSection from "@/components/sections/StakeholderSection";

const impactItems = [
  {
    icon: GraduationCap,
    title: "Akses Pendidikan",
    description: "Membantu siswa dari keluarga kurang mampu mengakses bimbingan belajar berkualitas",
  },
  {
    icon: Users,
    title: "Pembinaan Intensif",
    description: "Mendukung program asrama dan KBM pekanan selama setahun penuh",
  },
  {
    icon: Heart,
    title: "Masa Depan Cerah",
    description: "Membuka jalan bagi siswa untuk diterima di perguruan tinggi impian",
  },
];

export default function DonasiPage() {
  const [selectedTier, setSelectedTier] = useState(2);

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-gray-50">
        {/* Hero Section */}
        <section className="bg-gradient-to-br from-primary-blue to-accent-navy text-white pt-32 pb-20">
          <div className="max-w-[1200px] mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <h1 className="font-[var(--font-display)] text-4xl md:text-5xl lg:text-6xl mb-4">
                Dukung Perjalanan Mereka
              </h1>
              <p className="text-lg md:text-xl text-white/90 max-w-[600px]">
                Setiap donasi Anda membantu siswa dari keluarga kurang mampu untuk
                mewujudkan impian mereka masuk perguruan tinggi.
              </p>
            </motion.div>
          </div>
        </section>

        {/* Main Content */}
        <section className="py-16">
          <div className="max-w-[1200px] mx-auto px-6">
            <div className="grid lg:grid-cols-2 gap-12">
              {/* Donation Form */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
              >
                <div className="bg-white rounded-3xl p-8 md:p-10 shadow-lg">
                  <h2 className="text-2xl font-bold text-gray-900 mb-6">
                    Pilih Nominal Donasi
                  </h2>

                  {/* Donation Tiers */}
                  <div className="grid grid-cols-2 gap-4 mb-8">
                    {donationTiers.map((tier) => (
                      <button
                        key={tier.id}
                        onClick={() => setSelectedTier(tier.id)}
                        className={`p-5 rounded-xl border-2 text-left transition-all ${
                          selectedTier === tier.id
                            ? "bg-primary-blue/5 border-primary-blue"
                            : "bg-gray-50 border-gray-200 hover:border-primary-blue/50"
                        }`}
                      >
                        <div className={`text-xs font-semibold uppercase mb-1 ${
                          selectedTier === tier.id ? "text-primary-blue" : "text-gray-500"
                        }`}>
                          {tier.name}
                        </div>
                        <div className={`text-xl md:text-2xl font-bold ${
                          selectedTier === tier.id ? "text-primary-blue" : "text-gray-900"
                        }`}>
                          {tier.amount}
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Custom Amount Input */}
                  {selectedTier === 4 && (
                    <div className="mb-8">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Masukkan Nominal
                      </label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-medium">
                          Rp
                        </span>
                        <input
                          type="text"
                          placeholder="0"
                          className="w-full pl-12 pr-4 py-4 border-2 border-gray-200 rounded-xl focus:border-primary-blue focus:outline-none text-xl font-semibold"
                        />
                      </div>
                    </div>
                  )}

                  {/* Donor Info */}
                  <div className="space-y-4 mb-8">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Nama Lengkap
                      </label>
                      <input
                        type="text"
                        placeholder="Masukkan nama Anda"
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-primary-blue focus:outline-none"
                      />
                    </div>
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
                        Pesan (Opsional)
                      </label>
                      <textarea
                        placeholder="Tulis pesan dukungan Anda"
                        rows={3}
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-primary-blue focus:outline-none resize-none"
                      />
                    </div>
                  </div>

                  <button className="w-full py-4 bg-secondary-yellow text-gray-900 font-semibold text-lg rounded-xl hover:bg-amber-400 transition-colors">
                    Donasi Sekarang
                  </button>

                  <div className="flex items-center justify-center gap-2 mt-4 text-sm text-gray-500">
                    <Lock size={16} />
                    Transaksi aman & terenkripsi
                  </div>
                </div>
              </motion.div>

              {/* Impact Info */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.3 }}
              >
                <h2 className="text-2xl font-bold text-gray-900 mb-6">
                  Dampak Donasi Anda
                </h2>

                <div className="space-y-6 mb-10">
                  {impactItems.map((item, index) => (
                    <div key={index} className="flex gap-4">
                      <div className="w-12 h-12 bg-primary-blue/10 rounded-xl flex items-center justify-center flex-shrink-0">
                        <item.icon className="text-primary-blue" size={24} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900 mb-1">
                          {item.title}
                        </h3>
                        <p className="text-gray-600 text-sm">
                          {item.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Stats */}
                <div className="bg-white rounded-2xl p-6 shadow-sm">
                  <h3 className="font-semibold text-gray-900 mb-4">
                    Pencapaian Bersama Donatur
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center p-4 bg-gray-50 rounded-xl">
                      <div className="text-3xl font-bold text-primary-blue">500+</div>
                      <div className="text-sm text-gray-600">Siswa Terbantu</div>
                    </div>
                    <div className="text-center p-4 bg-gray-50 rounded-xl">
                      <div className="text-3xl font-bold text-secondary-yellow">75.88%</div>
                      <div className="text-sm text-gray-600">Berkuliah</div>
                    </div>
                  </div>
                </div>

                {/* Ingin Bergabung - moved from Kontak page */}
                <div className="mt-6 bg-gradient-to-br from-primary-blue to-accent-navy rounded-2xl p-6 text-white">
                  <h3 className="font-semibold text-lg mb-3">Ingin Bergabung?</h3>
                  <p className="text-white/80 text-sm mb-4">
                    Jadilah bagian dari perubahan. Daftarkan diri Anda sebagai relawan
                    atau dukung kami melalui kerjasama lainnya.
                  </p>
                  <div className="flex gap-3">
                    <Link
                      href="/kontak"
                      className="px-5 py-2.5 bg-white text-primary-blue font-semibold rounded-lg text-sm hover:bg-gray-100 transition-colors"
                    >
                      Hubungi Kami
                    </Link>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Stakeholder Relations - Transparansi & Akuntabilitas */}
        <StakeholderSection />
      </main>
      <Footer />
    </>
  );
}
