import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  Briefcase,
  Calendar,
  ExternalLink,
  FileText,
  GraduationCap,
  Home,
  Instagram,
  MessageCircle,
  Settings2,
  User,
  Users,
} from "lucide-react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  studentApplications,
  type StudentApplicationFormData,
} from "@/lib/db/schema";
import { formatRupiah } from "@/lib/student-form-types";
import { ReviewForm } from "./_review-form";
import { AdminPageHeader } from "../../_page-header";
import { Tag } from "@/components/ui/tag";
import { APPLICATION_STATUS_LABEL, APPLICATION_STATUS_TONE } from "@/lib/application-status";

export const metadata: Metadata = {
  title: "Detail Pendaftar",
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

  const fd = application.formData as StudentApplicationFormData | null;

  return (
    <div className="p-6 md:p-10 max-w-6xl">
      <AdminPageHeader
        back={{ href: "/admin/applications", label: "Kembali ke daftar" }}
        title={application.fullName}
        overline="Detail pendaftar"
        className="md:items-start"
        actions={
          <Tag tone={APPLICATION_STATUS_TONE[application.status]} size="lg">
            {APPLICATION_STATUS_LABEL[application.status]}
          </Tag>
        }
      >
        <p className="text-gray-600">
          {application.email ?? (
            <a
              href={`https://wa.me/${application.whatsapp.replace(/[^\d]/g, "")}`}
              className="inline-flex items-center gap-1 text-primary-blue hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              <MessageCircle size={12} />
              {application.whatsapp}
            </a>
          )}
        </p>
      </AdminPageHeader>

      <div className="grid lg:grid-cols-5 gap-6 items-start">
        {/* Left: applicant profile */}
        <div className="lg:col-span-3 min-w-0 bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <ProfileSection
            title="Identitas"
            icon={<User size={14} />}
            rows={[
              { label: "Nama Lengkap", value: application.fullName },
              ...(fd?.identity.nickname
                ? [{ label: "Panggilan", value: fd.identity.nickname }]
                : []),
              ...(fd?.identity.gender
                ? [
                    {
                      label: "Jenis Kelamin",
                      value: fd.identity.gender === "laki-laki" ? "Laki-laki" : "Perempuan",
                    },
                  ]
                : []),
              ...(fd?.identity.religion
                ? [{ label: "Agama", value: fd.identity.religion }]
                : []),
              ...(application.email
                ? [{ label: "Email", value: application.email }]
                : []),
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
              ...(fd?.identity.homeAddress
                ? [
                    {
                      label: "Alamat Rumah",
                      value: (
                        <p className="whitespace-pre-wrap text-gray-700 leading-relaxed">
                          {fd.identity.homeAddress}
                        </p>
                      ),
                      stack: true,
                    },
                  ]
                : []),
            ]}
          />
          <ProfileSection
            title="Pendidikan"
            icon={<GraduationCap size={14} />}
            rows={[
              { label: "Asal Sekolah", value: application.schoolName },
              { label: "Tahun Angkatan", value: application.graduationYear },
              {
                label: "Cabang",
                value: application.branchPreference ?? "—",
              },
            ]}
          />

          {fd?.household && (
            <ProfileSection
              title="Keluarga & Ekonomi"
              icon={<Users size={14} />}
              rows={[
                {
                  label: "Tinggal Bersama",
                  value: fd.household.livingWith.join(", ") || "—",
                },
                {
                  label: "Ayah",
                  value: `${fd.household.father.name} · ${fd.household.father.occupation}`,
                },
                {
                  label: "Penghasilan Ayah",
                  value: formatRupiah(fd.household.father.income),
                },
                {
                  label: "Ibu",
                  value: `${fd.household.mother.name} · ${fd.household.mother.occupation}`,
                },
                {
                  label: "Penghasilan Ibu",
                  value: formatRupiah(fd.household.mother.income),
                },
                ...fd.household.otherEarners.map((e, i) => ({
                  label: `Anggota Lain ${i + 1}`,
                  value: `${e.relation} · ${formatRupiah(e.income)}`,
                })),
                {
                  label: "Jumlah Anggota Keluarga",
                  value: `${fd.household.familySize} orang`,
                },
              ]}
            />
          )}

          {fd?.housing && (
            <ProfileSection
              title="Tempat Tinggal"
              icon={<Home size={14} />}
              rows={[
                {
                  label: "Status Tempat Tinggal",
                  value: fd.housing.residenceStatus,
                },
                {
                  label: "Luas Bangunan",
                  value: `${fd.housing.buildingArea} m²`,
                },
                {
                  label: "Kendaraan",
                  value: `${fd.housing.motorcycles} motor · ${fd.housing.cars} mobil`,
                },
                fd.housing.debt
                  ? {
                      label: "Hutang",
                      value: (
                        <div className="text-gray-700 leading-relaxed">
                          <div>
                            <b>{fd.housing.debt.type}</b> —{" "}
                            {formatRupiah(fd.housing.debt.amount)}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {fd.housing.debt.installmentMonths} bulan ·{" "}
                            {fd.housing.debt.description}
                          </div>
                        </div>
                      ),
                      stack: true,
                    }
                  : { label: "Hutang", value: "Tidak ada" },
              ]}
            />
          )}

          {fd?.organizations && (
            <ProfileSection
              title="Organisasi"
              icon={<Briefcase size={14} />}
              rows={
                fd.organizations.length === 0
                  ? [{ label: "Pengalaman", value: "Belum pernah" }]
                  : fd.organizations.map((o, i) => ({
                      label: `Organisasi ${i + 1}`,
                      value: `${o.name} — ${o.position}`,
                    }))
              }
            />
          )}

          {fd?.documents && (
            <ProfileSection
              title="Berkas Pendaftaran"
              icon={<FileText size={14} />}
              rows={[
                docRow("Surat Penghasilan Ayah", fd.documents.fatherIncomeUrl),
                docRow("Surat Penghasilan Ibu", fd.documents.motherIncomeUrl),
                docRow(
                  "Surat Penghasilan Anggota Lain 1",
                  fd.documents.otherEarner1IncomeUrl,
                ),
                docRow(
                  "Surat Penghasilan Anggota Lain 2",
                  fd.documents.otherEarner2IncomeUrl,
                ),
                docRow("Bukti Hutang", fd.documents.debtProofUrl),
                docRow(
                  "Tagihan/Token Listrik",
                  fd.documents.electricityBillUrl,
                ),
                docRow("Kartu Keluarga", fd.documents.familyCardUrl),
                docRow(
                  "Surat Izin Orang Tua",
                  fd.documents.parentPermissionUrl,
                ),
                docRow("Foto Diri", fd.documents.selfPhotoUrl),
                docRow("Foto Rumah", fd.documents.houseImagesUrl),
                docRow("Foto Kendaraan", fd.documents.vehicleImagesUrl),
                {
                  label: "Terdaftar DTKS",
                  value: fd.documents.dtksRegistered ? "Ya" : "Tidak",
                },
                ...(fd.documents.dtksRegistered
                  ? [docRow("SKTM DTKS", fd.documents.dtksUrl)]
                  : []),
              ]}
            />
          )}

          {fd?.marketing && (
            <ProfileSection
              title="Berkas Marketing"
              icon={<Instagram size={14} />}
              rows={[
                {
                  label: "Instagram",
                  value: (
                    <a
                      href={`https://instagram.com/${fd.marketing.instagramUsername.replace(/^@/, "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary-blue hover:underline"
                    >
                      <Instagram size={12} />@{fd.marketing.instagramUsername}
                    </a>
                  ),
                },
                docRow(
                  "Bukti Follow @sakolakembara",
                  fd.marketing.instagramFollowProofUrl,
                ),
                docRow(
                  "Bukti Share Broadcast WA",
                  fd.marketing.broadcastProofUrl,
                ),
                docRow("Bukti Upload Twibbon", fd.marketing.twibbonUploadUrl),
                docRow(
                  "Bukti Share Story Instagram",
                  fd.marketing.storyUploadUrl,
                ),
              ]}
            />
          )}

          {fd?.interview && (
            <ProfileSection
              title="Interview Tertulis"
              icon={<User size={14} />}
              rows={[
                {
                  label: "Motivasi Pendidikan Tinggi",
                  value: <LongText text={fd.interview.motivationHigherEducation} />,
                  stack: true,
                },
                {
                  label: "Motivasi Sakola Kembara",
                  value: <LongText text={fd.interview.motivationSakem} />,
                  stack: true,
                },
                {
                  label: "Rencana Konsistensi",
                  value: <LongText text={fd.interview.consistencyPlan} />,
                  stack: true,
                },
                {
                  label: "Komitmen Kehadiran",
                  value: <LongText text={fd.interview.attendanceCommitment} />,
                  stack: true,
                },
                {
                  label: "Tanggapan Orang Tua",
                  value: <LongText text={fd.interview.parentResponse} />,
                  stack: true,
                },
                {
                  label: "Jika Orang Tua Berubah Pikiran",
                  value: <LongText text={fd.interview.ifParentChangesMind} />,
                  stack: true,
                },
                {
                  label: "Siap Materai",
                  value: fd.interview.agreedToSignedStatement ? "Ya" : "Tidak",
                },
              ]}
            />
          )}

          {/* Legacy motivation/economic-background fallback (old form rows) */}
          {!fd && application.motivation && (
            <ProfileSection
              title="Cerita (Legacy)"
              icon={<User size={14} />}
              rows={[
                {
                  label: "Motivasi",
                  value: <LongText text={application.motivation} />,
                  stack: true,
                },
                ...(application.economicBackground
                  ? [
                      {
                        label: "Latar Belakang Ekonomi",
                        value: <LongText text={application.economicBackground} />,
                        stack: true,
                      },
                    ]
                  : []),
              ]}
            />
          )}

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
                      value: <LongText text={application.reviewNotes} />,
                      stack: true,
                    },
                  ]
                : []),
            ]}
          />
        </div>

        {/* Right: sticky status action card */}
        <aside className="lg:col-span-2 lg:sticky lg:top-10 min-w-0">
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <header className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
              <Settings2 size={14} className="text-gray-500" />
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                Ubah Status
              </h2>
            </header>

            <ReviewForm
              applicationId={application.id}
              currentStatus={application.status}
              currentReviewNotes={application.reviewNotes}
              formError={error ?? null}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

function LongText({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap text-gray-700 leading-relaxed">{text}</p>
  );
}

function docRow(label: string, url: string | null): ProfileRow {
  return {
    label,
    value: url ? (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-primary-blue hover:underline break-all"
      >
        <ExternalLink size={12} />
        {url}
      </a>
    ) : (
      <span className="text-gray-400">—</span>
    ),
    stack: true,
  };
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
        {rows.map((row, i) => (
          <div
            key={`${row.label}-${i}`}
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
