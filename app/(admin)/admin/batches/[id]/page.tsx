import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CalendarDays, CheckCircle, Undo2, Users } from "lucide-react";
import { desc, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-helpers";
import {
  getBatchById,
  getBatchStatusCounts,
} from "@/lib/admission-batches";
import { db } from "@/lib/db";
import { applicationStatus, studentApplications, type ApplicationStatus } from "@/lib/db/schema";
import { BatchEditorForm } from "../_editor-form";
import { publishBatchResults, unpublishBatchResults } from "../actions";

export const metadata: Metadata = {
  title: "Detail Batch",
};

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  pending: "Pending",
  under_review: "Dalam Review",
  accepted: "Diterima",
  rejected: "Ditolak",
};
const STATUS_PILL: Record<ApplicationStatus, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  under_review: "bg-blue-50 text-blue-700 border-blue-200",
  accepted: "bg-green-50 text-green-700 border-green-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    created?: string;
    published?: string;
    unpublished?: string;
    error?: string;
  }>;
}

export default async function BatchDetailPage({ params, searchParams }: PageProps) {
  await requireAdmin();
  const { id } = await params;
  const { created, published, unpublished, error } = await searchParams;

  const batch = await getBatchById(id);
  if (!batch) notFound();

  const counts = await getBatchStatusCounts(id);
  const applications = await db
    .select({
      id: studentApplications.id,
      fullName: studentApplications.fullName,
      email: studentApplications.email,
      schoolName: studentApplications.schoolName,
      status: studentApplications.status,
      submittedAt: studentApplications.submittedAt,
    })
    .from(studentApplications)
    .where(eq(studentApplications.batchId, id))
    .orderBy(desc(studentApplications.submittedAt))
    .limit(100);

  const canPublish =
    !batch.resultsPublishedAt &&
    counts.total > 0 &&
    counts.pending === 0 &&
    counts.under_review === 0;

  return (
    <div className="p-6 md:p-10 max-w-6xl">
      <Link
        href="/admin/batches"
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-4"
      >
        ← Kembali ke daftar batch
      </Link>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Batch {batch.year}
          </p>
          <h1 className="font-[var(--font-display)] text-3xl text-gray-900 mb-1">
            {batch.name}
          </h1>
          <p className="text-sm text-gray-600 flex items-center gap-1.5">
            <CalendarDays size={14} />
            {batch.opensAt.toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short" })}
            {" — "}
            {batch.closesAt.toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short" })}
          </p>
        </div>
        {batch.resultsPublishedAt ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-full border bg-primary-blue/10 text-primary-blue border-primary-blue/30">
            <CheckCircle size={14} />
            Hasil dipublikasikan{" "}
            {batch.resultsPublishedAt.toLocaleDateString("id-ID", { dateStyle: "medium" })}
          </span>
        ) : null}
      </header>

      {created && <Banner tone="success">Batch berhasil dibuat.</Banner>}
      {published && <Banner tone="success">Hasil batch berhasil dipublikasikan.</Banner>}
      {unpublished && <Banner tone="success">Publikasi hasil dibatalkan.</Banner>}
      {error && <Banner tone="error">{error}</Banner>}

      <div className="grid lg:grid-cols-5 gap-6 items-start">
        <div className="lg:col-span-3 space-y-6">
          <section className="bg-white rounded-2xl border border-gray-100 p-6">
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4 flex items-center gap-2">
              <Users size={14} /> Ringkasan Pendaftar
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {applicationStatus.map((s) => (
                <div
                  key={s}
                  className="rounded-lg border border-gray-100 p-4 bg-gray-50"
                >
                  <div className="text-xs text-gray-500">{STATUS_LABEL[s]}</div>
                  <div className="text-2xl font-semibold text-gray-900 mt-1">
                    {counts[s]}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <header className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                Pendaftar di batch ini
              </h2>
              <Link
                href={`/admin/applications?batch=${batch.id}`}
                className="text-xs text-primary-blue font-medium hover:underline inline-flex items-center gap-1"
              >
                Lihat semua <ArrowRight size={12} />
              </Link>
            </header>
            {applications.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">
                Belum ada pendaftar untuk batch ini.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <Th>Nama</Th>
                      <Th>Sekolah</Th>
                      <Th>Status</Th>
                      <Th>Dikirim</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {applications.map((a) => (
                      <tr key={a.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <Link
                            href={`/admin/applications/${a.id}`}
                            className="font-medium text-gray-900 hover:text-primary-blue"
                          >
                            {a.fullName}
                          </Link>
                          {a.email && (
                            <div className="text-xs text-gray-500">{a.email}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-700">{a.schoolName}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full border ${STATUS_PILL[a.status]}`}
                          >
                            {STATUS_LABEL[a.status]}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {a.submittedAt.toLocaleString("id-ID", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="bg-white rounded-2xl border border-gray-100">
            <header className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                Ubah Data Batch
              </h2>
            </header>
            <div className="p-2">
              <BatchEditorForm mode="edit" batch={batch} />
            </div>
          </section>
        </div>

        <aside className="lg:col-span-2 lg:sticky lg:top-10 space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-2">
              Publikasi Hasil
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              Siswa hanya melihat hasil pendaftarannya setelah kamu klik
              publikasikan. Semua pendaftar di batch ini harus sudah diputuskan
              (diterima atau ditolak) sebelum publikasi.
            </p>
            {batch.resultsPublishedAt ? (
              <form action={unpublishBatchResults} className="space-y-3">
                <input type="hidden" name="id" value={batch.id} />
                <p className="text-sm text-gray-700 bg-primary-blue/5 border border-primary-blue/20 rounded-lg px-3 py-2">
                  Hasil sudah dipublikasikan pada{" "}
                  {batch.resultsPublishedAt.toLocaleString("id-ID", {
                    dateStyle: "long",
                    timeStyle: "short",
                  })}
                  .
                </p>
                <button
                  type="submit"
                  className="w-full inline-flex items-center justify-center gap-2 px-6 py-2.5 border-2 border-gray-200 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <Undo2 size={16} /> Batalkan Publikasi
                </button>
              </form>
            ) : (
              <form action={publishBatchResults} className="space-y-3">
                <input type="hidden" name="id" value={batch.id} />
                <ul className="text-xs text-gray-600 space-y-1 mb-3">
                  <li>• Total pendaftar: <b>{counts.total}</b></li>
                  <li>• Belum diputuskan: <b>{counts.pending + counts.under_review}</b></li>
                  <li>• Diterima: <b>{counts.accepted}</b></li>
                  <li>• Ditolak: <b>{counts.rejected}</b></li>
                </ul>
                <button
                  type="submit"
                  disabled={!canPublish}
                  className="w-full inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-primary-blue text-white font-semibold rounded-lg hover:bg-primary-blue-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <CheckCircle size={16} /> Publikasikan Hasil
                </button>
                {!canPublish && (
                  <p className="text-xs text-gray-500">
                    {counts.total === 0
                      ? "Belum ada pendaftar."
                      : "Selesaikan semua keputusan (Diterima / Ditolak) terlebih dahulu."}
                  </p>
                )}
              </form>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "success" | "error";
  children: React.ReactNode;
}) {
  const cls =
    tone === "success"
      ? "bg-green-50 border-green-200 text-green-700"
      : "bg-red-50 border-red-200 text-red-700";
  return (
    <div className={`border rounded-lg px-4 py-2 mb-4 text-sm ${cls}`}>
      {children}
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="text-left text-xs font-semibold uppercase tracking-wide px-4 py-3">
      {children}
    </th>
  );
}
