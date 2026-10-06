"use client";

import { motion } from "framer-motion";
import { useInView } from "framer-motion";
import { Fragment, useId, useRef } from "react";
import { problemStats, type ProblemChart, type ProblemStat } from "@/lib/data";

export default function ProblemSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section className="py-16 md:py-24 bg-gradient-to-b from-primary-blue to-accent-navy text-white relative overflow-hidden">
      {/* Pattern overlay */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.03'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      />

      <div className="max-w-[1200px] mx-auto px-6 relative z-10" ref={ref}>
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="font-[var(--font-display)] text-[28px] sm:text-3xl md:text-4xl text-center mb-10 md:mb-12"
        >
          Mengapa Kami Ada?
        </motion.h2>

        <div className="grid md:grid-cols-3 gap-5 md:gap-6 mb-10 md:mb-12">
          {problemStats.map((stat, index) => (
            <motion.article
              key={stat.number}
              initial={{ opacity: 0, y: 30 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.2 + index * 0.15 }}
              className="flex flex-col gap-4 p-6 md:p-7 bg-white/[0.07] rounded-2xl border border-white/15"
            >
              <StatChart chart={stat.chart} />
              <div className="text-5xl md:text-[56px] font-extrabold text-secondary-yellow leading-none">
                {stat.number}
              </div>
              <p className="text-[15px] md:text-base text-white/85 leading-relaxed">
                {stat.text}
              </p>
              {stat.detail && <StatDetail stat={stat} />}
            </motion.article>
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.8 }}
          className="text-xl md:text-2xl font-semibold text-center"
        >
          Kami hadir untuk{" "}
          <span className="text-secondary-yellow">mengubah realitas ini.</span>
        </motion.p>
      </div>
    </section>
  );
}

/**
 * "Mengapa ini terjadi?" opens the longer explanation in a modal. Native
 * <dialog> + showModal() gives the focus trap, Escape to close and focus return
 * for free; clicking the backdrop (the dialog element itself) also closes it.
 */
function StatDetail({ stat }: { stat: ProblemStat }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => dialogRef.current?.showModal()}
        className="w-full h-10 px-4 rounded-lg border-[1.5px] border-white/60 text-sm font-semibold text-white hover:bg-white/10 transition-colors"
      >
        Mengapa ini terjadi?
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
        className="m-auto w-[calc(100%-2.5rem)] max-w-lg max-h-[calc(100dvh-2.5rem)] overflow-y-auto rounded-2xl border border-white/15 bg-accent-navy p-0 text-white shadow-2xl backdrop:bg-accent-navy/80 backdrop:backdrop-blur-sm"
      >
        <div className="p-6 md:p-8">
          <div className="text-center mb-6">
            <div className="text-5xl font-extrabold text-secondary-yellow mb-2">
              {stat.number}
            </div>
            <p className="text-lg font-medium">{stat.text}</p>
          </div>
          <div className="border-t border-white/10 pt-6">
            <h2 id={titleId} className="text-secondary-yellow font-semibold mb-3">
              Mengapa ini terjadi?
            </h2>
            <p className="text-white/85 leading-relaxed text-sm">{stat.detail}</p>
          </div>
          <form method="dialog">
            <button className="mt-6 w-full py-3 bg-secondary-yellow text-gray-900 font-semibold rounded-xl hover:bg-secondary-yellow/90 transition-colors">
              Tutup
            </button>
          </form>
        </div>
      </dialog>
    </>
  );
}

function StatChart({ chart }: { chart: ProblemChart }) {
  return (
    <div role="img" aria-label={chart.label} className="h-[124px] flex">
      {chart.kind === "pictogram" && (
        // One row; icons scale with the card (up to 28px) so ten always fit.
        <div className="self-center w-full grid grid-cols-10 gap-1.5">
          {Array.from({ length: chart.total }, (_, i) => (
            <Person key={i} filled={i < chart.highlighted} />
          ))}
        </div>
      )}

      {chart.kind === "share" && (
        <div className="self-center w-full flex flex-col gap-3">
          <span className="text-xs font-semibold text-white/75">{chart.caption}</span>
          <div className="flex h-9 rounded-lg overflow-hidden">
            <div className="bg-secondary-yellow" style={{ width: `${chart.share * 100}%` }} />
            <div className="flex-1 bg-white/20" />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-white/80">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-[3px] bg-secondary-yellow" />
              {chart.highlightLabel}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-[3px] bg-white/35" />
              {chart.restLabel}
            </span>
          </div>
        </div>
      )}

      {chart.kind === "ratio" && (
        <RatioBars bars={chart.bars} />
      )}
    </div>
  );
}

/** Progress bars scaled to the largest value; the first (the advantaged group) is highlighted. */
function RatioBars({ bars }: { bars: { name: string; value: number }[] }) {
  const max = Math.max(...bars.map((b) => b.value));
  return (
    <div className="self-center w-full grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-4">
      {bars.map((bar, i) => (
        <Fragment key={bar.name}>
          <span className="text-xs font-semibold text-white/80">{bar.name}</span>
          <div className="h-3 rounded-full bg-white/15 overflow-hidden">
            <div
              className={`h-full rounded-full ${i === 0 ? "bg-secondary-yellow" : "bg-white/45"}`}
              style={{ width: `${(bar.value / max) * 100}%` }}
            />
          </div>
        </Fragment>
      ))}
    </div>
  );
}

function Person({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 28 40"
      aria-hidden
      className={`w-full h-auto max-w-7 ${filled ? "text-secondary-yellow" : "text-white/45"}`}
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={2}
    >
      <circle cx="14" cy="8" r="6" />
      <path d="M3 38V27a11 11 0 0 1 22 0v11Z" />
    </svg>
  );
}
