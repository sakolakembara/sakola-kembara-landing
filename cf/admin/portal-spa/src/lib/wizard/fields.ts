// The names of the fields as a student reads them, for the summary of what needs fixing (the label above the field says the
// same, in the legacy words). The review screen uses the same labels for its rows. Pure.

import { type StepId } from "../../../../shared/application-form/steps";

/** Fields that are not a single control (a group of radios, a list) still have the one name the summary and the review use. */
export const FIELD_LABELS: Record<StepId, Record<string, string>> = {
  identity: {
    fullName: "Nama Lengkap",
    nickname: "Nama Panggilan",
    gender: "Jenis Kelamin",
    religion: "Agama",
    schoolName: "Asal Sekolah",
    branch: "Cabang Sakola Kembara",
    homeAddress: "Alamat Rumah",
    graduationBatch: "Tahun Angkatan Kelulusan",
    whatsapp: "Nomor WhatsApp Pribadi",
  },
  household: {
    livingWith: "Kamu tinggal bersama siapa?",
    fatherName: "Nama Ayah",
    fatherOccupation: "Pekerjaan Ayah",
    fatherIncome: "Penghasilan Ayah per Bulan",
    motherName: "Nama Ibu",
    motherOccupation: "Pekerjaan Ibu",
    motherIncome: "Penghasilan Ibu per Bulan",
    hasOtherEarner1: "Anggota keluarga lain yang bekerja",
    earner1Relation: "Anggota 1, Hubungan dengan Kamu",
    earner1Income: "Anggota 1, Penghasilan per Bulan",
    hasOtherEarner2: "Anggota keluarga kedua yang bekerja",
    earner2Relation: "Anggota 2, Hubungan dengan Kamu",
    earner2Income: "Anggota 2, Penghasilan per Bulan",
    familySize: "Jumlah Anggota Keluarga",
  },
  housing: {
    residenceStatus: "Status Tempat Tinggal",
    buildingArea: "Luas Bangunan Tempat Tinggal",
    motorcycles: "Jumlah Kepemilikan Motor",
    cars: "Jumlah Kepemilikan Mobil",
    hasDebt: "Hutang",
    debtType: "Jenis Hutang",
    debtAmount: "Jumlah Hutang",
    debtInstallmentMonths: "Lama Waktu Cicilan",
    debtDescription: "Keterangan Hutang",
  },
  organizations: { hasOrganizations: "Pengalaman organisasi", entries: "Organisasi" },
  documents: { dtksRegistered: "Terdaftar DTKS" },
  marketing: { instagramUsername: "Username Instagram" },
  interview: {
    motivationHigherEducation: "Motivasi Pendidikan Tinggi",
    motivationSakem: "Motivasi Sakola Kembara",
    consistencyPlan: "Rencana Konsistensi",
    attendanceCommitment: "Komitmen Kehadiran",
    parentResponse: "Tanggapan Orang Tua",
    ifParentChangesMind: "Jika Orang Tua Berubah Pikiran",
    agreedToSignedStatement: "Siap Tanda Tangan Materai",
  },
};

/** The name of the field at `path` of a bucket: `entries.1.name` is "Organisasi 2, Nama Organisasi". A path nobody named is the path itself's closest label. */
export function labelOf(bucket: StepId, path: string): string {
  const known = FIELD_LABELS[bucket][path];
  if (known) return known;
  const entry = /^entries\.(\d+)\.(name|position)$/.exec(path);
  if (entry) return `Organisasi ${Number(entry[1]) + 1}, ${entry[2] === "name" ? "Nama Organisasi" : "Jabatan / Posisi"}`;
  const item = /^([A-Za-z]+)\.\d+$/.exec(path);
  if (item && FIELD_LABELS[bucket][item[1] as string]) return FIELD_LABELS[bucket][item[1] as string] as string;
  return "Isian";
}

/** The key a file slot's error has in a screen's list of errors (a slot id is not a path of any bucket). */
export const fileErrorKey = (slot: string) => `file:${slot}`;
