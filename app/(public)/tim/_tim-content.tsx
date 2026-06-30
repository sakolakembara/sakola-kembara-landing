"use client";

import { motion } from "framer-motion";
import { User } from "lucide-react";
import type { TeamMember } from "@/lib/db/schema";

interface TimContentProps {
  members: TeamMember[];
}

export function TimContent({ members }: TimContentProps) {
  return (
    <main className="min-h-screen bg-gray-50">
      {/* Hero */}
      <section className="bg-gradient-to-br from-primary-blue to-accent-navy text-white pb-20 pt-[var(--hero-top,8rem)]">
        <div className="max-w-[1200px] mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="font-[var(--font-display)] text-4xl md:text-5xl lg:text-6xl mb-6">
              Pahlawan di Balik Sakola Kembara
            </h1>
            <p className="text-lg text-white/90 max-w-[600px]">
              Didukung oleh pengurus dan relawan dari berbagai universitas terbaik
              di Indonesia yang berkomitmen untuk pendidikan yang setara.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Team Grid */}
      <section className="py-16">
        <div className="max-w-[1200px] mx-auto px-6">
          {members.length === 0 ? (
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="text-center text-gray-500 py-12"
            >
              Profil tim akan segera tampil di sini.
            </motion.p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {members.map((member, index) => (
                <motion.div
                  key={member.id}
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.1 + index * 0.08 }}
                  className="bg-white rounded-2xl p-6 text-center border border-gray-100 hover:-translate-y-1 hover:shadow-lg transition-all duration-300"
                >
                  <div className="w-24 h-24 mx-auto mb-4 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center">
                    {member.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={member.image}
                        alt={member.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User size={32} className="text-gray-300" />
                    )}
                  </div>

                  <h4 className="text-base font-bold text-gray-900 mb-1">
                    {member.name}
                  </h4>
                  <p className="text-sm font-medium text-primary-blue mb-2">
                    {member.role}
                  </p>
                  {member.university && (
                    <p className="text-[13px] text-gray-500">
                      {member.university}
                    </p>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 bg-white">
        <div className="max-w-[800px] mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="font-[var(--font-display)] text-3xl md:text-4xl text-gray-900 mb-4">
              Ingin Bergabung dengan Tim?
            </h2>
            <p className="text-lg text-gray-600 mb-8">
              Kami selalu mencari relawan yang bersemangat untuk berkontribusi dalam
              membuka akses pendidikan bagi siswa Indonesia.
            </p>
            <div className="flex justify-center">
              <a
                href="https://linktr.ee/JoinSakolaKembara"
                target="_blank"
                rel="noopener noreferrer"
                className="px-8 py-4 bg-primary-blue text-white font-semibold rounded-xl hover:bg-primary-blue-dark transition-colors"
              >
                Bergabung Menjadi Relawan
              </a>
            </div>
          </motion.div>
        </div>
      </section>
    </main>
  );
}
