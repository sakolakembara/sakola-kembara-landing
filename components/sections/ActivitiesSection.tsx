"use client";

import { motion } from "framer-motion";
import { useInView } from "framer-motion";
import { useRef } from "react";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { programs } from "@/lib/data";

export default function ActivitiesSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section className="py-16 md:py-24 bg-gradient-to-br from-primary-blue to-accent-navy relative overflow-hidden" id="activities">
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
          className="text-center mb-12 md:mb-16"
        >
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-secondary-yellow uppercase tracking-wider mb-4">
            <span className="w-2 h-2 bg-secondary-yellow rounded-full" />
            Program Kami
          </div>
          <h2 className="font-[var(--font-display)] text-3xl sm:text-4xl md:text-5xl text-white mb-5 md:mb-6">
            Tiga Tahap Pembinaan
          </h2>
          <p className="text-base md:text-lg text-white/80 max-w-[600px] mx-auto">
            Program pembinaan komprehensif dari penjangkauan siswa hingga
            pendampingan alumni untuk memastikan keberhasilan jangka panjang.
          </p>
        </motion.div>

        {/* Programs Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
          {programs.map((program, index) => (
            <Link href={`/program/${program.id}`} key={program.id} className="block h-full">
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={isInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.6, delay: 0.2 + index * 0.15 }}
                className="group bg-white rounded-2xl overflow-hidden border border-gray-100 hover:-translate-y-2 hover:shadow-xl hover:border-transparent transition-all duration-300 cursor-pointer h-full flex flex-col"
              >
                {/* Image */}
                <div className="h-[180px] sm:h-[200px] relative overflow-hidden">
                  <Image
                    src={program.image}
                    alt={program.title}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <span className="absolute top-4 left-4 bg-primary-blue text-white px-3 py-1.5 rounded-md text-xs font-semibold z-10">
                    {program.tag}
                  </span>
                </div>

                {/* Content */}
                <div className="p-6 flex-1 flex flex-col">
                  <h3 className="text-xl font-bold text-gray-900 mb-4 group-hover:text-primary-blue transition-colors">
                    {program.title}
                  </h3>
                  <ul className="space-y-2 mb-5">
                    {program.points.map((point) => (
                      <li
                        key={point}
                        className="flex gap-2 text-[15px] text-gray-600 leading-relaxed"
                      >
                        <span className="mt-2 w-1.5 h-1.5 rounded-full bg-secondary-green flex-shrink-0" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-auto flex items-center gap-2 text-primary-blue font-semibold text-sm">
                    <span>Lihat Detail</span>
                    <ArrowRight
                      size={16}
                      className="group-hover:translate-x-1 transition-transform"
                    />
                  </div>
                </div>
              </motion.div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
