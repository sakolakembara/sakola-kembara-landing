"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { heroStats, heroImages } from "@/lib/data";

export default function HeroSection() {
  return (
    <section className="pt-[var(--hero-top,8rem)] md:pt-40 pb-16 md:pb-24 bg-gradient-to-b from-gray-50 to-white relative overflow-hidden">
      {/* Background decoration */}
      <div
        aria-hidden
        className="absolute -top-1/2 -right-1/5 w-[800px] h-[800px] bg-[radial-gradient(circle,rgba(30,136,229,0.08)_0%,transparent_70%)] rounded-full"
      />

      <Container>
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Text Content */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <Eyebrow className="mb-4">Pendidikan Untuk Semua</Eyebrow>

            <Heading level="display" className="text-gray-900 mb-5 md:mb-6">
              Membuka Pintu{" "}
              <span className="text-primary-blue">Pendidikan Tinggi</span> untuk
              Setiap Anak Indonesia
            </Heading>

            <p className="text-base md:text-lg text-gray-600 mb-7 md:mb-8 leading-relaxed">
              Kami hadir untuk mendobrak hambatan ekonomi dan geografis yang
              menghalangi siswa dari daerah terpencil dan keluarga kurang mampu
              dalam meraih impian mereka ke perguruan tinggi.
            </p>

            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:gap-4">
              {/* The lift on hover is the hero's own touch (DESIGN.md, Buttons). */}
              <Button
                href="#activities"
                className="transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary-blue/30"
              >
                Lihat Program Kami
              </Button>
              <Button href="/donasi" variant="subtle">
                Dukung Misi Kami
              </Button>
            </div>

            {/* Stats — a grid, not a flex row. As a flex row the three items
                could not shrink below their min-content width, which pushed
                the whole document wider than a phone screen and clipped every
                line of hero copy. */}
            <div className="grid grid-cols-3 gap-4 sm:gap-8 mt-10 md:mt-12 pt-8 border-t border-gray-200">
              {heroStats.map((stat, index) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.2 + index * 0.1 }}
                  className="text-left"
                >
                  <div className="text-[28px] sm:text-4xl font-extrabold text-primary-blue leading-none">
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
                  <div className="text-xs sm:text-sm text-gray-500 mt-1.5 sm:mt-2 leading-snug">
                    {stat.label}
                  </div>
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
            <div className="w-full aspect-[4/3] md:aspect-auto md:h-[450px] rounded-2xl md:rounded-3xl shadow-xl md:shadow-2xl overflow-hidden relative">
              <Image
                src={heroImages.main}
                alt="Siswa Sakola Kembara belajar bersama"
                fill
                className="object-cover"
                priority
              />
            </div>
          </motion.div>
        </div>
      </Container>
    </section>
  );
}
