import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  applicationStatus,
  studentApplications,
  type ApplicationStatus,
} from "@/lib/db/schema";
import { updateApplicationStatus } from "./actions";

export const metadata: Metadata = {
  title: "Detail Pendaftar",
};

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  pending: "Pending",
  under_review: "Dalam Review",
  accepted: "Diterima",
  rejected: "Ditolak",
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}

export default async function ApplicationDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { error } = await searchParams;

  const application = await db.query.studentApplications.findFirst({
    where: eq(studentApplications.id, id),
  });

  if (!application) notFound();

  return (
    <div className="max-w-3xl">
      <Link
        href="/admin/applications"
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-4"
      >
        <ArrowLeft size={14} />
        Kembali ke daftar
      </Link>

      <header className="mb-8">
        <h1 className="font-[var(--font-display)] text-3xl text-gray-900 mb-1">
          {application.fullName}
        </h1>
        <p className="text-gray-600">{application.email}</p>
      </header>

      <section className="bg-white rounded-xl border border-gray-100 p-6 mb-6 space-y-4">
        <Row label="Status saat ini">
          <span className="font-medium text-gray-900">
            {STATUS_LABEL[application.status]}
          </span>
          {application.reviewedAt && (
            <span className="ml-2 text-xs text-gray-500">
              · ditinjau{" "}
              {application.reviewedAt.toLocaleString("id-ID", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
          )}
        </Row>
        <Row label="Dikirim">
          {application.submittedAt.toLocaleString("id-ID", {
            dateStyle: "long",
            timeStyle: "short",
          })}
        </Row>
        <Row label="Nomor WhatsApp">
          <a
            href={`https://wa.me/${application.whatsapp.replace(/[^\d]/g, "")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-blue hover:underline"
          >
            {application.whatsapp}
          </a>
        </Row>
        <Row label="Asal Sekolah">{application.schoolName}</Row>
        <Row label="Tahun Lulus">{application.graduationYear}</Row>
        <Row label="Cabang Pilihan">
          {application.branchPreference || "—"}
        </Row>
        <Row label="Motivasi">
          <p className="whitespace-pre-wrap text-gray-700">
            {application.motivation}
          </p>
        </Row>
        {application.economicBackground && (
          <Row label="Latar Belakang Ekonomi">
            <p className="whitespace-pre-wrap text-gray-700">
              {application.economicBackground}
            </p>
          </Row>
        )}
        {application.reviewNotes && (
          <Row label="Catatan Review">
            <p className="whitespace-pre-wrap text-gray-700">
              {application.reviewNotes}
            </p>
          </Row>
        )}
      </section>

      <section className="bg-gray-50 border border-gray-200 rounded-xl p-6">
        <h2 className="font-semibold text-gray-900 mb-4">Ubah Status</h2>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 mb-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <form action={updateApplicationStatus} className="space-y-4">
          <input type="hidden" name="id" value={application.id} />

          <div>
            <label
              htmlFor="status"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Status baru
            </label>
            <select
              id="status"
              name="status"
              defaultValue={application.status}
              required
              className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-primary-blue focus:outline-none bg-white"
            >
              {applicationStatus.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="reviewNotes"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Catatan Review
            </label>
            <textarea
              id="reviewNotes"
              name="reviewNotes"
              rows={4}
              defaultValue={application.reviewNotes ?? ""}
              placeholder="Wajib diisi saat menerima atau menolak. Jelaskan alasannya — catatan ini tersimpan di audit log."
              className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-primary-blue focus:outline-none resize-none"
            />
          </div>

          <button
            type="submit"
            className="px-6 py-2.5 bg-primary-blue text-white font-semibold rounded-lg hover:bg-primary-blue-dark transition-colors"
          >
            Simpan Perubahan
          </button>
        </form>
      </section>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid md:grid-cols-[200px_1fr] gap-2 text-sm">
      <div className="text-gray-500">{label}</div>
      <div className="text-gray-900">{children}</div>
    </div>
  );
}
