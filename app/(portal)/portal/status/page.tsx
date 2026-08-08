import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Clock, HeartHandshake } from "lucide-react";
import { requireStudent } from "@/lib/auth-helpers";
import { getApplicationsForUser } from "@/lib/student-applications";
import type { ApplicationStatus } from "@/lib/db/schema";

export const metadata: Metadata = {
  title: "Status Pendaftaran",
};

interface StatusView {
  headline: string;
  tone: "accepted" | "rejected" | "pending";
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
      headline: "Pendaftaran kamu sedang diproses",
      body: "Terima kasih sudah mendaftar. Panitia akan mengabari hasilnya di halaman ini setelah semua pendaftar batch ini selesai dinilai. Kamu tidak perlu mengirim ulang berkas.",
      icon: <Clock size={28} className="text-amber-600" />,
    };
  }

  if (status === "accepted") {
    return {
      tone: "accepted",
      headline: "Selamat! Kamu diterima 🎉",
      body:
        reviewNotes && reviewNotes.trim().length > 0
          ? reviewNotes
          : "Selamat, kamu diterima sebagai calon siswa Sakola Kembara. Panitia akan menghubungi kamu lewat WhatsApp untuk langkah selanjutnya.",
      icon: <CheckCircle2 size={28} className="text-emerald-600" />,
    };
  }
  if (status === "rejected") {
    return {
      tone: "rejected",
      headline: "Belum lolos tahun ini",
      body:
        reviewNotes && reviewNotes.trim().length > 0
          ? reviewNotes
          : "Terima kasih atas kesediaan kamu mendaftar. Untuk batch ini, panitia belum bisa menerima pendaftaran kamu. Kamu boleh mencoba lagi di batch berikutnya.",
      icon: <HeartHandshake size={28} className="text-gray-600" />,
    };
  }
  // Weird state — batch published but decision still pending. Show pending.
  return {
    tone: "pending",
    headline: "Sedang diproses",
    body:
      "Hasil batch ini sudah diumumkan, tapi keputusan untuk pendaftaran kamu belum tercatat. Silakan hubungi panitia via WhatsApp jika kondisi ini tidak berubah dalam 1×24 jam.",
    icon: <Clock size={28} className="text-amber-600" />,
  };
}

export default async function StatusPage() {
  const student = await requireStudent("/portal/status");
  const applications = await getApplicationsForUser(student.userId);

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-10 space-y-6">
      <header>
        <h1 className="font-[var(--font-display)] text-3xl md:text-4xl text-gray-900">
          Status Pendaftaran
        </h1>
        <p className="text-gray-600 mt-1">
          Rekap pendaftaran kamu di seluruh batch Sakola Kembara.
        </p>
      </header>

      {applications.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-sm text-gray-600">
          <p>Kamu belum pernah mendaftar.</p>
          <Link
            href="/portal"
            className="inline-block mt-3 text-primary-blue font-medium hover:underline"
          >
            Kembali ke beranda portal →
          </Link>
        </div>
      ) : (
        <ul className="space-y-4">
          {applications.map((app) => {
            const view = statusView(
              app.status,
              app.batch?.resultsPublishedAt ?? null,
              app.reviewNotes,
            );
            const toneClass =
              view.tone === "accepted"
                ? "border-emerald-200 bg-emerald-50/50"
                : view.tone === "rejected"
                  ? "border-gray-200 bg-gray-50"
                  : "border-amber-200 bg-amber-50/50";
            return (
              <li
                key={app.id}
                className={`rounded-2xl border p-6 md:p-8 ${toneClass}`}
              >
                <header className="flex items-start gap-4">
                  <div className="shrink-0">{view.icon}</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {app.batch
                        ? `Batch ${app.batch.year} · ${app.batch.name}`
                        : "Pendaftaran"}
                    </p>
                    <h2 className="font-[var(--font-display)] text-xl text-gray-900 mt-1">
                      {view.headline}
                    </h2>
                  </div>
                </header>

                <p className="text-sm text-gray-700 leading-relaxed mt-4 whitespace-pre-wrap">
                  {view.body}
                </p>

                <footer className="mt-5 text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
                  <span>
                    Dikirim{" "}
                    {app.submittedAt.toLocaleString("id-ID", {
                      dateStyle: "long",
                      timeStyle: "short",
                    })}
                  </span>
                  {app.batch?.resultsPublishedAt && (
                    <span>
                      Diumumkan{" "}
                      {app.batch.resultsPublishedAt.toLocaleString("id-ID", {
                        dateStyle: "long",
                      })}
                    </span>
                  )}
                </footer>

                {view.tone === "rejected" && (
                  <Link
                    href="/portal"
                    className="inline-flex items-center mt-4 text-sm text-primary-blue font-medium hover:underline"
                  >
                    Lihat batch pendaftaran berikutnya →
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
