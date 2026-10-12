import type { ApplicationDetail } from "./model";

// The detail page's sections, as DATA: what each row says and what kind of value it is, so the rules of the legacy
// page (which rows exist when, how a document or a phone number is shown) are tested without a browser and the
// component only draws them. A port of app/(admin)/admin/applications/[id]/page.tsx.
//
// `formData` is the JSON the wizard stored (src/db/schema/admission.ts has its v2 type). An older application has
// none, and any of its parts may be missing or of another shape: every read below checks, and a part that is not
// there is a row that is left out or "—", never a crash. The applicant's own text is only ever text: a link is
// clickable only when it is an http or https address (a `javascript:` URL typed into a document field must not run).

export type RowValue =
  | { type: "text"; text: string }
  /** A paragraph kept as the applicant wrote it (line breaks included). */
  | { type: "long"; text: string }
  /** A link the applicant pasted (their own Drive folder in the legacy wizard). */
  | { type: "link"; url: string }
  | { type: "missing" }
  | { type: "whatsapp"; number: string }
  | { type: "instagram"; username: string }
  | { type: "debt"; kind: string; amount: string; months: number; description: string }
  /** "Belum ditinjau". */
  | { type: "muted"; text: string };

export interface ProfileRow {
  label: string;
  value: RowValue;
  /** The label above the value instead of beside it (long texts, links). */
  stack?: boolean;
}

export interface ProfileSection {
  id: string;
  title: string;
  rows: ProfileRow[];
}

type Dict = Record<string, unknown>;

const dict = (value: unknown): Dict | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Dict) : null);
const text = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "");
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** "Rp 1.200.000" (the legacy `formatRupiah`). */
export function formatRupiah(n: number): string {
  return `Rp ${n.toLocaleString("id-ID")}`;
}

/** The address of a link when it is safe to follow: http or https only. */
export function safeWebUrl(value: string): string | null {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

/** The `wa.me` address of a phone number: its digits only; null when it has none. */
export function whatsappUrl(number: string): string | null {
  const digits = number.replace(/\D/g, "");
  return digits === "" ? null : `https://wa.me/${digits}`;
}

/** The username without its "@", and the profile address (the name is encoded: it is the applicant's text). */
export function instagramUrl(username: string): { handle: string; url: string } | null {
  const handle = username.replace(/^@/, "").trim();
  return handle === "" ? null : { handle, url: `https://instagram.com/${encodeURIComponent(handle)}` };
}

const row = (label: string, value: RowValue, stack?: boolean): ProfileRow => (stack ? { label, value, stack } : { label, value });
const plain = (label: string, value: string): ProfileRow => row(label, { type: "text", text: value });
const long = (label: string, value: string): ProfileRow => row(label, { type: "long", text: value }, true);
/** A document the applicant linked: the link, or "—" when they left it out. */
const doc = (label: string, value: unknown): ProfileRow => {
  const url = text(value);
  return row(label, url ? { type: "link", url } : { type: "missing" }, true);
};
const yesNo = (value: unknown) => (value === true ? "Ya" : "Tidak");

/** The sections of the detail page, in the order of the legacy one. */
export function profileSections(application: ApplicationDetail): ProfileSection[] {
  const fd = dict(application.formData);
  const identity = dict(fd?.identity);
  const household = dict(fd?.household);
  const housing = dict(fd?.housing);
  const documents = dict(fd?.documents);
  const marketing = dict(fd?.marketing);
  const interview = dict(fd?.interview);
  const sections: ProfileSection[] = [];

  // ------------------------------------------------------------- Identitas
  const identityRows: ProfileRow[] = [plain("Nama Lengkap", application.fullName)];
  if (text(identity?.nickname)) identityRows.push(plain("Panggilan", text(identity?.nickname)));
  if (text(identity?.gender)) identityRows.push(plain("Jenis Kelamin", identity?.gender === "laki-laki" ? "Laki-laki" : "Perempuan"));
  if (text(identity?.religion)) identityRows.push(plain("Agama", text(identity?.religion)));
  if (application.email) identityRows.push(plain("Email", application.email));
  identityRows.push(row("WhatsApp", { type: "whatsapp", number: application.whatsapp }));
  if (text(identity?.homeAddress)) identityRows.push(long("Alamat Rumah", text(identity?.homeAddress)));
  sections.push({ id: "identitas", title: "Identitas", rows: identityRows });

  // ------------------------------------------------------------- Pendidikan
  sections.push({
    id: "pendidikan",
    title: "Pendidikan",
    rows: [
      plain("Asal Sekolah", application.schoolName),
      plain("Tahun Angkatan", application.graduationYear),
      row("Cabang", application.branchPreference ? { type: "text", text: application.branchPreference } : { type: "text", text: "—" }),
    ],
  });

  // -------------------------------------------------------- Keluarga & Ekonomi
  if (household) {
    const father = dict(household.father);
    const mother = dict(household.mother);
    const living = list(household.livingWith).map(text).filter(Boolean).join(", ");
    sections.push({
      id: "keluarga",
      title: "Keluarga & Ekonomi",
      rows: [
        plain("Tinggal Bersama", living || "—"),
        plain("Ayah", `${text(father?.name)} · ${text(father?.occupation)}`),
        plain("Penghasilan Ayah", formatRupiah(num(father?.income))),
        plain("Ibu", `${text(mother?.name)} · ${text(mother?.occupation)}`),
        plain("Penghasilan Ibu", formatRupiah(num(mother?.income))),
        ...list(household.otherEarners).map((earner, index) => plain(`Anggota Lain ${index + 1}`, `${text(dict(earner)?.relation)} · ${formatRupiah(num(dict(earner)?.income))}`)),
        plain("Jumlah Anggota Keluarga", `${num(household.familySize)} orang`),
      ],
    });
  }

  // ----------------------------------------------------------- Tempat Tinggal
  if (housing) {
    const debt = dict(housing.debt);
    sections.push({
      id: "tempat-tinggal",
      title: "Tempat Tinggal",
      rows: [
        plain("Status Tempat Tinggal", text(housing.residenceStatus)),
        plain("Luas Bangunan", `${num(housing.buildingArea)} m²`),
        plain("Kendaraan", `${num(housing.motorcycles)} motor · ${num(housing.cars)} mobil`),
        debt
          ? row("Hutang", { type: "debt", kind: text(debt.type), amount: formatRupiah(num(debt.amount)), months: num(debt.installmentMonths), description: text(debt.description) }, true)
          : plain("Hutang", "Tidak ada"),
      ],
    });
  }

  // ---------------------------------------------------------------- Organisasi
  if (fd && Array.isArray(fd.organizations)) {
    const organizations = fd.organizations;
    sections.push({
      id: "organisasi",
      title: "Organisasi",
      rows:
        organizations.length === 0
          ? [plain("Pengalaman", "Belum pernah")]
          : organizations.map((entry, index) => plain(`Organisasi ${index + 1}`, `${text(dict(entry)?.name)} — ${text(dict(entry)?.position)}`)),
    });
  }

  // ------------------------------------------- Berkas (the links the applicant pasted)
  if (documents) {
    sections.push({
      id: "berkas",
      // The legacy title was "Berkas Pendaftaran", the name of a menu now called Pusat Dokumen (docs/cloudflare/admin-ia.md, 3.4).
      title: "Berkas yang diunggah",
      rows: [
        doc("Surat Penghasilan Ayah", documents.fatherIncomeUrl),
        doc("Surat Penghasilan Ibu", documents.motherIncomeUrl),
        doc("Surat Penghasilan Anggota Lain 1", documents.otherEarner1IncomeUrl),
        doc("Surat Penghasilan Anggota Lain 2", documents.otherEarner2IncomeUrl),
        doc("Bukti Hutang", documents.debtProofUrl),
        doc("Tagihan/Token Listrik", documents.electricityBillUrl),
        doc("Kartu Keluarga", documents.familyCardUrl),
        doc("Surat Izin Orang Tua", documents.parentPermissionUrl),
        doc("Foto Diri", documents.selfPhotoUrl),
        doc("Foto Rumah", documents.houseImagesUrl),
        doc("Foto Kendaraan", documents.vehicleImagesUrl),
        plain("Terdaftar DTKS", yesNo(documents.dtksRegistered)),
        ...(documents.dtksRegistered === true ? [doc("SKTM DTKS", documents.dtksUrl)] : []),
      ],
    });
  }

  // ------------------------------------------------------------------ Marketing
  if (marketing) {
    sections.push({
      id: "marketing",
      title: "Bukti Marketing",
      rows: [
        row("Instagram", { type: "instagram", username: text(marketing.instagramUsername) }),
        doc("Bukti Follow @sakolakembara", marketing.instagramFollowProofUrl),
        doc("Bukti Share Broadcast WA", marketing.broadcastProofUrl),
        doc("Bukti Upload Twibbon", marketing.twibbonUploadUrl),
        doc("Bukti Share Story Instagram", marketing.storyUploadUrl),
      ],
    });
  }

  // ------------------------------------------------------------------ Interview
  if (interview) {
    sections.push({
      id: "interview",
      title: "Interview Tertulis",
      rows: [
        long("Motivasi Pendidikan Tinggi", text(interview.motivationHigherEducation)),
        long("Motivasi Sakola Kembara", text(interview.motivationSakem)),
        long("Rencana Konsistensi", text(interview.consistencyPlan)),
        long("Komitmen Kehadiran", text(interview.attendanceCommitment)),
        long("Tanggapan Orang Tua", text(interview.parentResponse)),
        long("Jika Orang Tua Berubah Pikiran", text(interview.ifParentChangesMind)),
        plain("Siap Materai", yesNo(interview.agreedToSignedStatement)),
      ],
    });
  }

  // The story of the old form, for an application that has no wizard answers.
  if (!fd && application.motivation) {
    sections.push({
      id: "cerita-lama",
      title: "Cerita (Legacy)",
      rows: [long("Motivasi", application.motivation), ...(application.economicBackground ? [long("Latar Belakang Ekonomi", application.economicBackground)] : [])],
    });
  }

  // ------------------------------------------------------------------ Pengajuan
  const when: Intl.DateTimeFormatOptions = { dateStyle: "long", timeStyle: "short" };
  sections.push({
    id: "pengajuan",
    title: "Pengajuan",
    rows: [
      plain("Dikirim", new Date(application.submittedAt).toLocaleString("id-ID", when)),
      row("Ditinjau Terakhir", application.reviewedAt ? { type: "text", text: new Date(application.reviewedAt).toLocaleString("id-ID", when) } : { type: "muted", text: "Belum ditinjau" }),
      ...(application.reviewNotes ? [long("Catatan Review Terakhir", application.reviewNotes)] : []),
    ],
  });

  return sections;
}
