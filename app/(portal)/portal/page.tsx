import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileText,
  Sparkles,
} from "lucide-react";
import { requireStudent } from "@/lib/auth-helpers";
import { getCurrentOpenBatch } from "@/lib/admission-batches";
import {
  getApplicationsForUser,
  getUserApplicationForBatch,
  type PortalApplication,
} from "@/lib/student-applications";
import { VerifyEmailBanner } from "./_verify-email-banner";

export const metadata: Metadata = {
  title: "Beranda",
};

interface PageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function PortalHomePage({ searchParams }: PageProps) {
  // Stamp `now` once at the top of the request so the days-left computation
  // stays consistent across the render. The purity lint doesn't distinguish
  // server components (per-request) from client renders (re-runs) — the
  // impurity is intentional here.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const { error } = await searchParams;
  const student = await requireStudent("/portal");
  const firstName = student.name?.split(" ")[0] ?? "Sakemers";

  const [openBatch, applications] = await Promise.all([
    getCurrentOpenBatch(),
    getApplicationsForUser(student.userId),
  ]);

  const applicationForOpenBatch = openBatch
    ? await getUserApplicationForBatch(student.userId, openBatch.id)
    : null;

  return (
    <>
      {/* Hero band — matches sub-page hero pattern from the design docs. */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary-blue to-accent-navy text-white pt-14 md:pt-20 pb-16 md:pb-24">
        {/* Soft decorative orbs — same treatment as ActivitiesSection / CTASection. */}
        <div
          aria-hidden
          className="absolute -top-24 -right-24 w-96 h-96 bg-secondary-yellow/20 blur-3xl rounded-full pointer-events-none"
        />
        <div
          aria-hidden
          className="absolute -bottom-32 -left-24 w-96 h-96 bg-white/10 blur-3xl rounded-full pointer-events-none"
        />

        <div className="relative max-w-[1200px] mx-auto px-4 md:px-6">
          <div className="inline-flex items-center gap-2 text-xs md:text-sm font-semibold text-secondary-yellow uppercase tracking-wider mb-4">
            <span className="w-2 h-2 bg-secondary-yellow rounded-full" />
            Portal Siswa
          </div>
          <h1 className="font-[var(--font-display)] text-3xl md:text-5xl lg:text-6xl leading-tight mb-3">
            Selamat datang, {firstName}
          </h1>
          <p className="text-base md:text-lg text-white/85 max-w-[620px] leading-relaxed">
            Dari sini kamu bisa mendaftar sebagai calon siswa Sakola Kembara
            dan mengecek status pendaftaran ketika hasilnya diumumkan.
          </p>
        </div>
      </section>

      {/* Content — pulled up over the hero for a subtle overlap effect.
          Explicit `relative z-10` so it always paints on top of the hero
          band regardless of stacking-context quirks. */}
      <div className="relative z-10 max-w-[1200px] mx-auto px-4 md:px-6 -mt-10 md:-mt-14 pb-16 md:pb-24 space-y-6 md:space-y-8">
        {error === "admin-only" && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
            <span aria-hidden className="mt-0.5">⚠</span>
            <span>Halaman itu hanya untuk pengurus yayasan.</span>
          </div>
        )}

        {!student.emailVerifiedAt && (
          <VerifyEmailBanner email={student.email} />
        )}

        {/* Current-batch feature card. */}
        <CurrentBatchCard
          openBatch={openBatch}
          existing={applicationForOpenBatch ?? null}
          nowMs={nowMs}
        />

        {/* History card. */}
        <HistoryCard applications={applications} />
      </div>
    </>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function CurrentBatchCard({
  openBatch,
  existing,
  nowMs,
}: {
  openBatch: Awaited<ReturnType<typeof getCurrentOpenBatch>>;
  existing: NonNullable<
    Awaited<ReturnType<typeof getUserApplicationForBatch>>
  > | null;
  nowMs: number;
}) {
  if (!openBatch) {
    return (
      <section className="bg-white rounded-3xl border border-gray-100 p-8 md:p-10 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="shrink-0 w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center">
            <Clock size={22} className="text-gray-500" />
          </div>
          <div>
            <SectionEyebrow>Pendaftaran</SectionEyebrow>
            <h2 className="font-[var(--font-display)] text-xl md:text-2xl text-gray-900 mt-1">
              Belum ada batch yang dibuka
            </h2>
            <p className="text-gray-600 mt-2 leading-relaxed max-w-[560px]">
              Pendaftaran Sakola Kembara dibuka sekali dalam setahun. Panitia
              akan memberi tahu di halaman ini begitu batch berikutnya mulai.
              Sementara itu, kamu bisa cek program di halaman{" "}
              <Link
                href="/gabung-siswa"
                className="text-primary-blue font-semibold hover:underline"
              >
                Gabung Siswa
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (existing) {
    return (
      <section className="bg-white rounded-3xl border border-gray-100 p-8 md:p-10 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="shrink-0 w-12 h-12 rounded-2xl bg-secondary-green/10 flex items-center justify-center">
            <CheckCircle2 size={22} className="text-secondary-green" />
          </div>
          <div className="flex-1">
            <SectionEyebrow>Batch {openBatch.year}</SectionEyebrow>
            <h2 className="font-[var(--font-display)] text-xl md:text-2xl text-gray-900 mt-1">
              Pendaftaran kamu untuk {openBatch.name} sudah kami terima
            </h2>
            <p className="text-gray-600 mt-2 leading-relaxed max-w-[560px]">
              Kami akan mengabari hasilnya di halaman{" "}
              <Link
                href="/portal/status"
                className="text-primary-blue font-semibold hover:underline"
              >
                Status Pendaftaran
              </Link>{" "}
              setelah panitia selesai memutuskan seluruh pendaftar batch ini.
              Kamu tidak perlu mengirim ulang berkas.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const daysLeft = Math.max(
    0,
    Math.ceil((openBatch.closesAt.getTime() - nowMs) / (24 * 60 * 60 * 1000)),
  );

  // Open batch, no submission yet — the star card. White surface with a
  // yellow-accented left rail so it *contrasts* with the navy hero band
  // above, instead of merging into it.
  return (
    <section className="relative overflow-hidden rounded-3xl bg-white border border-gray-100 p-8 md:p-12 shadow-lg">
      {/* Yellow accent rail on the left — matches the eyebrow-dot color and
          signals "this is the primary action" without competing with the
          hero above. */}
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 w-1.5 bg-secondary-yellow"
      />
      <div className="relative">
        <div className="inline-flex items-center gap-2 text-xs md:text-sm font-semibold text-primary-blue uppercase tracking-wider mb-3">
          <span className="w-2 h-2 bg-secondary-yellow rounded-full" />
          Batch {openBatch.year} · Pendaftaran Dibuka
        </div>
        <h2 className="font-[var(--font-display)] text-2xl md:text-3xl lg:text-4xl text-gray-900 leading-tight mb-3">
          {openBatch.name}
        </h2>
        <p className="text-gray-600 text-base md:text-lg leading-relaxed max-w-[560px] mb-6">
          Isi formulir pendaftaran untuk mengajukan diri sebagai calon siswa.
          Progres kamu tersimpan otomatis, jadi bisa dilanjutkan kapan saja.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-[560px] mb-8">
          <MetaChip
            label="Tutup pendaftaran"
            value={openBatch.closesAt.toLocaleDateString("id-ID", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
            icon={<CalendarClock size={14} />}
          />
          <MetaChip
            label="Sisa waktu"
            value={
              daysLeft > 0 ? `${daysLeft} hari lagi` : "Ditutup hari ini"
            }
            icon={<Clock size={14} />}
          />
          <MetaChip
            label="Kuota"
            value="Terbatas"
            icon={<Sparkles size={14} />}
          />
        </div>

        <Link
          href="/portal/daftar"
          className="inline-flex items-center gap-2 px-8 py-4 bg-primary-blue text-white font-semibold rounded-xl hover:bg-primary-blue-dark hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary-blue/30 transition-all"
        >
          Mulai daftar <ArrowRight size={18} />
        </Link>

        {openBatch.description && (
          <p className="text-sm text-gray-500 mt-6 max-w-[560px] whitespace-pre-wrap">
            {openBatch.description}
          </p>
        )}
      </div>
    </section>
  );
}

function MetaChip({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-gray-500 mb-1">
        {icon}
        {label}
      </div>
      <div className="text-sm font-semibold text-gray-900">{value}</div>
    </div>
  );
}

/**
 * Registration-history card. Deliberately verdict-free: the accepted /
 * rejected decision only ever renders on /portal/status, so this card at most
 * says "the result is out, go look". Listing the batches a student has sent
 * keeps the history useful without leaking the outcome here.
 */
function HistoryCard({ applications }: { applications: PortalApplication[] }) {
  const published = applications.some(
    (app) => app.batch?.resultsPublishedAt != null,
  );

  return (
    <section className="bg-white rounded-3xl border border-gray-100 p-8 md:p-10 shadow-sm">
      <div className="flex items-start gap-4">
        <div
          className={`shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center ${
            published
              ? "bg-secondary-yellow/20 text-primary-blue"
              : "bg-gray-100 text-gray-500"
          }`}
        >
          {published ? <Sparkles size={22} /> : <FileText size={22} />}
        </div>
        <div className="flex-1 min-w-0">
          <SectionEyebrow>Riwayat</SectionEyebrow>
          <h2 className="font-[var(--font-display)] text-xl md:text-2xl text-gray-900 mt-1">
            {applications.length === 0
              ? "Riwayat pendaftaran"
              : published
                ? "Hasil pendaftaran kamu sudah keluar"
                : "Hasil belum diumumkan"}
          </h2>

          {applications.length === 0 ? (
            <p className="text-gray-600 mt-2 leading-relaxed max-w-[560px]">
              Kamu belum pernah mengirim pendaftaran. Setelah kirim, setiap
              pendaftaran yang kamu kirim akan tercatat di sini.
            </p>
          ) : (
            <>
              <p className="text-gray-600 mt-2 leading-relaxed max-w-[560px]">
                {published
                  ? "Panitia sudah mengumumkan keputusan batch kamu. Silakan buka halaman Status Pendaftaran untuk melihat hasilnya."
                  : "Panitia masih menilai seluruh pendaftar batch ini. Hasilnya akan muncul di halaman Status Pendaftaran begitu diumumkan."}
              </p>

              <ul className="mt-5 divide-y divide-gray-100 border-y border-gray-100">
                {applications.map((app) => (
                  <li key={app.id} className="py-3">
                    <div className="font-semibold text-gray-900 truncate">
                      {app.batch
                        ? `${app.batch.year} · ${app.batch.name}`
                        : "Pendaftaran"}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      Dikirim{" "}
                      {app.submittedAt.toLocaleString("id-ID", {
                        dateStyle: "medium",
                      })}
                    </div>
                  </li>
                ))}
              </ul>

              <Link
                href="/portal/status"
                className={`inline-flex items-center gap-2 mt-6 font-semibold rounded-xl transition-all ${
                  published
                    ? "px-6 py-3 bg-primary-blue text-white hover:bg-primary-blue-dark hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary-blue/30"
                    : "text-sm text-primary-blue hover:underline"
                }`}
              >
                {published ? "Lihat hasil" : "Buka Status Pendaftaran"}
                <ArrowRight size={published ? 18 : 14} />
              </Link>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 text-xs font-semibold text-primary-blue uppercase tracking-wider">
      <span className="w-2 h-2 bg-secondary-yellow rounded-full" />
      {children}
    </div>
  );
}
