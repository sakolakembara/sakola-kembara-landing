"use client";

import { motion } from "framer-motion";
import { useInView } from "framer-motion";
import { useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Heading } from "@/components/ui/heading";
import { SectionHeader } from "@/components/ui/section-header";
import { Tag } from "@/components/ui/tag";
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

      <Container className="relative z-10" ref={ref}>
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="mb-12 md:mb-16"
        >
          <SectionHeader
            tone="dark"
            eyebrow="Program Kami"
            title="Apa saja yang dilalui penerima manfaat Sakola Kembara?"
            lead="Program pembinaan komprehensif dari penjangkauan siswa hingga pendampingan alumni untuk memastikan keberhasilan jangka panjang."
          />
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
                  <Tag className="absolute top-4 left-4 z-10">{program.tag}</Tag>
                </div>

                {/* Content */}
                <div className="p-6 flex-1 flex flex-col">
                  <Heading
                    level="card"
                    className="text-gray-900 mb-4 group-hover:text-primary-blue transition-colors"
                  >
                    {program.title}
                  </Heading>
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
                  {/* Inside a card the CTA is filled. The whole card is the
                      link, so this is a styled span, not a nested link. */}
                  <span
                    className={buttonVariants({
                      fullWidth: true,
                      className: "mt-auto group-hover:bg-primary-blue-dark",
                    })}
                  >
                    Lihat Detail
                  </span>
                </div>
              </motion.div>
            </Link>
          ))}
        </div>
      </Container>
    </section>
  );
}
