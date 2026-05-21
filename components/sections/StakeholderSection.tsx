"use client";

import { motion } from "framer-motion";
import { useInView } from "framer-motion";
import { useRef } from "react";
import Link from "next/link";
import { ArrowRight, Heart, GraduationCap, Handshake, BarChart3, Wallet, TrendingUp } from "lucide-react";
import { stakeholders, reports } from "@/lib/data";

const stakeholderIcons = [
  { Icon: Heart, iconBg: "bg-primary-blue/10", iconColor: "text-primary-blue" },
  { Icon: GraduationCap, iconBg: "bg-orange-500/10", iconColor: "text-orange-500" },
  { Icon: Handshake, iconBg: "bg-secondary-yellow/10", iconColor: "text-secondary-yellow" },
];

const reportIcons = [
  { Icon: BarChart3, iconBg: "bg-gray-200", iconColor: "text-gray-600" },
  { Icon: Wallet, iconBg: "bg-gray-200", iconColor: "text-gray-600" },
  { Icon: TrendingUp, iconBg: "bg-gray-200", iconColor: "text-gray-600" },
];

export default function StakeholderSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section className="py-24 bg-white" id="stakeholders">
      <div className="max-w-[1200px] mx-auto px-6" ref={ref}>
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h2 className="font-[var(--font-display)] text-4xl md:text-5xl text-gray-900 mb-6">
            Transparansi & Akuntabilitas
          </h2>
          <p className="text-lg text-gray-600 max-w-[600px] mx-auto">
            Kami berkomitmen untuk menjaga kepercayaan semua pihak yang mendukung
            misi kami melalui transparansi penuh dalam setiap kegiatan.
          </p>
        </motion.div>

        {/* Stakeholder Cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-16">
          {stakeholders.map((stakeholder, index) => {
            const { Icon, iconBg, iconColor } = stakeholderIcons[index];
            return (
              <motion.div
                key={stakeholder.id}
                initial={{ opacity: 0, y: 30 }}
                animate={isInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.6, delay: 0.2 + index * 0.15 }}
                className="bg-gray-50 border border-gray-100 rounded-2xl p-8 text-center flex flex-col hover:shadow-lg hover:-translate-y-1 transition-all duration-300"
              >
                <div
                  className={`w-16 h-16 ${iconBg} rounded-2xl mx-auto mb-5 flex items-center justify-center`}
                >
                  <Icon className={`w-8 h-8 ${iconColor}`} />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">{stakeholder.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed mb-5">
                  {stakeholder.description}
                </p>
                <Link
                  href={stakeholder.href}
                  className="mt-auto self-center inline-flex items-center gap-1.5 text-primary-blue text-sm font-semibold hover:underline"
                >
                  {stakeholder.link}
                  <ArrowRight size={14} />
                </Link>
              </motion.div>
            );
          })}
        </div>

        {/* Reports Section */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.6 }}
          className="pt-12 border-t border-gray-200"
        >
          <h3 className="text-2xl font-bold text-gray-900 text-center mb-8">
            Laporan & Dokumen
          </h3>
          <div className="grid md:grid-cols-3 gap-5">
            {reports.map((report, index) => {
              const { Icon, iconBg, iconColor } = reportIcons[index];
              return (
                <div
                  key={report.id}
                  className="bg-gray-50 border border-gray-100 rounded-xl p-5 flex items-center gap-4 hover:shadow-md transition-all cursor-pointer"
                >
                  <div className={`w-12 h-12 ${iconBg} rounded-lg flex items-center justify-center`}>
                    <Icon className={`w-6 h-6 ${iconColor}`} />
                  </div>
                  <div>
                    <h4 className="text-[15px] font-semibold text-gray-900 mb-0.5">
                      {report.title}
                    </h4>
                    <span className="text-[13px] text-gray-500">{report.size}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
