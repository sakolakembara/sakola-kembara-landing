import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  HeartHandshake,
  Inbox,
} from "lucide-react";
import { requireStudent } from "@/lib/auth-helpers";
import { getApplicationsForUser } from "@/lib/student-applications";
import type { ApplicationStatus } from "@/lib/db/schema";

export const metadata: Metadata = {
  title: "Status Pendaftaran",
};

type Tone = "accepted" | "rejected" | "pending";

interface StatusView {
  tone: Tone;
  eyebrow: string;
  headline: string;
  body: string;
  icon: React.ReactNode;
}

/**
 * Derive what to show to the student. We deliberately hide the raw
 * accepted/rejected verdict until the batch's `resultsPublishedAt` is set,
 * even if the admin has already flipped the internal status — the promise to
 * students is that they only see the decision when the whole batch is
 * announced.
 */
function statusView(
  status: ApplicationStatus,
  batchPublishedAt: Date | null,
  reviewNotes: string | null,
): StatusView {
  const published = Boolean(batchPublishedAt);

  if (!published) {
    return {
      tone: "pending",
      eyebrow: "Sedang Diproses",
      headline: "Pendaftaran kamu sedang diproses",
      body: "Terima kasih sudah mendaftar. Panitia akan mengabari hasilnya di halaman ini setelah semua pendaftar batch ini selesai dinilai. Kamu tidak perlu mengirim ulang berkas.",
      icon: <Clock size={26} />,
    };
  }
  if (status === "accepted") {
    return {
      tone: "accepted",
      eyebrow: "Selamat",
      headline: "Kamu diterima",
      body:
        reviewNotes && reviewNotes.trim().length > 0
          ? reviewNotes
          : "Selamat, kamu diterima sebagai calon siswa Sakola Kembara. Panitia akan menghubungi kamu lewat WhatsApp untuk langkah selanjutnya.",
      icon: <CheckCircle2 size={26} />,
    };
  }
  if (status === "rejected") {
    return {
      tone: "rejected",
      eyebrow: "Terima Kasih",
      headline: "Belum lolos tahun ini",
      body:
        reviewNotes && reviewNotes.trim().length > 0
          ? reviewNotes
          : "Terima kasih atas kesediaan kamu mendaftar. Untuk batch ini, panitia belum bisa menerima pendaftaran kamu. Kamu boleh mencoba lagi di batch berikutnya.",
      icon: <HeartHandshake size={26} />,
    };
  }
  // Weird state — batch published but decision still pending. Show pending copy.
  return {
    tone: "pending",
    eyebrow: "Sedang Diproses",
    headline: "Menunggu keputusan",
    body: "Hasil batch ini sudah diumumkan, tapi keputusan untuk pendaftaran kamu belum tercatat. Silakan hubungi panitia via WhatsApp jika kondisi ini tidak berubah dalam 1×24 jam.",
    icon: <Clock size={26} />,
  };
}

const TONE_CARD: Record<Tone, string> = {
  accepted:
    "bg-gradient-to-br from-secondary-green/5 to-white border-secondary-green/30",
  rejected: "bg-gray-50 border-gray-200",
  pending: "bg-white border-amber-200",
};

const TONE_ICON: Record<Tone, string> = {
  accepted: "bg-secondary-green/10 text-secondary-green",
  rejected: "bg-gray-100 text-gray-500",
  pending: "bg-amber-50 text-amber-600",
};

const TONE_EYEBROW: Record<Tone, string> = {
  accepted: "text-secondary-green",
  rejected: "text-gray-500",
  pending: "text-amber-700",
};

export default async function StatusPage() {
  const student = await requireStudent("/portal/status");
  const applications = await getApplicationsForUser(student.userId);

  return (
    <>
      {/* Hero band — same pattern as the portal home for continuity. */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary-blue to-accent-navy text-white pt-14 md:pt-20 pb-16 md:pb-20">
        <div
          aria-hidden
          className="absolute -top-24 -right-24 w-96 h-96 bg-secondary-yellow/20 blur-3xl rounded-full pointer-events-none"
        />
        <div className="relative max-w-[1200px] mx-auto px-4 md:px-6">
          <div className="inline-flex items-center gap-2 text-xs md:text-sm font-semibold text-secondary-yellow uppercase tracking-wider mb-4">
            <span className="w-2 h-2 bg-secondary-yellow rounded-full" />
            Status Pendaftaran
          </div>
          <h1 className="font-[var(--font-display)] text-3xl md:text-5xl leading-tight mb-3">
            Rekap perjalanan pendaftaranmu
          </h1>
          <p className="text-base md:text-lg text-white/85 max-w-[620px] leading-relaxed">
            Setiap pendaftaran yang pernah kamu kirim di Sakola Kembara ada di
            sini. Hasil hanya muncul setelah panitia mengumumkan keputusan
            seluruh batch.
          </p>
        </div>
      </section>

      <div className="max-w-[820px] mx-auto px-4 md:px-6 -mt-10 md:-mt-14 pb-16 md:pb-24 space-y-6">
        {applications.length === 0 ? (
          <div className="bg-white rounded-3xl border border-gray-100 p-10 md:p-14 text-center shadow-sm">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-gray-100 mb-5">
              <Inbox size={26} className="text-gray-500" />
            </div>
            <h2 className="font-[var(--font-display)] text-xl md:text-2xl text-gray-900 mb-2">
              Belum ada pendaftaran
            </h2>
            <p className="text-sm text-gray-600 leading-relaxed max-w-[420px] mx-auto mb-6">
              Kamu belum pernah mengirim pendaftaran ke Sakola Kembara. Kembali
              ke portal untuk melihat batch yang sedang dibuka.
            </p>
            <Link
              href="/portal"
              className="inline-flex items-center gap-1.5 px-6 py-3 bg-primary-blue text-white font-semibold rounded-lg hover:bg-primary-blue-dark hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary-blue/30 transition-all"
            >
              Ke beranda portal <ArrowRight size={16} />
            </Link>
          </div>
        ) : (
          <ul className="space-y-6">
            {applications.map((app) => {
              const view = statusView(
                app.status,
                app.batch?.resultsPublishedAt ?? null,
                app.reviewNotes,
              );
              return (
                <li
                  key={app.id}
                  className={`rounded-3xl border shadow-sm ${TONE_CARD[view.tone]}`}
                >
                  <div className="p-7 md:p-10">
                    <header className="flex items-start gap-4 mb-5">
                      <div
                        className={`shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center ${TONE_ICON[view.tone]}`}
                      >
                        {view.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div
                          className={`inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider ${TONE_EYEBROW[view.tone]}`}
                        >
                          <span className="w-2 h-2 bg-secondary-yellow rounded-full" />
                          {view.eyebrow}
                          {app.batch && (
                            <span className="text-gray-400 font-medium normal-case tracking-normal">
                              · Batch {app.batch.year} · {app.batch.name}
                            </span>
                          )}
                        </div>
                        <h2 className="font-[var(--font-display)] text-xl md:text-2xl text-gray-900 mt-2 leading-tight">
                          {view.headline}
                        </h2>
                      </div>
                    </header>

                    <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
                      {view.body}
                    </p>

                    <footer className="mt-6 pt-4 border-t border-gray-100 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-gray-500">
                      <span>
                        Dikirim{" "}
                        <b className="text-gray-700 font-semibold">
                          {app.submittedAt.toLocaleString("id-ID", {
                            dateStyle: "long",
                            timeStyle: "short",
                          })}
                        </b>
                      </span>
                      {app.batch?.resultsPublishedAt && (
                        <span>
                          Diumumkan{" "}
                          <b className="text-gray-700 font-semibold">
                            {app.batch.resultsPublishedAt.toLocaleString(
                              "id-ID",
                              { dateStyle: "long" },
                            )}
                          </b>
                        </span>
                      )}
                    </footer>

                    {view.tone === "rejected" && (
                      <Link
                        href="/portal"
                        className="inline-flex items-center gap-1 mt-5 text-sm text-primary-blue font-semibold hover:underline"
                      >
                        Lihat batch pendaftaran berikutnya{" "}
                        <ArrowRight size={14} />
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
