import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  GraduationCap,
  MapPin,
  MessageCircle,
  Settings2,
  User,
} from "lucide-react";
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

const STATUS_PILL: Record<ApplicationStatus, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  under_review: "bg-blue-50 text-blue-700 border-blue-200",
  accepted: "bg-green-50 text-green-700 border-green-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
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
    <div className="p-6 md:p-10 max-w-6xl">
      <Link
        href="/admin/applications"
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-4"
      >
        <ArrowLeft size={14} />
        Kembali ke daftar
      </Link>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Detail pendaftar
          </p>
          <h1 className="font-[var(--font-display)] text-3xl text-gray-900 mb-1">
            {application.fullName}
          </h1>
          <p className="text-gray-600">{application.email}</p>
        </div>
        <span
          className={`inline-flex items-center text-sm font-medium px-3 py-1.5 rounded-full border ${STATUS_PILL[application.status]}`}
        >
          {STATUS_LABEL[application.status]}
        </span>
      </header>

      <div className="grid lg:grid-cols-5 gap-6 items-start">
        {/* Left: applicant profile */}
        <div className="lg:col-span-3 bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <ProfileSection
            title="Identitas"
            icon={<User size={14} />}
            rows={[
              {
                label: "Nama Lengkap",
                value: application.fullName,
              },
              { label: "Email", value: application.email },
              {
                label: "WhatsApp",
                value: (
                  <a
                    href={`https://wa.me/${application.whatsapp.replace(/[^\d]/g, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary-blue hover:underline"
                  >
                    <MessageCircle size={12} />
                    {application.whatsapp}
                  </a>
                ),
              },
            ]}
          />
          <ProfileSection
            title="Pendidikan"
            icon={<GraduationCap size={14} />}
            rows={[
              {
                label: "Asal Sekolah",
                value: application.schoolName,
              },
              {
                label: "Tahun Lulus",
                value: application.graduationYear,
              },
              {
                label: "Cabang Pilihan",
                value: (
                  <span className="inline-flex items-center gap-1">
                    {application.branchPreference ? (
                      <>
                        <MapPin size={12} className="text-gray-400" />
                        {application.branchPreference}
                      </>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </span>
                ),
              },
            ]}
          />
          <ProfileSection
            title="Cerita"
            icon={<User size={14} />}
            rows={[
              {
                label: "Motivasi",
                value: (
                  <p className="whitespace-pre-wrap text-gray-700 leading-relaxed">
                    {application.motivation}
                  </p>
                ),
                stack: true,
              },
              ...(application.economicBackground
                ? [
                    {
                      label: "Latar Belakang Ekonomi",
                      value: (
                        <p className="whitespace-pre-wrap text-gray-700 leading-relaxed">
                          {application.economicBackground}
                        </p>
                      ),
                      stack: true,
                    },
                  ]
                : []),
            ]}
          />
          <ProfileSection
            title="Pengajuan"
            icon={<Calendar size={14} />}
            isLast
            rows={[
              {
                label: "Dikirim",
                value: application.submittedAt.toLocaleString("id-ID", {
                  dateStyle: "long",
                  timeStyle: "short",
                }),
              },
              {
                label: "Ditinjau Terakhir",
                value: application.reviewedAt
                  ? application.reviewedAt.toLocaleString("id-ID", {
                      dateStyle: "long",
                      timeStyle: "short",
                    })
                  : <span className="text-gray-400">Belum ditinjau</span>,
              },
              ...(application.reviewNotes
                ? [
                    {
                      label: "Catatan Review Terakhir",
                      value: (
                        <p className="whitespace-pre-wrap text-gray-700 leading-relaxed">
                          {application.reviewNotes}
                        </p>
                      ),
                      stack: true,
                    },
                  ]
                : []),
            ]}
          />
        </div>

        {/* Right: sticky status action card */}
        <aside className="lg:col-span-2 lg:sticky lg:top-10">
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <header className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
              <Settings2 size={14} className="text-gray-500" />
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                Ubah Status
              </h2>
            </header>

            <form action={updateApplicationStatus} className="p-6 space-y-4">
              <input type="hidden" name="id" value={application.id} />

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}

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
                  rows={6}
                  defaultValue={application.reviewNotes ?? ""}
                  placeholder="Wajib diisi saat menerima atau menolak. Catatan ini tersimpan di audit log."
                  className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-primary-blue focus:outline-none resize-none text-sm"
                />
              </div>

              <button
                type="submit"
                className="w-full px-6 py-2.5 bg-primary-blue text-white font-semibold rounded-lg hover:bg-primary-blue-dark transition-colors"
              >
                Simpan Perubahan
              </button>

              <p className="text-xs text-gray-500">
                Perubahan status menulis entry di <span className="font-mono">audit_log</span>{" "}
                dengan email reviewer dan timestamp.
              </p>
            </form>
          </div>
        </aside>
      </div>
    </div>
  );
}

interface ProfileRow {
  label: string;
  value: React.ReactNode;
  stack?: boolean;
}

function ProfileSection({
  title,
  icon,
  rows,
  isLast,
}: {
  title: string;
  icon?: React.ReactNode;
  rows: ProfileRow[];
  isLast?: boolean;
}) {
  return (
    <section className={isLast ? "" : "border-b border-gray-100"}>
      <header className="px-6 pt-5 pb-3 flex items-center gap-2">
        {icon && <span className="text-gray-500">{icon}</span>}
        <h2 className="text-xs font-semibold text-gray-900 uppercase tracking-wide">
          {title}
        </h2>
      </header>
      <div className="px-6 pb-5 space-y-3">
        {rows.map((row) => (
          <div
            key={row.label}
            className={
              row.stack
                ? "space-y-1.5"
                : "grid md:grid-cols-[180px_1fr] gap-2 text-sm"
            }
          >
            <div className="text-xs md:text-sm text-gray-500">{row.label}</div>
            <div className="text-sm text-gray-900">{row.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
