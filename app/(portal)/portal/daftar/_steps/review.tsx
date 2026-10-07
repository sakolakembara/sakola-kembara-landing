"use client";

import { Pencil } from "lucide-react";
import type { FormValues, StepId } from "@/lib/student-form-types";
import { StepHeader } from "./identity";
import { Alert } from "@/components/ui/alert";

type Props = {
  values: FormValues;
  onEditStep: (id: StepId) => void;
};

export function ReviewStep({ values, onEditStep }: Props) {
  const identity = values.identity;
  const household = values.household;
  const housing = values.housing;
  const orgs = values.organizations;
  const docs = values.documents;
  const marketing = values.marketing;
  const interview = values.interview;

  return (
    <div className="space-y-6">
      <StepHeader
        title="Tinjau & Kirim"
        subtitle="Periksa kembali seluruh isian sebelum menekan tombol kirim. Klik ikon pensil untuk mengubah bagian tertentu."
      />

      <ReviewSection
        title="Identitas Pribadi"
        onEdit={() => onEditStep("identity")}
        rows={[
          ["Nama Lengkap", identity.fullName],
          ["Nama Panggilan", identity.nickname],
          ["Jenis Kelamin", identity.gender],
          ["Agama", identity.religion],
          ["Asal Sekolah", identity.schoolName],
          ["Cabang", identity.branch],
          ["Alamat", identity.homeAddress],
          ["Tahun Angkatan Kelulusan", identity.graduationBatch],
          ["WhatsApp", identity.whatsapp],
        ]}
      />

      <ReviewSection
        title="Keluarga & Ekonomi"
        onEdit={() => onEditStep("household")}
        rows={[
          ["Tinggal bersama", household.livingWith.join(", ") || "—"],
          ["Nama Ayah", household.fatherName],
          ["Pekerjaan Ayah", household.fatherOccupation],
          ["Penghasilan Ayah", household.fatherIncome],
          ["Nama Ibu", household.motherName],
          ["Pekerjaan Ibu", household.motherOccupation],
          ["Penghasilan Ibu", household.motherIncome],
          ...(household.hasOtherEarner1
            ? ([
                ["Anggota Lain 1 — Hubungan", household.earner1Relation ?? "—"],
                ["Anggota Lain 1 — Penghasilan", household.earner1Income ?? "—"],
              ] as [string, string][])
            : []),
          ...(household.hasOtherEarner2
            ? ([
                ["Anggota Lain 2 — Hubungan", household.earner2Relation ?? "—"],
                ["Anggota Lain 2 — Penghasilan", household.earner2Income ?? "—"],
              ] as [string, string][])
            : []),
          ["Jumlah Anggota Keluarga", String(household.familySize ?? "—")],
        ]}
      />

      <ReviewSection
        title="Tempat Tinggal & Hutang"
        onEdit={() => onEditStep("housing")}
        rows={[
          ["Status Tempat Tinggal", housing.residenceStatus],
          ["Luas Bangunan", housing.buildingArea ? `${housing.buildingArea} m²` : "—"],
          ["Motor", String(housing.motorcycles ?? 0)],
          ["Mobil", String(housing.cars ?? 0)],
          ["Hutang", housing.hasDebt ? "Ada" : "Tidak"],
          ...(housing.hasDebt
            ? ([
                ["Jenis Hutang", housing.debtType ?? "—"],
                ["Jumlah Hutang", housing.debtAmount ?? "—"],
                [
                  "Lama Cicilan",
                  housing.debtInstallmentMonths
                    ? `${housing.debtInstallmentMonths} bulan`
                    : "—",
                ],
                ["Keterangan", housing.debtDescription ?? "—"],
              ] as [string, string][])
            : []),
        ]}
      />

      <ReviewSection
        title="Organisasi"
        onEdit={() => onEditStep("organizations")}
        rows={
          orgs.hasOrganizations
            ? orgs.entries
                .filter((e) => e.name || e.position)
                .map(
                  (e, i) =>
                    [
                      `Organisasi ${i + 1}`,
                      `${e.name}${e.position ? ` — ${e.position}` : ""}`,
                    ] as [string, string],
                )
            : [["Pengalaman Organisasi", "Belum pernah"]]
        }
      />

      <ReviewSection
        title="Interview Tertulis"
        onEdit={() => onEditStep("interview")}
        rows={[
          ["Motivasi Pendidikan Tinggi", truncate(interview.motivationHigherEducation)],
          ["Motivasi Sakola Kembara", truncate(interview.motivationSakem)],
          ["Rencana Konsistensi", truncate(interview.consistencyPlan)],
          ["Komitmen Kehadiran", truncate(interview.attendanceCommitment)],
          ["Tanggapan Orang Tua", truncate(interview.parentResponse)],
          ["Jika Orang Tua Berubah Pikiran", truncate(interview.ifParentChangesMind)],
          [
            "Siap Tanda Tangan Materai",
            interview.agreedToSignedStatement === "ya" ? "Ya" : "Tidak",
          ],
        ]}
      />

      <ReviewSection
        title="Berkas Pendaftaran"
        onEdit={() => onEditStep("documents")}
        rows={[
          ["Surat Penghasilan Ayah", docs.fatherIncomeUrl || "—"],
          ["Surat Penghasilan Ibu", docs.motherIncomeUrl || "—"],
          ["Surat Penghasilan Anggota Lain 1", docs.otherEarner1IncomeUrl || "—"],
          ["Surat Penghasilan Anggota Lain 2", docs.otherEarner2IncomeUrl || "—"],
          ["Bukti Hutang", docs.debtProofUrl || "—"],
          ["Tagihan/Token Listrik", docs.electricityBillUrl || "—"],
          ["Kartu Keluarga", docs.familyCardUrl || "—"],
          ["Surat Izin Orang Tua", docs.parentPermissionUrl || "—"],
          ["Foto Diri", docs.selfPhotoUrl || "—"],
          ["Foto Rumah", docs.houseImagesUrl || "—"],
          ["Foto Kendaraan", docs.vehicleImagesUrl || "—"],
          [
            "Terdaftar DTKS",
            docs.dtksRegistered === "ya"
              ? "Ya"
              : docs.dtksRegistered === "tidak"
                ? "Tidak"
                : "—",
          ],
          ...(docs.dtksRegistered === "ya"
            ? ([["SKTM DTKS", docs.dtksUrl || "—"]] as [string, string][])
            : []),
        ]}
      />

      <ReviewSection
        title="Berkas Marketing"
        onEdit={() => onEditStep("documents")}
        rows={[
          [
            "Instagram",
            marketing.instagramUsername
              ? `@${marketing.instagramUsername.replace(/^@/, "")}`
              : "—",
          ],
          ["Bukti Follow @sakolakembara", marketing.instagramFollowProofUrl || "—"],
          ["Bukti Share Broadcast WA", marketing.broadcastProofUrl || "—"],
          ["Bukti Upload Twibbon", marketing.twibbonUploadUrl || "—"],
          ["Bukti Share Story Instagram", marketing.storyUploadUrl || "—"],
        ]}
      />

      <Alert tone="info">
        Setelah tombol <b>Kirim Pendaftaran</b> ditekan, kami akan menampilkan
        link grup WhatsApp yang wajib kamu ikuti agar tidak ketinggalan info
        selanjutnya.
      </Alert>
    </div>
  );
}

function truncate(v: string, max = 140) {
  const clean = v.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean || "—";
}

function ReviewSection({
  title,
  rows,
  onEdit,
}: {
  title: string;
  rows: [string, string][];
  onEdit: () => void;
}) {
  return (
    <section className="border border-gray-200 rounded-xl overflow-hidden">
      <header className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
        <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide">
          {title}
        </h3>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-blue hover:underline"
        >
          <Pencil size={12} /> Ubah
        </button>
      </header>
      <dl className="divide-y divide-gray-100">
        {rows.map(([label, value], i) => (
          <div
            key={`${label}-${i}`}
            className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-1 md:gap-4 px-4 py-3"
          >
            <dt className="text-xs md:text-sm text-gray-500">{label}</dt>
            <dd className="text-sm text-gray-900 break-words">
              {value || "—"}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
