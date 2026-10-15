import { Pencil } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Tag } from "@/components/ui/tag";
import type { SlotId } from "@shared/application-form/slots";
import { type UiStepId } from "@shared/application-form/steps";
import type { StoredFile } from "~/lib/files/types";
import type { WizardValues } from "~/lib/wizard/values";
import { StepHeader } from "../form";

// Screen 8 of 8, "Tinjau & Kirim": every answer as the student has it now, with a pencil to change a section (legacy:
// _steps/review.tsx). What differs: a document is shown as how many files are there (it was a link), and a section the
// server does not hold yet says "Belum disimpan" (the submit saves it first).

type Row = [string, string];

function truncate(text: string, max = 140): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean || "—";
}

export function ReviewStep({
  values,
  files,
  unsaved,
  groupInvitation,
  onEdit,
}: {
  values: WizardValues;
  files: readonly StoredFile[];
  unsaved: Record<UiStepId, boolean>;
  /** The participants' WhatsApp group is configured: the legacy promise that the link comes after sending. */
  groupInvitation: boolean;
  onEdit: (screen: UiStepId) => void;
}) {
  const { identity, household, housing, organizations, documents, marketing, interview } = values;
  const count = (slot: SlotId): string => {
    const n = files.filter((file) => file.slot === slot).length;
    return n === 0 ? "—" : `${n} berkas`;
  };

  const earners: Row[] = [];
  if (household.hasOtherEarner1) earners.push(["Anggota Lain 1 — Hubungan", household.earner1Relation.trim() || "—"], ["Anggota Lain 1 — Penghasilan", household.earner1Income || "—"]);
  if (household.hasOtherEarner2) earners.push(["Anggota Lain 2 — Hubungan", household.earner2Relation.trim() || "—"], ["Anggota Lain 2 — Penghasilan", household.earner2Income || "—"]);

  const debt: Row[] = housing.hasDebt
    ? [
        ["Jenis Hutang", housing.debtType || "—"],
        ["Jumlah Hutang", housing.debtAmount || "—"],
        ["Lama Cicilan", housing.debtInstallmentMonths ? `${housing.debtInstallmentMonths} bulan` : "—"],
        ["Keterangan", housing.debtDescription || "—"],
      ]
    : [];

  const entries = organizations.entries.filter((entry) => entry.name || entry.position);
  const anyUnsaved = Object.values(unsaved).some(Boolean);

  return (
    <div className="space-y-6">
      <StepHeader title="Tinjau & Kirim" subtitle="Periksa kembali seluruh isian sebelum menekan tombol kirim. Klik ikon pensil untuk mengubah bagian tertentu." />

      {anyUnsaved && <Alert tone="info">Bagian yang bertanda Belum disimpan akan disimpan otomatis saat kamu menekan Kirim Pendaftaran.</Alert>}

      <Section
        title="Identitas Pribadi"
        unsaved={unsaved.identity}
        onEdit={() => onEdit("identity")}
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

      <Section
        title="Keluarga & Ekonomi"
        unsaved={unsaved.household}
        onEdit={() => onEdit("household")}
        rows={[
          ["Tinggal bersama", household.livingWith.join(", ") || "—"],
          ["Nama Ayah", household.fatherName],
          ["Pekerjaan Ayah", household.fatherOccupation.trim()],
          ["Penghasilan Ayah", household.fatherIncome],
          ["Nama Ibu", household.motherName],
          ["Pekerjaan Ibu", household.motherOccupation.trim()],
          ["Penghasilan Ibu", household.motherIncome],
          ...earners,
          ["Jumlah Anggota Keluarga", household.familySize || "—"],
        ]}
      />

      <Section
        title="Tempat Tinggal & Hutang"
        unsaved={unsaved.housing}
        onEdit={() => onEdit("housing")}
        rows={[
          ["Status Tempat Tinggal", housing.residenceStatus],
          ["Luas Bangunan", housing.buildingArea ? `${housing.buildingArea} m²` : "—"],
          ["Motor", housing.motorcycles || "0"],
          ["Mobil", housing.cars || "0"],
          ["Hutang", housing.hasDebt ? "Ada" : "Tidak"],
          ...debt,
        ]}
      />

      <Section
        title="Organisasi"
        unsaved={unsaved.organizations}
        onEdit={() => onEdit("organizations")}
        rows={organizations.hasOrganizations ? entries.map((entry, i): Row => [`Organisasi ${i + 1}`, `${entry.name}${entry.position ? ` — ${entry.position}` : ""}`]) : [["Pengalaman Organisasi", "Belum pernah"]]}
      />

      <Section
        title="Interview Tertulis"
        unsaved={unsaved.interview}
        onEdit={() => onEdit("interview")}
        rows={[
          ["Motivasi Pendidikan Tinggi", truncate(interview.motivationHigherEducation)],
          ["Motivasi Sakola Kembara", truncate(interview.motivationSakem)],
          ["Rencana Konsistensi", truncate(interview.consistencyPlan)],
          ["Komitmen Kehadiran", truncate(interview.attendanceCommitment)],
          ["Tanggapan Orang Tua", truncate(interview.parentResponse)],
          ["Jika Orang Tua Berubah Pikiran", truncate(interview.ifParentChangesMind)],
          ["Siap Tanda Tangan Materai", interview.agreedToSignedStatement === "ya" ? "Ya" : "Tidak"],
        ]}
      />

      <Section
        title="Berkas Pendaftaran"
        unsaved={unsaved.documents}
        onEdit={() => onEdit("documents")}
        rows={[
          ["Surat Penghasilan Ayah", count("father-income")],
          ["Surat Penghasilan Ibu", count("mother-income")],
          ["Surat Penghasilan Anggota Lain 1", count("other-earner-1-income")],
          ["Surat Penghasilan Anggota Lain 2", count("other-earner-2-income")],
          ["Bukti Hutang", count("debt-proof")],
          ["Tagihan/Token Listrik", count("electricity-bill")],
          ["Kartu Keluarga", count("family-card")],
          ["Surat Izin Orang Tua", count("parent-permission")],
          ["Foto Diri", count("self-photo")],
          ["Foto Rumah", count("house-photos")],
          ["Foto Kendaraan", count("vehicle-photos")],
          ["Terdaftar DTKS", documents.dtksRegistered === "ya" ? "Ya" : documents.dtksRegistered === "tidak" ? "Tidak" : "—"],
          ...(documents.dtksRegistered === "ya" ? ([["SKTM DTKS", count("dtks")]] as Row[]) : []),
        ]}
      />

      <Section
        title="Berkas Marketing"
        unsaved={unsaved.documents}
        onEdit={() => onEdit("documents")}
        rows={[
          ["Instagram", marketing.instagramUsername ? `@${marketing.instagramUsername.replace(/^@/, "")}` : "—"],
          ["Bukti Follow @sakolakembara", count("marketing-follow-proof")],
          ["Bukti Share Broadcast WA", count("marketing-broadcast-proof")],
          ["Bukti Upload Twibbon", count("marketing-twibbon-proof")],
          ["Bukti Share Story Instagram", count("marketing-story-proof")],
        ]}
      />

      {groupInvitation && (
        <Alert tone="info">
          Setelah tombol <b>Kirim Pendaftaran</b> ditekan, kami akan menampilkan link grup WhatsApp yang wajib kamu ikuti agar tidak ketinggalan info selanjutnya.
        </Alert>
      )}
    </div>
  );
}

function Section({ title, rows, unsaved, onEdit }: { title: string; rows: Row[]; unsaved: boolean; onEdit: () => void }) {
  return (
    <section className="overflow-hidden rounded-xl border border-gray-200">
      <header className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="text-sm font-bold uppercase tracking-wide text-gray-800">{title}</h3>
          {unsaved && (
            <Tag tone="amber" size="sm">
              Belum disimpan
            </Tag>
          )}
        </div>
        <button type="button" onClick={onEdit} aria-label={`Ubah ${title}`} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 px-1 text-xs font-semibold text-primary-blue hover:underline">
          <Pencil size={12} aria-hidden /> Ubah
        </button>
      </header>
      <dl className="divide-y divide-gray-100">
        {rows.map(([label, value], i) => (
          <div key={`${label}-${i}`} className="grid grid-cols-1 gap-1 px-4 py-3 md:grid-cols-[220px_1fr] md:gap-4">
            <dt className="text-xs text-gray-500 md:text-sm">{label}</dt>
            <dd className="break-words text-sm text-gray-900">{value || "—"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
