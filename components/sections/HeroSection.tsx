"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import Image from "next/image";
import { heroStats, heroImages } from "@/lib/data";

export default function HeroSection() {
  return (
    <section className="pt-40 pb-24 bg-gradient-to-b from-gray-50 to-white relative overflow-hidden" id="about">
      {/* Background decoration */}
      <div className="absolute -top-1/2 -right-1/5 w-[800px] h-[800px] bg-[radial-gradient(circle,rgba(30,136,229,0.08)_0%,transparent_70%)] rounded-full" />

      <div className="max-w-[1200px] mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Text Content */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-primary-blue uppercase tracking-wider mb-4">
              <span className="w-2 h-2 bg-secondary-yellow rounded-full" />
              Pendidikan Untuk Semua
            </div>

            <h1 className="font-[var(--font-display)] text-4xl md:text-5xl lg:text-[56px] text-gray-900 leading-tight mb-6">
              Membuka Pintu{" "}
              <span className="text-primary-blue">Pendidikan Tinggi</span> untuk
              Setiap Anak Indonesia
            </h1>

            <p className="text-lg text-gray-600 mb-8 leading-relaxed">
              Kami hadir untuk mendobrak hambatan ekonomi dan geografis yang
              menghalangi siswa dari daerah terpencil dan keluarga kurang mampu
              dalam meraih impian mereka ke perguruan tinggi.
            </p>

            <div className="flex flex-wrap gap-4">
              <Link
                href="#activities"
                className="px-6 py-3 text-[15px] font-semibold text-white bg-primary-blue rounded-lg hover:bg-primary-blue-dark hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary-blue/30 transition-all"
              >
                Lihat Program Kami
              </Link>
              <Link
                href="/donasi"
                className="px-6 py-3 text-[15px] font-semibold text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 hover:text-primary-blue transition-all"
              >
                Dukung Misi Kami
              </Link>
            </div>

            {/* Stats */}
            <div className="flex gap-10 mt-12 pt-8 border-t border-gray-200">
              {heroStats.map((stat, index) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.2 + index * 0.1 }}
                  className="text-left"
                >
                  <div className="text-4xl font-extrabold text-primary-blue leading-none">
                    {stat.number.includes("+") || stat.number.includes("%") ? (
                      <>
                        {stat.number.replace(/[+%]/g, "")}
                        <span className="text-secondary-yellow">
                          {stat.number.includes("+") ? "+" : "%"}
                        </span>
                      </>
                    ) : (
                      stat.number
                    )}
                  </div>
                  <div className="text-sm text-gray-500 mt-2">{stat.label}</div>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Visual */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="relative"
          >
            <div className="w-full h-[450px] rounded-3xl shadow-2xl overflow-hidden relative">
              <Image
                src={heroImages.main}
                alt="Siswa Sakola Kembara belajar bersama"
                fill
                className="object-cover"
                priority
              />
            </div>

            {/* Floating badges */}
            <div className="absolute -top-8 -right-8 w-[200px] h-[140px] rounded-2xl shadow-xl overflow-hidden">
              <Image
                src={heroImages.badge1}
                alt="Kegiatan belajar kelompok"
                fill
                className="object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-secondary-yellow/80 to-transparent flex items-end justify-center pb-3">
                <span className="text-white text-xs font-semibold">
                  #PendidikanUntukSemua
                </span>
              </div>
            </div>

            <div className="absolute -bottom-8 -left-8 w-[200px] h-[140px] rounded-2xl shadow-xl overflow-hidden">
              <Image
                src={heroImages.badge2}
                alt="Siswa merayakan kelulusan"
                fill
                className="object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-secondary-green/80 to-transparent flex items-end justify-center pb-3">
                <span className="text-white text-xs font-semibold">
                  500+ Siswa Terbantu
                </span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
