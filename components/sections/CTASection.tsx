"use client";

import { motion } from "framer-motion";
import { useInView } from "framer-motion";
import { useRef } from "react";
import Link from "next/link";
import { Heart, Users, Handshake, GraduationCap } from "lucide-react";

const ctaOptions = [
  {
    id: "siswa",
    icon: GraduationCap,
    title: "Menjadi Siswa",
    description:
      "Daftarkan diri sebagai siswa Sakola Kembara dan raih kesempatan masuk perguruan tinggi terbaik di Indonesia.",
    buttonText: "Daftar Sekarang",
    href: "/gabung-siswa",
    color: "bg-orange-500",
    hoverColor: "hover:bg-orange-600",
    iconBg: "bg-orange-500/10",
    iconColor: "text-orange-500",
  },
  {
    id: "donatur",
    icon: Heart,
    title: "Menjadi Donatur",
    description:
      "Setiap donasi Anda membantu siswa dari keluarga kurang mampu mendapatkan akses pendidikan yang layak.",
    buttonText: "Donasi Sekarang",
    href: "/donasi",
    color: "bg-primary-blue",
    hoverColor: "hover:bg-primary-blue-dark",
    iconBg: "bg-primary-blue/10",
    iconColor: "text-primary-blue",
  },
  {
    id: "relawan",
    icon: Users,
    title: "Menjadi Relawan",
    description:
      "Bergabunglah dengan tim kami untuk berbagi ilmu dan pengalaman kepada siswa-siswa yang membutuhkan.",
    buttonText: "Gabung Tim",
    href: "/tim",
    color: "bg-secondary-green",
    hoverColor: "hover:bg-green-600",
    iconBg: "bg-secondary-green/10",
    iconColor: "text-secondary-green",
  },
  {
    id: "partner",
    icon: Handshake,
    title: "Menjadi Partner",
    description:
      "Kolaborasi bersama kami untuk memperluas dampak pendidikan ke lebih banyak daerah di Indonesia.",
    buttonText: "Hubungi Kami",
    href: "/kontak",
    color: "bg-secondary-yellow",
    hoverColor: "hover:bg-yellow-500",
    iconBg: "bg-secondary-yellow/10",
    iconColor: "text-secondary-yellow",
    textColor: "text-gray-900",
  },
];

export default function CTASection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section className="py-24 bg-gradient-to-br from-primary-blue to-accent-navy relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-white/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-secondary-yellow/20 rounded-full blur-3xl" />
      </div>

      <div className="max-w-[1200px] mx-auto px-6 relative z-10" ref={ref}>
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-secondary-yellow uppercase tracking-wider mb-4">
            <span className="w-2 h-2 bg-secondary-yellow rounded-full" />
            Bergabung Bersama Kami
          </div>
          <h2 className="font-[var(--font-display)] text-4xl md:text-5xl text-white mb-6">
            Jadilah Bagian dari Perubahan
          </h2>
          <p className="text-lg text-white/80 max-w-[600px] mx-auto">
            Ada banyak cara untuk berkontribusi dalam membuka akses pendidikan
            bagi anak-anak Indonesia. Pilih peran yang sesuai dengan Anda.
          </p>
        </motion.div>

        {/* CTA Cards */}
        <div className="grid md:grid-cols-2 gap-6 lg:gap-8 max-w-[900px] mx-auto">
          {ctaOptions.map((option, index) => (
            <motion.div
              key={option.id}
              initial={{ opacity: 0, y: 30 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.2 + index * 0.1 }}
              className="bg-white rounded-2xl p-8 text-center hover:-translate-y-2 hover:shadow-2xl transition-all duration-300"
            >
              {/* Icon */}
              <div
                className={`w-16 h-16 ${option.iconBg} rounded-2xl flex items-center justify-center mx-auto mb-6`}
              >
                <option.icon className={`w-8 h-8 ${option.iconColor}`} />
              </div>

              {/* Content */}
              <h3 className="text-xl font-bold text-gray-900 mb-3">
                {option.title}
              </h3>
              <p className="text-gray-600 mb-6 leading-relaxed">
                {option.description}
              </p>

              {/* Button */}
              <Link
                href={option.href}
                className={`inline-flex px-6 py-3 ${option.color} ${option.hoverColor} ${option.textColor || "text-white"} font-semibold rounded-xl transition-colors`}
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
          className="text-center text-white/60 mt-12 text-sm"
        >
          Bersama-sama, kita bisa membuka lebih banyak pintu pendidikan untuk
          generasi masa depan Indonesia.
        </motion.p>
      </div>
    </section>
  );
}
