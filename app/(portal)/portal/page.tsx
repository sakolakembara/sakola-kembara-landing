import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarClock, CheckCircle2, Clock, FileText } from "lucide-react";
import { requireStudent } from "@/lib/auth-helpers";
import { getCurrentOpenBatch } from "@/lib/admission-batches";
import { getApplicationsForUser, getUserApplicationForBatch } from "@/lib/student-applications";
import type { ApplicationStatus } from "@/lib/db/schema";

export const metadata: Metadata = {
  title: "Beranda",
};

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  pending: "Menunggu review",
  under_review: "Sedang direview",
  accepted: "Diterima",
  rejected: "Belum lolos",
};

interface PageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function PortalHomePage({ searchParams }: PageProps) {
  const { error } = await searchParams;
  const student = await requireStudent("/portal");

  const [openBatch, applications] = await Promise.all([
    getCurrentOpenBatch(),
    getApplicationsForUser(student.userId),
  ]);

  const applicationForOpenBatch = openBatch
    ? await getUserApplicationForBatch(student.userId, openBatch.id)
    : null;

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6 py-10 space-y-8">
      <header>
        <p className="text-sm text-gray-500">
          Selamat datang, {student.name?.split(" ")[0] ?? "calon Sakemers"} 👋
        </p>
        <h1 className="font-[var(--font-display)] text-3xl md:text-4xl text-gray-900 mt-1">
          Portal Siswa
        </h1>
        <p className="text-gray-600 mt-2 max-w-2xl">
          Dari sini kamu bisa mendaftar sebagai calon siswa Sakola Kembara dan
          mengecek status pendaftaran ketika hasil diumumkan.
        </p>
      </header>

      {error === "admin-only" && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          Halaman admin hanya untuk pengurus yayasan.
        </div>
      )}

      <section className="bg-white rounded-2xl border border-gray-100 p-6 md:p-8">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4 flex items-center gap-2">
          <CalendarClock size={14} /> Pendaftaran saat ini
        </h2>

        {openBatch ? (
          applicationForOpenBatch ? (
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="text-emerald-600 shrink-0 mt-0.5" size={20} />
                <div>
                  <div className="font-medium text-gray-900">
                    Pendaftaran kamu untuk {openBatch.name} sudah terkirim.
                  </div>
                  <p className="text-sm text-gray-600 mt-1">
                    Kami akan mengabari hasilnya di halaman{" "}
                    <Link href="/portal/status" className="text-primary-blue font-medium hover:underline">
                      Status Pendaftaran
                    </Link>{" "}
                    setelah panitia selesai memutuskan seluruh pendaftar batch ini.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-500">Batch {openBatch.year}</p>
                <p className="text-lg font-semibold text-gray-900">
                  {openBatch.name}
                </p>
                <p className="text-sm text-gray-600 mt-1">
                  Pendaftaran dibuka hingga{" "}
                  <b>
                    {openBatch.closesAt.toLocaleString("id-ID", {
                      dateStyle: "long",
                      timeStyle: "short",
                    })}
                  </b>
                  .
                </p>
                {openBatch.description && (
                  <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">
                    {openBatch.description}
                  </p>
                )}
              </div>
              <Link
                href="/gabung-siswa/form"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-blue text-white font-semibold rounded-lg hover:bg-primary-blue-dark transition-colors"
              >
                Mulai daftar <ArrowRight size={16} />
              </Link>
            </div>
          )
        ) : (
          <div className="flex items-start gap-3 text-gray-600">
            <Clock className="shrink-0 mt-0.5" size={20} />
            <div>
              <div className="font-medium text-gray-900">
                Belum ada batch pendaftaran yang dibuka.
              </div>
              <p className="text-sm mt-1">
                Pendaftaran Sakola Kembara dibuka sekali dalam setahun. Pantau
                akun ini — kami akan menampilkan formulir pendaftaran di sini
                begitu batch berikutnya dibuka.
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-gray-100 p-6 md:p-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide flex items-center gap-2">
            <FileText size={14} /> Riwayat pendaftaran
          </h2>
          {applications.length > 0 && (
            <Link
              href="/portal/status"
              className="text-xs text-primary-blue font-medium hover:underline inline-flex items-center gap-1"
            >
              Detail <ArrowRight size={12} />
            </Link>
          )}
        </div>

        {applications.length === 0 ? (
          <p className="text-sm text-gray-500">
            Kamu belum pernah mengirim pendaftaran. Setelah kirim, riwayatnya
            akan muncul di sini.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {applications.map((app) => {
              const showResult =
                (app.status === "accepted" || app.status === "rejected") &&
                app.batch?.resultsPublishedAt !== null &&
                app.batch !== null;
              return (
                <li key={app.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 truncate">
                      {app.batch ? `${app.batch.year} · ${app.batch.name}` : "Pendaftaran"}
                    </div>
                    <div className="text-xs text-gray-500">
                      Dikirim{" "}
                      {app.submittedAt.toLocaleString("id-ID", { dateStyle: "medium" })}
                    </div>
                  </div>
                  <span className="text-xs font-medium text-gray-700 whitespace-nowrap">
                    {showResult ? STATUS_LABEL[app.status] : "Menunggu hasil"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
