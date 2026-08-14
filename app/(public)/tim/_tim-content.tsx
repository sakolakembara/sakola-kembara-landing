"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Briefcase,
  GraduationCap,
  User,
  X,
} from "lucide-react";
import type { TeamCategory, TeamMember } from "@/lib/db/schema";
import { TEAM_CATEGORY_LABEL, TEAM_CATEGORY_ORDER } from "@/lib/team-types";

interface TimContentProps {
  members: TeamMember[];
}

const CATEGORY_DESCRIPTION: Record<TeamCategory, string> = {
  dewan_pembina:
    "Memberi arah strategis dan menjaga misi Sakola Kembara tetap selaras dengan cita-cita pendidikan yang setara.",
  dewan_pengawas:
    "Mengawasi tata kelola dan akuntabilitas, memastikan setiap program berjalan sesuai prinsip dan standar yang kami pegang.",
  pengurus:
    "Menjalankan operasional harian — dari kurasi program, kemitraan, hingga pendampingan siswa di lapangan.",
};

export function TimContent({ members }: TimContentProps) {
  const [active, setActive] = useState<TeamMember | null>(null);

  const grouped = useMemo(() => {
    const byCategory = new Map<TeamCategory, TeamMember[]>();
    for (const c of TEAM_CATEGORY_ORDER) byCategory.set(c, []);
    for (const m of members) {
      byCategory.get(m.category)?.push(m);
    }
    return TEAM_CATEGORY_ORDER.map((c) => ({
      category: c,
      members: byCategory.get(c) ?? [],
    }));
  }, [members]);

  const hasAnyMember = members.length > 0;

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Hero */}
      <section className="bg-gradient-to-br from-primary-blue to-accent-navy text-white pb-14 md:pb-20 pt-[var(--hero-top,8rem)]">
        <div className="max-w-[1200px] mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="font-[var(--font-display)] text-3xl sm:text-4xl md:text-5xl lg:text-6xl mb-6">
              Pahlawan di Balik Sakola Kembara
            </h1>
            <p className="text-base md:text-lg text-white/90 max-w-[600px]">
              Didukung oleh pengurus dan relawan dari berbagai universitas
              terbaik di Indonesia yang berkomitmen untuk pendidikan yang
              setara.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Sections by category */}
      <section className="py-16 md:py-20">
        <div className="max-w-[1200px] mx-auto px-6 space-y-16">
          {!hasAnyMember && (
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="text-center text-gray-500 py-12"
            >
              Profil tim akan segera tampil di sini.
            </motion.p>
          )}
          {grouped.map(({ category, members: list }) =>
            list.length === 0 ? null : (
              <section key={category}>
                <header className="mb-6">
                  <h2 className="font-[var(--font-display)] text-3xl md:text-4xl text-gray-900 mb-2">
                    {TEAM_CATEGORY_LABEL[category]}
                  </h2>
                  <p className="text-gray-600 max-w-[700px]">
                    {CATEGORY_DESCRIPTION[category]}
                  </p>
                </header>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                  {list.map((member, index) => (
                    <motion.button
                      key={member.id}
                      type="button"
                      onClick={() => setActive(member)}
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true, amount: 0.2 }}
                      transition={{
                        duration: 0.5,
                        delay: Math.min(index * 0.04, 0.24),
                      }}
                      className="group text-center bg-white rounded-2xl p-6 border border-gray-100 hover:-translate-y-1 hover:shadow-lg focus-visible:-translate-y-1 focus-visible:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-blue transition-all duration-300 cursor-pointer"
                      aria-label={`Lihat profil ${member.name}`}
                    >
                      <div className="w-28 h-28 mx-auto mb-4 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center">
                        {member.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={member.image}
                            alt={member.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <User size={36} className="text-gray-300" />
                        )}
                      </div>
                      <h3 className="text-base font-bold text-gray-900 mb-1">
                        {member.name}
                      </h3>
                      <p className="text-sm font-medium text-primary-blue">
                        {member.role}
                      </p>
                    </motion.button>
                  ))}
                </div>
              </section>
            ),
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
              Kami selalu mencari relawan yang bersemangat untuk berkontribusi
              dalam membuka akses pendidikan bagi siswa Indonesia.
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

      <MemberDrawer member={active} onClose={() => setActive(null)} />
    </main>
  );
}

function MemberDrawer({
  member,
  onClose,
}: {
  member: TeamMember | null;
  onClose: () => void;
}) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const open = member !== null;

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Focus the close button so keyboard users land somewhere sensible
    // instead of the invisible backdrop.
    closeBtnRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const education = member?.educationHistory ?? [];
  const work = member?.workHistory ?? [];

  return (
    <div
      className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`}
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/50 transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />
      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={member ? `member-${member.id}-name` : undefined}
        className={`absolute top-0 right-0 h-full w-full max-w-[540px] bg-white shadow-2xl overflow-y-auto transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {member && (
          <>
            <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-white/95 backdrop-blur border-b border-gray-100">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {TEAM_CATEGORY_LABEL[member.category]}
              </span>
              <button
                ref={closeBtnRef}
                type="button"
                onClick={onClose}
                className="p-2 -mr-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                aria-label="Tutup"
              >
                <X size={20} />
              </button>
            </div>

            <div className="px-6 py-6">
              <div className="flex flex-col items-center text-center mb-6">
                <div className="w-36 h-36 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center mb-4 border-4 border-white shadow-md">
                  {member.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={member.image}
                      alt={member.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <User size={48} className="text-gray-300" />
                  )}
                </div>
                <h2
                  id={`member-${member.id}-name`}
                  className="font-[var(--font-display)] text-2xl md:text-3xl text-gray-900"
                >
                  {member.name}
                </h2>
                <p className="text-sm font-semibold text-primary-blue mt-1">
                  {member.role}
                </p>
              </div>

              {member.bio && (
                <DrawerSection title="Tentang">
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">
                    {member.bio}
                  </p>
                </DrawerSection>
              )}

              {education.length > 0 && (
                <DrawerSection
                  title="Riwayat Pendidikan"
                  icon={<GraduationCap size={16} />}
                >
                  <ul className="space-y-3">
                    {education.map((e, i) => (
                      <li key={i} className="text-sm">
                        <div className="font-medium text-gray-900">
                          {e.institution}
                        </div>
                        {(e.degree || e.year) && (
                          <div className="text-gray-500 text-[13px] mt-0.5">
                            {[e.degree, e.year].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </DrawerSection>
              )}

              {work.length > 0 && (
                <DrawerSection
                  title="Riwayat Pekerjaan"
                  icon={<Briefcase size={16} />}
                >
                  <ul className="space-y-3">
                    {work.map((w, i) => (
                      <li key={i} className="text-sm">
                        <div className="font-medium text-gray-900">
                          {w.role}
                        </div>
                        <div className="text-gray-600 text-[13px] mt-0.5">
                          {w.organization}
                          {w.period ? ` · ${w.period}` : ""}
                        </div>
                      </li>
                    ))}
                  </ul>
                </DrawerSection>
              )}

              {!member.bio && education.length === 0 && work.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-6">
                  Detail profil akan segera tersedia.
                </p>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function DrawerSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6 last:mb-0">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}
