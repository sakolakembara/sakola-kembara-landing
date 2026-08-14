"use client";

import { motion } from "framer-motion";
import { useInView } from "framer-motion";
import { useRef } from "react";
import { partners } from "@/lib/data";

export default function PartnersSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section className="py-16 md:py-24 bg-[#F5F7FA]" id="partners">
      <div className="max-w-[1200px] mx-auto px-6" ref={ref}>
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-primary-blue uppercase tracking-wider mb-4">
            <span className="w-2 h-2 bg-secondary-yellow rounded-full" />
            Partner Kami
          </div>
          <h2 className="font-[var(--font-display)] text-3xl sm:text-4xl md:text-5xl text-gray-900 mb-5 md:mb-6">
            Bersama Mewujudkan Perubahan
          </h2>
          <p className="text-base md:text-lg text-gray-600 max-w-[600px] mx-auto">
            Terima kasih kepada semua partner yang telah mendukung misi kami
            untuk pendidikan yang setara.
          </p>
        </motion.div>

        {/* Partners Grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="flex justify-center items-center flex-wrap gap-5 sm:gap-8 md:gap-12"
        >
          {partners.map((partner, index) => (
            <motion.div
              key={partner.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={isInView ? { opacity: 1, scale: 1 } : {}}
              transition={{ duration: 0.4, delay: 0.3 + index * 0.1 }}
              className="w-[136px] sm:w-40 h-20 bg-white rounded-xl border border-gray-200 shadow-sm flex items-center justify-center hover:border-primary-blue/40 hover:shadow-md transition-all cursor-pointer"
            >
              <span className="text-xs text-gray-700 font-medium text-center px-2">
                {partner.name}
              </span>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
