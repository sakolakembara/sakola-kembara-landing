// Dev seed (SAKEM-081): dummy rows for every table, so the admin can be run
// and clicked through locally. Fake names ("Contoh ..."), reserved example
// domains, no real person or organisation. LOCAL D1 ONLY: scripts/seed.ts
// opens the local database of `wrangler dev`; this module never opens a
// connection itself, it writes into whatever D1Database it is handed (the
// tests hand it the in-memory one).
//
// `seed()` first empties every table, then inserts, in one batch (one
// transaction): running it twice gives the same database.

import { getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { BatchItem } from "drizzle-orm/batch";
import type { GrantableArea } from "../src/auth/permissions";
import { hashPassword } from "../src/auth/password";
import type { UserRole } from "../src/auth/roles";
import * as schema from "../src/db/schema";
import type { StudentApplicationFormData } from "../src/db/schema";

/**
 * Password of every seeded account. A fake, for the local database only (the
 * seed cannot reach a remote one). Override with SEED_PASSWORD.
 */
export const DEV_PASSWORD = "contoh-sandi-lokal-123";

export interface SeedUser {
  key: string;
  name: string;
  email: string;
  role: UserRole;
  /** Written to admin_area_grants (only an editor's grants have an effect). */
  areas: GrantableArea[];
  emailVerified: boolean;
}

/** One account per role, plus editors with different areas. */
export const SEED_USERS: readonly SeedUser[] = [
  { key: "super_admin", name: "Contoh Super Admin", email: "super-admin@example.test", role: "super_admin", areas: [], emailVerified: true },
  { key: "viewer", name: "Contoh Pembaca", email: "viewer@example.test", role: "viewer", areas: [], emailVerified: true },
  { key: "editor_pendaftaran", name: "Contoh Editor Pendaftaran", email: "editor-pendaftaran@example.test", role: "editor", areas: ["pendaftaran"], emailVerified: true },
  { key: "editor_komunikasi", name: "Contoh Editor Komunikasi", email: "editor-komunikasi@example.test", role: "editor", areas: ["komunikasi"], emailVerified: true },
  { key: "editor_konten", name: "Contoh Editor Konten", email: "editor-konten@example.test", role: "editor", areas: ["konten"], emailVerified: true },
  { key: "editor_multi", name: "Contoh Editor Dua Bidang", email: "editor-multi@example.test", role: "editor", areas: ["pendaftaran", "konten"], emailVerified: true },
  { key: "editor_tanpa_bidang", name: "Contoh Editor Tanpa Bidang", email: "editor-baru@example.test", role: "editor", areas: [], emailVerified: true },
  { key: "student", name: "Contoh Siswa", email: "siswa@example.test", role: "student", areas: [], emailVerified: true },
  { key: "student_unverified", name: "Contoh Siswa Belum Verifikasi", email: "siswa-baru@example.test", role: "student", areas: [], emailVerified: false },
];

const DAY = 86_400_000;

/** Fixed-shape UUIDs, so rows can refer to each other and the seed stays readable. */
const uuid = (group: number, n: number) =>
  `${group.toString(16).padStart(8, "0")}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const U = (n: number) => uuid(0x1, n); // users
const B = (n: number) => uuid(0x2, n); // batches
const A = (n: number) => uuid(0x3, n); // applications

function sampleFormData(nickname: string, incomeFather: number): StudentApplicationFormData {
  return {
    formVersion: 2,
    identity: { nickname, gender: "perempuan", religion: "Islam", homeAddress: "Jl. Contoh No. 1, Kota Contoh" },
    household: {
      livingWith: ["Ayah", "Ibu"],
      father: { name: "Contoh Ayah", occupation: "Petani", income: incomeFather },
      mother: { name: "Contoh Ibu", occupation: "Ibu rumah tangga", income: 0 },
      otherEarners: [],
      familySize: 4,
    },
    housing: { residenceStatus: "Milik sendiri", buildingArea: 36, motorcycles: 1, cars: 0, debt: null },
    organizations: [{ name: "OSIS Contoh", position: "Anggota" }],
    documents: {
      fatherIncomeUrl: null,
      motherIncomeUrl: null,
      otherEarner1IncomeUrl: null,
      otherEarner2IncomeUrl: null,
      debtProofUrl: null,
      electricityBillUrl: "https://example.test/berkas/listrik",
      familyCardUrl: "https://example.test/berkas/kk",
      parentPermissionUrl: "https://example.test/berkas/izin",
      selfPhotoUrl: "https://example.test/berkas/foto",
      dtksRegistered: false,
      dtksUrl: null,
      houseImagesUrl: "https://example.test/berkas/rumah",
      vehicleImagesUrl: "https://example.test/berkas/kendaraan",
    },
    marketing: {
      instagramUsername: "contoh.siswa",
      instagramFollowProofUrl: "https://example.test/berkas/ig",
      broadcastProofUrl: "https://example.test/berkas/broadcast",
      twibbonUploadUrl: "https://example.test/berkas/twibbon",
      storyUploadUrl: "https://example.test/berkas/story",
    },
    interview: {
      motivationHigherEducation: "Ingin melanjutkan kuliah dan membanggakan keluarga.",
      motivationSakem: "Ingin belajar bersama teman-teman yang saling mendukung.",
      consistencyPlan: "Belajar rutin setiap hari dan mengikuti jadwal bimbingan.",
      attendanceCommitment: "Siap hadir pada seluruh kegiatan.",
      parentResponse: "Orang tua mendukung sepenuhnya.",
      ifParentChangesMind: "Berdiskusi baik-baik dan mencari jalan tengah.",
      agreedToSignedStatement: true,
    },
  };
}

export interface SeedOptions {
  /** Password of every seeded account. Default: SEED_PASSWORD, else DEV_PASSWORD. */
  password?: string;
  /** "Now" for the relative dates (tests freeze it). */
  now?: number;
}

export interface SeedResult {
  /** Rows written per table. */
  counts: Record<string, number>;
  password: string;
}

/** Empties every table and writes the sample data. One D1 batch, so all or nothing. */
export async function seed(d1: D1Database, options: SeedOptions = {}): Promise<SeedResult> {
  const password = options.password ?? process.env.SEED_PASSWORD ?? DEV_PASSWORD;
  const now = options.now ?? Date.now();
  const year = new Date(now).getUTCFullYear();
  const db = drizzle(d1, { schema });

  const statements: BatchItem<"sqlite">[] = [];
  const counts: Record<string, number> = {};
  // One statement per row: D1 allows at most 100 bound parameters per statement, and the wider tables exceed that with a few rows.
  const put = <T extends Parameters<typeof db.insert>[0]>(table: T, rows: (T["$inferInsert"])[]) => {
    const name = getTableName(table);
    counts[name] = (counts[name] ?? 0) + rows.length;
    for (const row of rows) statements.push(db.insert(table).values(row as never));
  };

  // Children first, so no foreign key is ever violated while emptying.
  for (const table of [
    schema.auditLog,
    schema.adminAreaGrants,
    // The portal's tables (SAKEM-083). Drafts reference a batch with RESTRICT, so they go before the batches. The seed
    // writes none of them: a draft is made through the portal, and a file row would point at an object that the dev
    // bucket does not have. Emptying the files table does not empty the dev bucket (delete .wrangler/state to do that).
    schema.applicationFiles,
    schema.applicationDrafts,
    schema.emailDaily,
    schema.privateStorage,
    schema.studentApplications,
    schema.admissionBatches,
    schema.announcements,
    schema.contactMessages,
    schema.reports,
    schema.teamMembers,
    schema.siteResources,
    schema.shortlinks,
    schema.blogPosts,
    schema.media,
    schema.verifications,
    schema.accounts,
    schema.sessions,
    schema.users,
  ]) {
    statements.push(db.delete(table));
  }

  // The private-storage counter is one row that always exists (migration 0012); nothing is stored in the seed, so zero.
  put(schema.privateStorage, [{ id: "private-files", bytes: 0, files: 0 }]);

  // ------------------------------------------------------------ identity
  const userIds = new Map<string, string>();
  SEED_USERS.forEach((u, i) => userIds.set(u.key, U(i + 1)));
  const id = (key: string) => userIds.get(key)!;
  const admin = id("super_admin");

  put(
    schema.users,
    SEED_USERS.map((u) => ({ id: id(u.key), name: u.name, email: u.email, role: u.role, emailVerified: u.emailVerified, createdAt: new Date(now - 90 * DAY) })),
  );
  // Every account signs in with email + password (Better Auth's "credential" provider)...
  const accountRows = await Promise.all(
    SEED_USERS.map(async (u, i) => ({
      id: uuid(0x4, i + 1),
      accountId: id(u.key),
      providerId: "credential",
      userId: id(u.key),
      password: await hashPassword(password),
    })),
  );
  put(schema.accounts, accountRows);
  // ...and the sample student also has a linked Google account.
  put(schema.accounts, [{ id: uuid(0x4, 99), accountId: "contoh-google-subject-0001", providerId: "google", userId: id("student"), scope: "openid email profile" }]);
  // An expired session and an expired verification: rows for the cleanup job of a later ticket to sweep. Their tokens are placeholders and unusable.
  put(schema.sessions, [
    {
      id: uuid(0x5, 1),
      token: "contoh-sesi-kedaluwarsa-0001",
      userId: id("editor_konten"),
      expiresAt: new Date(now - 30 * DAY),
      ipAddress: "203.0.113.10",
      userAgent: "Contoh Browser/1.0",
      createdAt: new Date(now - 37 * DAY),
    },
  ]);
  put(schema.verifications, [{ id: uuid(0x6, 1), identifier: "contoh-pengenal-kedaluwarsa-0001", value: "contoh", expiresAt: new Date(now - 2 * DAY) }]);

  put(
    schema.adminAreaGrants,
    SEED_USERS.flatMap((u) => u.areas.map((area) => ({ userId: id(u.key), area, grantedBy: admin, grantedAt: new Date(now - 60 * DAY) }))),
  );

  // ----------------------------------------------------------- admission
  put(schema.admissionBatches, [
    {
      id: B(1),
      year: year - 1,
      name: `Gen ${year - 2020} - ${year - 1}/${year}`,
      description: "Angkatan contoh yang sudah selesai; hasilnya sudah dipublikasikan.",
      opensAt: new Date(now - 420 * DAY),
      closesAt: new Date(now - 360 * DAY),
      resultsPublishedAt: new Date(now - 340 * DAY),
      createdBy: admin,
      createdAt: new Date(now - 430 * DAY),
    },
    {
      id: B(2),
      year,
      name: `Gen ${year - 2019} - ${year}/${year + 1}`,
      description: "Angkatan contoh yang sedang membuka pendaftaran.",
      opensAt: new Date(now - 30 * DAY),
      closesAt: new Date(now + 30 * DAY),
      createdBy: admin,
      createdAt: new Date(now - 40 * DAY),
    },
  ]);

  type NewApplication = typeof schema.studentApplications.$inferInsert;
  const applicant = (n: number, name: string, extra: Pick<NewApplication, "batchId"> & Partial<NewApplication>): NewApplication => ({
    id: A(n),
    fullName: name,
    email: `pendaftar-${n}@example.test`,
    whatsapp: `0812000000${n.toString().padStart(2, "0")}`,
    schoolName: `SMA Contoh ${n}`,
    graduationYear: "2026",
    formData: sampleFormData(name.split(" ").at(-1)!, 1_200_000 + n * 100_000),
    ...extra,
  });
  put(schema.studentApplications, [
    applicant(1, "Contoh Pendaftar Satu", { batchId: B(1), status: "accepted", reviewNotes: "Memenuhi syarat.", reviewedBy: id("editor_pendaftaran"), reviewedAt: new Date(now - 345 * DAY), submittedAt: new Date(now - 400 * DAY) }),
    applicant(2, "Contoh Pendaftar Dua", { batchId: B(1), status: "accepted", reviewNotes: "Memenuhi syarat.", reviewedBy: id("editor_pendaftaran"), reviewedAt: new Date(now - 345 * DAY), submittedAt: new Date(now - 399 * DAY) }),
    applicant(3, "Contoh Pendaftar Tiga", { batchId: B(1), status: "rejected", reviewNotes: "Berkas tidak lengkap.", reviewedBy: id("editor_pendaftaran"), reviewedAt: new Date(now - 345 * DAY), submittedAt: new Date(now - 398 * DAY) }),
    // The sample student owns one application in the open batch.
    applicant(4, "Contoh Siswa", { batchId: B(2), userId: id("student"), email: "siswa@example.test", status: "pending", submittedAt: new Date(now - 6 * DAY) }),
    applicant(5, "Contoh Pendaftar Lima", { batchId: B(2), status: "under_review", reviewNotes: "Menunggu bukti penghasilan.", reviewedBy: id("editor_pendaftaran"), reviewedAt: new Date(now - 2 * DAY), submittedAt: new Date(now - 9 * DAY) }),
    applicant(6, "Contoh Pendaftar Enam", { batchId: B(2), status: "pending", formData: null, submittedAt: new Date(now - 1 * DAY) }),
  ]);

  // ------------------------------------------------------ communication
  put(schema.announcements, [
    {
      id: uuid(0x7, 1),
      title: "Pendaftaran Angkatan Baru Dibuka",
      body: "Daftar sekarang melalui halaman Gabung Siswa.",
      severity: "info",
      ctaLabel: "Daftar",
      ctaUrl: "/gabung-siswa",
      active: true,
      startsAt: new Date(now - 7 * DAY),
      endsAt: new Date(now + 30 * DAY),
      createdBy: id("editor_komunikasi"),
    },
    {
      id: uuid(0x7, 2),
      title: "Jadwal Wawancara Akan Diumumkan",
      body: "Pantau halaman ini untuk jadwal wawancara calon siswa.",
      severity: "warning",
      active: true,
      startsAt: new Date(now + 20 * DAY), // scheduled: not shown yet
      createdBy: id("editor_komunikasi"),
    },
    {
      id: uuid(0x7, 3),
      title: "Pengumuman Lama",
      body: "Pengumuman contoh yang sudah berakhir.",
      severity: "urgent",
      active: false,
      startsAt: new Date(now - 90 * DAY),
      endsAt: new Date(now - 60 * DAY),
      createdBy: admin,
    },
  ]);
  const subjects = ["partnership", "donation", "other", "other"] as const;
  put(
    schema.contactMessages,
    subjects.map((subject, i) => ({
      id: uuid(0x8, i + 1),
      fullName: `Contoh Pengirim ${i + 1}`,
      email: `pengirim-${i + 1}@example.test`,
      subject,
      message: `Halo, ini pesan contoh nomor ${i + 1} dari formulir kontak.`,
      readAt: i < 2 ? new Date(now - (3 - i) * DAY) : null, // two read, two unread
      createdAt: new Date(now - (6 - i) * DAY),
    })),
  );

  // ------------------------------------------------------------- content
  put(schema.reports, [
    { id: uuid(0x9, 1), title: "Laporan Tahunan Contoh", description: "Ringkasan kegiatan setahun.", category: "yearly", year: `${year - 1}/${year}`, filePath: `/reports/${year - 1}-${year}/yearly/laporan-tahunan-contoh.pdf`, fileSize: 2_400_000, uploadedBy: id("editor_konten") },
    { id: uuid(0x9, 2), title: "Laporan Keuangan Contoh", category: "financial", year: `${year - 1}/${year}`, filePath: `/reports/${year - 1}-${year}/financial/laporan-keuangan-contoh.pdf`, fileSize: 1_100_000, uploadedBy: id("editor_konten") },
    { id: uuid(0x9, 3), title: "Laporan Dampak Contoh", description: "Dampak program bagi siswa.", category: "impact", year: `${year - 1}`, filePath: `/reports/${year - 1}/impact/laporan-dampak-contoh.pdf`, fileSize: 1_800_000, uploadedBy: id("editor_konten") },
    { id: uuid(0x9, 4), title: "Laporan Donasi Contoh", category: "donation", year: `${year}`, filePath: `/reports/${year}/donation/laporan-donasi-contoh.pdf`, fileSize: 640_000, uploadedBy: admin },
  ]);
  put(schema.teamMembers, [
    { id: uuid(0xa, 1), name: "Contoh Ketua Pembina", role: "Ketua Pembina", category: "dewan_pembina", bio: "Bio contoh untuk Ketua Pembina.", displayOrder: 1, educationHistory: [{ institution: "Institut Contoh", degree: "S2", year: "2008" }], workHistory: [{ organization: "Lembaga Contoh", role: "Direktur", period: "2010 - 2020" }] },
    { id: uuid(0xa, 2), name: "Contoh Anggota Pembina", role: "Anggota Dewan Pembina", category: "dewan_pembina", displayOrder: 2 },
    { id: uuid(0xa, 3), name: "Contoh Ketua Pengawas", role: "Ketua Dewan Pengawas", category: "dewan_pengawas", image: "/images/team/contoh-ketua-pengawas-ab12cd.jpg", bio: "Bio contoh untuk Ketua Pengawas.", displayOrder: 1, educationHistory: [{ institution: "Universitas Contoh", degree: "S1" }] },
    { id: uuid(0xa, 4), name: "Contoh Ketua Pengurus", role: "Ketua Pengurus", category: "pengurus", image: "/images/team/contoh-ketua-pengurus-cd34ef.jpg", displayOrder: 1, workHistory: [{ organization: "Yayasan Contoh", role: "Koordinator" }] },
    { id: uuid(0xa, 5), name: "Contoh Sekretaris", role: "Sekretaris", category: "pengurus", displayOrder: 2 },
  ]);
  put(schema.siteResources, [
    { id: uuid(0xb, 1), title: "Panduan Pendaftaran Contoh", description: "Langkah-langkah mendaftar.", category: "panduan", displayOrder: 1, contentType: "file", filePath: "/resources/panduan-pendaftaran-contoh.pdf", fileSize: 900_000, updatedBy: id("editor_pendaftaran") },
    { id: uuid(0xb, 2), title: "Formulir Surat Izin Orang Tua Contoh", category: "berkas-pendaftaran", displayOrder: 1, contentType: "file", filePath: "/resources/surat-izin-orang-tua-contoh.pdf", fileSize: 120_000, updatedBy: id("editor_pendaftaran") },
    { id: uuid(0xb, 3), title: "Folder Twibbon Contoh", category: "berkas-marketing", displayOrder: 1, contentType: "url", externalUrl: "https://example.test/twibbon", updatedBy: id("editor_pendaftaran") },
    { id: uuid(0xb, 4), title: "Video Tutorial Unggah Berkas Contoh", category: "tutorial", displayOrder: 1, contentType: "url", externalUrl: "https://example.test/tutorial", notes: "Tautan diganti tiap angkatan.", updatedBy: admin },
    { id: uuid(0xb, 5), title: "Teks Caption Instagram Contoh", category: "berkas-marketing", displayOrder: 2, contentType: "text", bodyText: "Ayo bergabung bersama Sakola Kembara! Daftar di tautan pada bio.", updatedBy: id("editor_pendaftaran") },
    { id: uuid(0xb, 6), title: "Template Pesan Siaran Contoh", category: "lainnya", displayOrder: 1, contentType: "text", bodyText: "Halo, kami membuka pendaftaran angkatan baru. Info lengkap: sakolakembara.org/gabung-siswa", updatedBy: admin },
  ]);
  put(schema.shortlinks, [
    { id: uuid(0xc, 1), slug: "daftar-contoh", targetUrl: "/gabung-siswa", note: "Dibagikan di bio Instagram.", clickCount: 128, lastClickedAt: new Date(now - 1 * DAY), createdBy: id("editor_konten") },
    { id: uuid(0xc, 2), slug: "donasi-contoh", targetUrl: "https://example.test/donasi", active: true, clickCount: 12, lastClickedAt: new Date(now - 5 * DAY), createdBy: id("editor_konten") },
    { id: uuid(0xc, 3), slug: "kampanye-lama", targetUrl: "https://example.test/kampanye", note: "Kampanye selesai; slug tetap dipesan.", active: false, clickCount: 340, lastClickedAt: new Date(now - 120 * DAY), createdBy: admin },
  ]);

  const posts: (typeof schema.blogPosts.$inferInsert)[] = [
    {
      id: uuid(0xd, 1),
      slug: "contoh-cerita-murid-sakola-kembara",
      title: "Contoh Cerita Murid Sakola Kembara",
      excerpt: "Cerita contoh tentang perjalanan seorang murid menuju perguruan tinggi.",
      contentMarkdown: "### **Perjalanan Contoh**\n\nIni paragraf pertama.\n\n- Poin satu\n- Poin dua\n",
      contentHtml: "<h3><strong>Perjalanan Contoh</strong></h3>\n<p>Ini paragraf pertama.</p>\n<ul>\n<li>Poin satu</li>\n<li>Poin dua</li>\n</ul>",
      image: "/blog/images/contoh/cerita-murid.jpg",
      imageWidth: 2560,
      imageHeight: 1707,
      category: "Cerita",
      author: "Contoh Penulis",
      featured: true,
      status: "published",
      publishedAt: new Date(now - 20 * DAY),
      createdBy: id("editor_konten"),
      updatedBy: id("editor_konten"),
    },
    {
      id: uuid(0xd, 2),
      slug: "contoh-tips-menghadapi-snbt",
      title: "Contoh Tips Menghadapi SNBT",
      excerpt: "Tips contoh agar siap menghadapi seleksi.",
      contentMarkdown: "Belajar **rutin** lebih baik daripada belajar semalam suntuk.\n\n![Meja belajar](/blog/images/contoh/meja-belajar.webp)\n",
      contentHtml: '<p>Belajar <strong>rutin</strong> lebih baik daripada belajar semalam suntuk.</p>\n<p><img src="/blog/images/contoh/meja-belajar.webp" alt="Meja belajar" width="1200" height="800" loading="lazy" class="rounded-xl max-w-full h-auto my-6"></p>',
      image: "/blog/images/contoh/tips-snbt.png",
      imageWidth: 1200,
      imageHeight: 800,
      category: "Tips",
      author: "Contoh Penulis",
      status: "published",
      publishedAt: new Date(now - 45 * DAY),
      createdBy: id("editor_konten"),
    },
    {
      id: uuid(0xd, 3),
      slug: "contoh-artikel-impor-wordpress",
      title: "Contoh Artikel Impor WordPress",
      excerpt: "Artikel contoh yang berasal dari situs WordPress lama.",
      contentMarkdown: "Isi artikel impor contoh.\n",
      contentHtml: "<p>Isi artikel impor contoh.</p>",
      category: "News",
      author: "Contoh Penulis Dua",
      status: "published",
      publishedAt: new Date(now - 300 * DAY),
      wpId: 9001,
      sourceUrl: "https://example.test/news/contoh-artikel-impor-wordpress/",
    },
    {
      id: uuid(0xd, 4),
      slug: "contoh-draf-artikel",
      title: "Contoh Draf Artikel",
      excerpt: "Draf yang belum dipublikasikan.",
      contentMarkdown: "Draf *contoh*.\n",
      contentHtml: "<p>Draf <em>contoh</em>.</p>",
      category: "Uncategorized",
      author: "Contoh Penulis",
      status: "draft",
      createdBy: id("editor_konten"),
    },
  ];
  put(schema.blogPosts, posts);
  put(schema.media, [
    { id: uuid(0xe, 1), key: "blog/images/contoh/cerita-murid.jpg", purpose: "blog", contentType: "image/jpeg", size: 412_000, width: 2560, height: 1707, uploadedBy: id("editor_konten") },
    { id: uuid(0xe, 2), key: "blog/images/contoh/meja-belajar.webp", purpose: "blog", contentType: "image/webp", size: 96_000, width: 1200, height: 800, uploadedBy: id("editor_konten") },
    { id: uuid(0xe, 3), key: "images/team/contoh-ketua-pengawas-ab12cd.jpg", purpose: "team", contentType: "image/jpeg", size: 58_000, width: 800, height: 800, uploadedBy: id("editor_konten") },
    { id: uuid(0xe, 4), key: "reports/2025-2026/yearly/laporan-tahunan-contoh.pdf", purpose: "report", contentType: "application/pdf", size: 2_400_000, uploadedBy: id("editor_konten") },
    { id: uuid(0xe, 5), key: "resources/panduan-pendaftaran-contoh.pdf", purpose: "resource", contentType: "application/pdf", size: 900_000, uploadedBy: id("editor_pendaftaran") },
  ]);

  // --------------------------------------------------------------- audit
  const audit = (n: number, actor: string, action: string, resourceType: string | null, resourceId: string | null, metadata: Record<string, unknown> | null, daysAgo: number) => ({
    id: uuid(0xf, n),
    actorId: id(actor),
    actorEmail: SEED_USERS.find((u) => u.key === actor)!.email,
    action,
    resourceType,
    resourceId,
    metadata,
    createdAt: new Date(now - daysAgo * DAY),
  });
  put(schema.auditLog, [
    audit(1, "super_admin", "admin.update", "admin_user", id("editor_konten"), { field: "areas", before: [], after: ["konten"] }, 60),
    audit(2, "editor_komunikasi", "announcement.create", "announcement", uuid(0x7, 1), { title: "Pendaftaran Angkatan Baru Dibuka", severity: "info", active: true }, 7),
    audit(3, "editor_konten", "blog.create", "blog", uuid(0xd, 1), { title: "Contoh Cerita Murid Sakola Kembara" }, 21),
    audit(4, "editor_pendaftaran", "application.under_review", "application", A(5), { notes: "Menunggu bukti penghasilan." }, 2),
    audit(5, "editor_konten", "shortlink.create", "shortlink", uuid(0xc, 1), { slug: "daftar-contoh" }, 40),
    audit(6, "super_admin", "batch.create", "batch", B(2), { year }, 40),
  ]);

  await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  return { counts, password };
}
