"use client";

import { motion } from "framer-motion";
import { useInView } from "framer-motion";
import { useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { teamMembers } from "@/lib/data";

export default function TeamSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section className="py-24 bg-gray-50" id="team">
      <div className="max-w-[1200px] mx-auto px-6" ref={ref}>
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-primary-blue uppercase tracking-wider mb-4">
            <span className="w-2 h-2 bg-secondary-yellow rounded-full" />
            Tim Kami
          </div>
          <h2 className="font-[var(--font-display)] text-4xl md:text-5xl text-gray-900 mb-6">
            Pahlawan di Balik Sakola Kembara
          </h2>
          <p className="text-lg text-gray-600 max-w-[600px] mx-auto">
            Didukung oleh pengurus dan relawan dari berbagai universitas terbaik
            di Indonesia yang berkomitmen untuk pendidikan yang setara.
          </p>
        </motion.div>

        {/* Team Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {teamMembers.map((member, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 30 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.1 + index * 0.08 }}
              className="bg-white rounded-2xl p-6 text-center border border-gray-100 hover:-translate-y-1 hover:shadow-lg transition-all duration-300"
            >
              {/* Avatar */}
              <div className="w-24 h-24 mx-auto mb-4 rounded-full overflow-hidden relative">
                <Image
                  src={member.image}
                  alt={member.name}
                  fill
                  className="object-cover"
                />
              </div>

              <h4 className="text-base font-bold text-gray-900 mb-1">
                {member.name}
              </h4>
              <p className="text-sm font-medium text-primary-blue mb-2">
                {member.role}
              </p>
              <p className="text-[13px] text-gray-500">{member.university}</p>
            </motion.div>
          ))}
        </div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.8 }}
          className="text-center mt-12"
        >
          <Link
            href="#join"
            className="inline-flex px-6 py-3 text-[15px] font-semibold text-white bg-primary-blue rounded-lg hover:bg-primary-blue-dark hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary-blue/30 transition-all mr-3"
          >
            Bergabung Menjadi Relawan
          </Link>
          <Link
            href="#"
            className="inline-flex px-6 py-3 text-[15px] font-semibold text-gray-700 border-2 border-gray-200 rounded-lg hover:border-primary-blue hover:text-primary-blue transition-all"
          >
            Lihat Semua Tim
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
