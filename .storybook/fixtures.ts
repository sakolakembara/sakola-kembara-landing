import type { z } from "zod";
import type { BlogArticle } from "@/lib/blog-types";
import type {
  AdmissionBatch,
  Announcement,
  Report,
  Shortlink,
  SiteResource,
  TeamMember,
  User,
} from "@/lib/db/schema";
import type { GalleryPhoto } from "@/lib/gallery";
import {
  BRANCHES,
  FATHER_OCCUPATIONS,
  GRADUATION_BATCHES,
  MOTHER_OCCUPATIONS,
  RELIGIONS,
  RESIDENCE_STATUSES,
  emptyFormValues,
  type FormValues,
  type StepId,
  STEPS,
} from "@/lib/student-form-types";
import type { FieldErrors } from "@/app/(portal)/portal/daftar/_shared";
import asrama from "@/public/images/program/asrama-intensif.jpg";
import kbm from "@/public/images/program/kbm-pekanan.jpg";
import mentoring from "@/public/images/program/mentoring.jpg";
import pembinaan from "@/public/images/program/pembinaan.jpg";

/*
 * Sample data for the stories. Everything is named "Contoh …" like the
 * preview database's placeholders, and nothing is real. Images are bundled
 * photos, because Storybook doesn't serve public/.
 */

const at = (iso: string) => new Date(iso);

export function sampleArticle(id: string, title: string, image: string, category: string, date: string): BlogArticle {
  return {
    id,
    wpId: 0,
    category,
    date,
    dateISO: "2026-10-01",
    title,
    excerpt: "Cerita singkat dari kegiatan pembinaan Sakola Kembara bersama para siswa.",
    contentMarkdown: "Program pembinaan Sakola Kembara berjalan sepanjang tahun ajaran.\n\n## Kegiatan\n\nSiswa belajar bersama setiap pekan.",
    featured: false,
    image,
    author: "Tim Sakola Kembara",
    sourceUrl: "",
    modifiedISO: "2026-10-01",
  };
}

export const sampleArticles: BlogArticle[] = [
  sampleArticle("contoh-1", "Belajar bersama di KBM pekanan", kbm.src, "News", "1 Oktober 2026"),
  sampleArticle("contoh-2", "Mentoring dengan alumni perguruan tinggi negeri", mentoring.src, "Cerita", "24 September 2026"),
  sampleArticle("contoh-3", "Asrama intensif menjelang UTBK", asrama.src, "Tips", "10 September 2026"),
  sampleArticle("contoh-4", "Kisah alumni yang kini kuliah di PTN", pembinaan.src, "Testimonials", "2 September 2026"),
];

export const sampleGallery: GalleryPhoto[] = [
  { src: kbm.src, name: "kbm-pekanan.jpg" },
  { src: mentoring.src, name: "mentoring.jpg" },
  { src: asrama.src, name: "asrama-intensif.jpg" },
];

const member = (n: number, name: string, role: string, category: TeamMember["category"]): TeamMember => ({
  id: `00000000-0000-0000-0000-00000000000${n}`,
  name,
  role,
  image: null,
  category,
  bio: "Relawan Sakola Kembara sejak 2021.",
  educationHistory: [{ institution: "Contoh Universitas", degree: "S1", year: "2020" }],
  workHistory: [{ organization: "Contoh Organisasi", role: "Koordinator", period: "2021 – sekarang" }],
  displayOrder: n,
  createdAt: at("2026-01-01T00:00:00Z"),
  updatedAt: at("2026-01-01T00:00:00Z"),
});

export const sampleTeam: TeamMember[] = [
  member(1, "Contoh Pembina", "Ketua Dewan Pembina", "dewan_pembina"),
  member(2, "Contoh Pengawas", "Dewan Pengawas", "dewan_pengawas"),
  member(3, "Contoh Ketua", "Ketua Yayasan", "pengurus"),
  member(4, "Contoh Bendahara", "Bendahara", "pengurus"),
  member(5, "Contoh Koordinator", "Koordinator Pembinaan", "pengurus"),
];

const report = (n: number, title: string, category: Report["category"], year: string): Report => ({
  id: `00000000-0000-0000-0000-00000000010${n}`,
  title,
  description: "Ringkasan kegiatan dan penggunaan dana selama setahun.",
  category,
  year,
  filePath: "/reports/contoh/contoh-laporan.pdf",
  fileSize: 1_250_000,
  uploadedBy: null,
  uploadedAt: at("2026-03-01T00:00:00Z"),
});

export const sampleReport = report(1, "Contoh Laporan Tahunan 2025", "yearly", "2025");

export const sampleReportsByYear: { year: string; reports: Report[] }[] = [
  { year: "2025", reports: [sampleReport, report(2, "Contoh Laporan Keuangan 2025", "financial", "2025")] },
  { year: "2024", reports: [report(3, "Contoh Laporan Dampak 2024", "impact", "2024"), report(4, "Contoh Laporan Donasi 2024", "donation", "2024")] },
];

export const sampleAnnouncement: Announcement = {
  id: "00000000-0000-0000-0000-000000000201",
  title: "Pendaftaran Gen 6 dibuka",
  body: "Daftar sebelum 30 November.",
  severity: "info",
  ctaLabel: "Daftar Sekarang",
  ctaUrl: "/gabung-siswa",
  active: true,
  startsAt: null,
  endsAt: null,
  createdBy: null,
  createdAt: at("2026-10-01T00:00:00Z"),
  updatedAt: at("2026-10-01T00:00:00Z"),
};

export const sampleBatch: AdmissionBatch = {
  id: "00000000-0000-0000-0000-000000000301",
  year: 2026,
  name: "Contoh Batch Gen 6",
  description: "Pendaftaran siswa Gen 6.",
  opensAt: at("2026-10-01T00:00:00Z"),
  closesAt: at("2026-11-30T16:59:00Z"),
  resultsPublishedAt: null,
  createdBy: null,
  createdAt: at("2026-09-20T00:00:00Z"),
  updatedAt: at("2026-09-20T00:00:00Z"),
};

export const sampleResource: SiteResource = {
  id: "00000000-0000-0000-0000-000000000401",
  title: "Contoh Panduan Pendaftaran",
  description: "Langkah-langkah mengisi formulir pendaftaran.",
  category: "panduan",
  displayOrder: 0,
  contentType: "url",
  filePath: null,
  fileSize: null,
  externalUrl: "https://sakolakembara.org/gabung-siswa/docs",
  bodyText: null,
  notes: null,
  updatedBy: null,
  createdAt: at("2026-09-01T00:00:00Z"),
  updatedAt: at("2026-09-01T00:00:00Z"),
};

export const sampleShortlink: Shortlink = {
  id: "00000000-0000-0000-0000-000000000501",
  slug: "daftar",
  targetUrl: "https://sakolakembara.org/gabung-siswa",
  note: "Untuk poster roadshow.",
  active: true,
  clickCount: 128,
  lastClickedAt: at("2026-10-06T00:00:00Z"),
  createdBy: null,
  createdAt: at("2026-09-01T00:00:00Z"),
  updatedAt: at("2026-09-01T00:00:00Z"),
};

export const sampleAdmin: User = {
  id: "00000000-0000-0000-0000-000000000601",
  email: "admin@contoh.test",
  name: "Contoh Admin",
  image: null,
  role: "editor",
  passwordHash: null,
  emailVerifiedAt: at("2026-01-01T00:00:00Z"),
  lastLoginAt: null,
  createdAt: at("2026-01-01T00:00:00Z"),
  updatedAt: at("2026-01-01T00:00:00Z"),
};

/* ---------- Registration wizard ---------- */

/** A complete, valid set of answers, for the review step. */
export const filledFormValues: FormValues = {
  identity: {
    fullName: "Contoh Pendaftar",
    nickname: "Contoh",
    gender: "laki-laki",
    religion: RELIGIONS[0],
    schoolName: "SMAN 1 Contoh",
    branch: BRANCHES[0],
    homeAddress: "Jl. Contoh No. 1, Kabupaten Bandung Barat",
    graduationBatch: GRADUATION_BATCHES[1],
    whatsapp: "081234567890",
  },
  household: {
    livingWith: ["Ayah", "Ibu"],
    fatherName: "Contoh Ayah",
    fatherOccupation: FATHER_OCCUPATIONS[0],
    fatherIncome: "1500000",
    motherName: "Contoh Ibu",
    motherOccupation: MOTHER_OCCUPATIONS[0],
    motherIncome: "500000",
    hasOtherEarner1: false,
    earner1Relation: "",
    earner1Income: "",
    hasOtherEarner2: false,
    earner2Relation: "",
    earner2Income: "",
    familySize: 5,
  },
  housing: {
    residenceStatus: RESIDENCE_STATUSES[0],
    buildingArea: 36,
    motorcycles: 1,
    cars: 0,
    hasDebt: false,
    debtType: "",
    debtAmount: "",
    debtInstallmentMonths: "",
    debtDescription: "",
  },
  organizations: { hasOrganizations: true, entries: [{ name: "OSIS SMAN 1 Contoh", position: "Anggota" }] },
  documents: {
    ...emptyFormValues.documents,
    fatherIncomeUrl: "https://drive.google.com/contoh",
    motherIncomeUrl: "https://drive.google.com/contoh",
    electricityBillUrl: "https://drive.google.com/contoh",
    familyCardUrl: "https://drive.google.com/contoh",
    parentPermissionUrl: "https://drive.google.com/contoh",
    selfPhotoUrl: "https://drive.google.com/contoh",
    dtksRegistered: "tidak",
    houseImagesUrl: "https://drive.google.com/contoh",
    vehicleImagesUrl: "https://drive.google.com/contoh",
  },
  marketing: {
    instagramUsername: "contoh.pendaftar",
    instagramFollowProofUrl: "https://drive.google.com/contoh",
    broadcastProofUrl: "https://drive.google.com/contoh",
    twibbonUploadUrl: "https://drive.google.com/contoh",
    storyUploadUrl: "https://drive.google.com/contoh",
  },
  interview: {
    motivationHigherEducation: "Saya ingin menjadi guru di daerah saya.",
    motivationSakem: "Saya ingin belajar bersama teman-teman yang punya tujuan sama.",
    consistencyPlan: "Saya akan membagi waktu antara sekolah dan belajar mandiri.",
    attendanceCommitment: "Saya siap hadir setiap pekan.",
    parentResponse: "Orang tua mendukung.",
    ifParentChangesMind: "Saya akan berdiskusi dengan orang tua dan pengurus.",
    agreedToSignedStatement: "ya",
  },
};

/** No errors on any step. */
export const noErrors = Object.fromEntries(
  [...STEPS.map((step) => step.id), "marketing"].map((id) => [id, {}]),
) as Record<StepId, FieldErrors>;

/** The errors the wizard shows for `value` on a step: the first message per field path. */
export function errorsFor(schema: z.ZodTypeAny, value: unknown): FieldErrors {
  const result = schema.safeParse(value);
  const out: FieldErrors = {};
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = issue.path.join(".");
      if (!(key in out)) out[key] = issue.message;
    }
  }
  return out;
}
