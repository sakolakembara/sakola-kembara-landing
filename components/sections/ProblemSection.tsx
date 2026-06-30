"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useInView } from "framer-motion";
import { useRef, useState } from "react";
import { problemStats } from "@/lib/data";

export default function ProblemSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });
  const [selectedStat, setSelectedStat] = useState<typeof problemStats[0] | null>(null);

  return (
    <section className="py-24 bg-gray-900 text-white relative overflow-hidden">
      {/* Pattern overlay */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.03'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      />

      <div className="max-w-[900px] mx-auto px-6 text-center relative z-10" ref={ref}>
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="font-[var(--font-display)] text-3xl md:text-4xl mb-12"
        >
          Mengapa Kami Ada?
        </motion.h2>

        <div className="grid md:grid-cols-3 gap-8 mb-12">
          {problemStats.map((stat, index) => (
            <motion.div
              key={stat.number}
              initial={{ opacity: 0, y: 30 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.2 + index * 0.15 }}
              className={`p-8 bg-white/5 rounded-2xl border border-white/10 ${
                stat.detail ? "cursor-pointer hover:bg-white/10 hover:border-secondary-yellow/50 transition-all duration-300" : ""
              }`}
              onClick={() => stat.detail && setSelectedStat(stat)}
            >
              <div className="text-5xl md:text-6xl font-extrabold text-secondary-yellow leading-none mb-3">
                {stat.number}
              </div>
              <p className="text-base text-gray-300 leading-relaxed">
                {stat.text}
              </p>
              {stat.detail && (
                <p className="text-xs text-secondary-yellow/70 mt-3">
                  Klik untuk info lebih lanjut
                </p>
              )}
            </motion.div>
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.8 }}
          className="text-2xl font-semibold"
        >
          Kami hadir untuk{" "}
          <span className="text-secondary-yellow">mengubah realitas ini.</span>
        </motion.p>
      </div>

      {/* Modal */}
      <AnimatePresence>
        {selectedStat && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-6"
            onClick={() => setSelectedStat(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ duration: 0.3 }}
              className="bg-gray-800 rounded-2xl p-8 max-w-lg w-full border border-white/10 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-center mb-6">
                <div className="text-5xl font-extrabold text-secondary-yellow mb-2">
                  {selectedStat.number}
                </div>
                <p className="text-lg text-white font-medium">
                  {selectedStat.text}
                </p>
              </div>
              <div className="border-t border-white/10 pt-6">
                <h4 className="text-secondary-yellow font-semibold mb-3">Mengapa ini terjadi?</h4>
                <p className="text-gray-300 leading-relaxed text-sm">
                  {selectedStat.detail}
                </p>
              </div>
              <button
                onClick={() => setSelectedStat(null)}
                className="mt-6 w-full py-3 bg-secondary-yellow text-gray-900 font-semibold rounded-xl hover:bg-secondary-yellow/90 transition-colors"
              >
                Tutup
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
