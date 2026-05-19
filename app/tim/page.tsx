"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import Image from "next/image";
import { teamMembers } from "@/lib/data";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export default function TimPage() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-gray-50">
        {/* Hero Section */}
        <section className="bg-gradient-to-br from-primary-blue to-accent-navy text-white pt-32 pb-20">
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
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {teamMembers.map((member, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
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
                      unoptimized
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
                <Link
                  href="/kontak"
                  className="px-8 py-4 bg-primary-blue text-white font-semibold rounded-xl hover:bg-primary-blue-dark transition-colors"
                >
                  Bergabung Menjadi Relawan
                </Link>
              </div>
            </motion.div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
