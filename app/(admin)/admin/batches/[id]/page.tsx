import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, CheckCircle, Undo2, Users } from "lucide-react";
import { desc, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-helpers";
import {
  getBatchById,
  getBatchStatusCounts,
} from "@/lib/admission-batches";
import { db } from "@/lib/db";
import { applicationStatus, studentApplications } from "@/lib/db/schema";
import { BatchEditorForm } from "../_editor-form";
import { publishBatchResults, unpublishBatchResults } from "../actions";
import { TableHint } from "../../_table-hint";
import { Table, THead, Th, TBody, Td } from "@/components/ui/table";
import { AdminPageHeader } from "../../_page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { APPLICATION_STATUS_LABEL, APPLICATION_STATUS_TONE } from "@/lib/application-status";

export const metadata: Metadata = {
  title: "Detail Batch",
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
      <AdminPageHeader
        back={{ href: "/admin/batches", label: "Kembali ke daftar batch" }}
        title={batch.name}
        overline={<>Batch {batch.year}</>}
        className="md:items-start"
        actions={
          batch.resultsPublishedAt && (
            <Tag tone="soft" size="lg">
              <CheckCircle size={14} />
              Hasil dipublikasikan{" "}
              {batch.resultsPublishedAt.toLocaleDateString("id-ID", { dateStyle: "medium" })}
            </Tag>
          )
        }
      >
        <p className="text-sm text-gray-600 flex items-center gap-1.5">
          <CalendarDays size={14} />
          {batch.opensAt.toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short" })}
          {" — "}
          {batch.closesAt.toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short" })}
        </p>
      </AdminPageHeader>

      {created && <Alert tone="success" className="mb-4">Batch berhasil dibuat.</Alert>}
      {published && <Alert tone="success" className="mb-4">Hasil batch berhasil dipublikasikan.</Alert>}
      {unpublished && <Alert tone="success" className="mb-4">Publikasi hasil dibatalkan.</Alert>}
      {error && <Alert className="mb-4">{error}</Alert>}

      <div className="grid lg:grid-cols-5 gap-6 items-start">
        {/* min-w-0 lets the applicants table scroll inside its card on phones
            instead of widening the whole column. */}
        <div className="lg:col-span-3 min-w-0 space-y-6">
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
                  <div className="text-xs text-gray-500">{APPLICATION_STATUS_LABEL[s]}</div>
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
                className="text-xs text-primary-blue font-medium hover:underline"
              >
                Lihat semua
              </Link>
            </header>
            {applications.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">
                Belum ada pendaftar untuk batch ini.
              </div>
            ) : (
              <Table>
                <TableHint />
                <THead>
                  <tr>
                    <Th>Nama</Th>
                    <Th>Sekolah</Th>
                    <Th>Status</Th>
                    <Th>Dikirim</Th>
                  </tr>
                </THead>
                <TBody>
                  {applications.map((a) => (
                    <tr key={a.id} className="hover:bg-gray-50">
                      <Td>
                        <Link
                          href={`/admin/applications/${a.id}`}
                          className="font-medium text-gray-900 hover:text-primary-blue"
                        >
                          {a.fullName}
                        </Link>
                        {a.email && (
                          <div className="text-xs text-gray-500">{a.email}</div>
                        )}
                      </Td>
                      <Td className="text-gray-700">{a.schoolName}</Td>
                      <Td>
                        <Tag tone={APPLICATION_STATUS_TONE[a.status]} size="sm">
                          {APPLICATION_STATUS_LABEL[a.status]}
                        </Tag>
                      </Td>
                      <Td className="text-xs text-gray-500">
                        {a.submittedAt.toLocaleString("id-ID", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </Td>
                    </tr>
                  ))}
                </TBody>
              </Table>
            
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

        <aside className="lg:col-span-2 lg:sticky lg:top-10 min-w-0 space-y-4">
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
                <Button type="submit" variant="neutral" fullWidth>
                  <Undo2 size={16} /> Batalkan Publikasi
                </Button>
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
                <Button type="submit" disabled={!canPublish} fullWidth>
                  <CheckCircle size={16} /> Publikasikan Hasil
                </Button>
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

