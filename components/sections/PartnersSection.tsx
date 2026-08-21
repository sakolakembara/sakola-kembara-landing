"use client";

import { motion } from "framer-motion";
import { useInView } from "framer-motion";
import { useRef } from "react";
import Image from "next/image";
import { activePartners, pastPartners, type Partner } from "@/lib/data";

/**
 * A row of logo cards under its own subheading. Split into "active" and
 * "past" groups so visitors can tell who we work with right now apart from
 * who has supported us before.
 */
function PartnerGroup({
  title,
  partners,
  isInView,
  delay,
}: {
  title: string;
  partners: Partner[];
  isInView: boolean;
  delay: number;
}) {
  if (partners.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay }}
    >
      {/* Subheading with hairlines that shrink to nothing on narrow screens */}
      <div className="flex items-center gap-4 mb-6 md:mb-8">
        <span className="hidden sm:block h-px flex-1 bg-gray-200" />
        <h3 className="text-xs sm:text-sm font-semibold text-accent-navy uppercase tracking-wider text-center">
          {title}
        </h3>
        <span className="hidden sm:block h-px flex-1 bg-gray-200" />
      </div>

      {/* items-stretch keeps every card the same height even when a partner
          name wraps to two or three lines. */}
      <div className="flex justify-center items-stretch flex-wrap gap-4 sm:gap-6 md:gap-8">
        {partners.map((partner, index) => (
          <motion.div
            key={partner.id}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={isInView ? { opacity: 1, scale: 1 } : {}}
            transition={{ duration: 0.4, delay: delay + 0.1 + index * 0.1 }}
            className="w-[136px] sm:w-40 bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col items-center gap-2.5 px-3 py-4 hover:border-primary-blue/40 hover:shadow-md transition-all"
          >
            <div className="h-11 sm:h-12 flex items-center justify-center">
              {/* Decorative: the partner name is spelled out right below, so
                  announcing it twice would only add noise for screen readers. */}
              <Image
                src={partner.logo}
                alt=""
                className="max-h-full w-auto object-contain"
              />
            </div>
            <span className="mt-auto text-[11px] sm:text-xs text-gray-700 font-medium text-center leading-snug text-balance">
              {partner.name}
            </span>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

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

        <div className="space-y-12 md:space-y-14">
          <PartnerGroup
            title="Partner & Pendukung Aktif"
            partners={activePartners}
            isInView={isInView}
            delay={0.2}
          />
          <PartnerGroup
            title="Pernah Bermitra & Mendukung"
            partners={pastPartners}
            isInView={isInView}
            delay={0.4}
          />
        </div>
      </div>
    </section>
  );
}
