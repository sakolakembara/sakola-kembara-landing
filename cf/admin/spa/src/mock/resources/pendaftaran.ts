import type { BatchDetail, BatchItem, BatchListed } from "~/pages/batches/model";
import type { ApplicationDetail, ApplicationListed, ApplicationStatus } from "~/pages/applications/model";
import { REVOCATION_NOTES_MIN, STATUSES } from "~/pages/applications/model";
import { CATEGORIES, CONTENT_TYPES, type ResourceItem } from "~/pages/resources/model";
import type { AnyMockResource, MockResource, MockRowBase } from "../resources";

// MOCK, local development only. The three resources of the Pendaftaran area (docs/cloudflare/admin-pendaftaran.md)
// answered the way the Worker does it, in miniature: batches (with their phase, the counts, the newest applicants,
// publish and unpublish), applicants (filters, a prefix search, the review with its rules) and the Pusat Dokumen.
// Everything is invented (reserved example addresses); nothing leaves memory, and a reload starts from the seed.
//
// The three stores share one "world" made by the first of them (the batches): the applicants of a batch are what
// its counts and its "in use" refusal read. Personas that cannot read or write the area never get here (the generic
// store answers 403 first).

const DAY = 24 * 60 * 60 * 1000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();

type BatchRow = BatchItem & MockRowBase;
type ApplicationRow = ApplicationDetail & MockRowBase;

interface World {
  batches: BatchRow[];
  applications: ApplicationRow[];
}

let world: World = { batches: [], applications: [] };

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const failure = (status: number, code: string, message?: string, extra: Record<string, unknown> = {}) => json({ error: code, ...(message ? { message } : {}), ...extra }, status);

const NOT_FOUND = "Data tidak ditemukan. Mungkin sudah dihapus.";
const INVALID = "Periksa kembali isian formulir.";

function bodyOf(init: RequestInit): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(String(init.body ?? "null"));
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function clamp(raw: string | null, fallback: number, max: number): number {
  if (raw === null || !/^\d{1,30}$/.test(raw.trim())) return fallback;
  const value = Number(raw);
  return value >= 1 ? Math.min(value, max) : fallback;
}

/** The list envelope of the rows of one page (the Worker's `pageOf`). */
function envelope<T>(rows: T[], url: URL, fallbackSize = 20) {
  const page = clamp(url.searchParams.get("page"), 1, 10_000);
  const pageSize = clamp(url.searchParams.get("pageSize"), fallbackSize, 100);
  return { items: rows.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: rows.length };
}

const refused = (param: string) => failure(400, "invalid_query", "Pencarian atau penyaringan tidak dikenal.", { param });

// ------------------------------------------------------------------ the seed

function seedWorld(): World {
  const batch = (id: string, year: number, name: string, opens: number, closes: number, published: number | null, description: string | null = null): BatchRow => ({
    id,
    year,
    name,
    description,
    opensAt: iso(opens),
    closesAt: iso(closes),
    resultsPublishedAt: published === null ? null : iso(published),
    createdAt: iso(opens - 30 * DAY),
    updatedAt: iso(opens - 30 * DAY),
  });
  const batches: BatchRow[] = [
    batch("mock-batch-2027", 2027, "Gen 8 — 2027/2028", 90 * DAY, 150 * DAY, null, "Angkatan berikutnya, belum dibuka."),
    batch("mock-batch-2026", 2026, "Gen 7 — 2026/2027", -30 * DAY, 30 * DAY, null, "Angkatan yang sedang membuka pendaftaran."),
    batch("mock-batch-2025", 2025, "Gen 6 — 2025/2026", -400 * DAY, -340 * DAY, null),
    batch("mock-batch-2024", 2024, "Gen 5 — 2024/2025", -770 * DAY, -710 * DAY, -700 * DAY),
  ];

  let n = 0;
  const person = (batchId: string, status: ApplicationStatus, name: string, over: Partial<ApplicationDetail> = {}): ApplicationRow => {
    n += 1;
    const submittedAt = iso(-(40 - n) * DAY);
    return {
      id: `mock-app-${n}`,
      batch: { id: batchId, year: batches.find((b) => b.id === batchId)!.year, name: batches.find((b) => b.id === batchId)!.name },
      fullName: name,
      email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@contoh.test`,
      whatsapp: `08120000${String(n).padStart(4, "0")}`,
      schoolName: n % 2 === 0 ? "SMAN 1 Contoh" : "SMK Harapan Contoh",
      graduationYear: "2026",
      branchPreference: n % 3 === 0 ? "Bandung" : n % 3 === 1 ? "Cililin" : null,
      motivation: null,
      economicBackground: null,
      formData: fullForm(name),
      status,
      reviewNotes: status === "accepted" ? "Berkas lengkap, wawancara baik." : status === "rejected" ? "Tidak memenuhi syarat penghasilan." : null,
      reviewedAt: status === "pending" ? null : iso(-5 * DAY),
      submittedAt,
      updatedAt: submittedAt,
      createdAt: submittedAt,
      ...over,
    };
  };
  const applications: ApplicationRow[] = [
    person("mock-batch-2026", "pending", "Siti Aminah"),
    person("mock-batch-2026", "pending", "Budi Santoso"),
    person("mock-batch-2026", "under_review", "Ani Lestari"),
    person("mock-batch-2026", "accepted", "Dewi Rahma"),
    person("mock-batch-2026", "rejected", "Eko Prasetyo"),
    person("mock-batch-2026", "pending", "Fajar Nugroho", { formData: null, motivation: "Ingin kuliah tapi biaya terbatas.", economicBackground: "Orang tua petani." }),
    person("mock-batch-2025", "pending", "Gita Permata"),
    person("mock-batch-2025", "pending", "Hadi Wijaya"),
    person("mock-batch-2025", "under_review", "Intan Maharani"),
    person("mock-batch-2025", "accepted", "Joko Susilo"),
    person("mock-batch-2025", "accepted", "Kartika Sari"),
    person("mock-batch-2025", "rejected", "Lukman Hakim"),
    person("mock-batch-2024", "accepted", "Maya Anggraini"),
    person("mock-batch-2024", "accepted", "Nanda Pratama"),
    person("mock-batch-2024", "rejected", "Okta Ramadhan"),
  ];
  return { batches, applications };
}

function fullForm(name: string) {
  return {
    formVersion: 2,
    identity: { nickname: name.split(" ")[0], gender: "perempuan", religion: "Islam", homeAddress: "Jl. Contoh No. 1\nKecamatan Contoh" },
    household: {
      livingWith: ["Ayah", "Ibu"],
      father: { name: "Bapak Contoh", occupation: "Petani", income: 1_200_000 },
      mother: { name: "Ibu Contoh", occupation: "Ibu rumah tangga", income: 0 },
      otherEarners: [{ relation: "Kakak", income: 800_000 }],
      familySize: 5,
    },
    housing: { residenceStatus: "Milik sendiri", buildingArea: 36, motorcycles: 1, cars: 0, debt: { type: "Pinjaman bank", amount: 5_000_000, installmentMonths: 24, description: "Modal usaha tani" } },
    organizations: [{ name: "OSIS", position: "Anggota" }],
    documents: {
      fatherIncomeUrl: "https://drive.contoh.test/penghasilan-ayah",
      motherIncomeUrl: null,
      otherEarner1IncomeUrl: null,
      otherEarner2IncomeUrl: null,
      debtProofUrl: "https://drive.contoh.test/bukti-hutang",
      electricityBillUrl: "https://drive.contoh.test/listrik",
      familyCardUrl: "https://drive.contoh.test/kk",
      parentPermissionUrl: "https://drive.contoh.test/izin",
      selfPhotoUrl: "https://drive.contoh.test/foto",
      dtksRegistered: true,
      dtksUrl: "https://drive.contoh.test/dtks",
      houseImagesUrl: "https://drive.contoh.test/rumah",
      vehicleImagesUrl: "https://drive.contoh.test/kendaraan",
    },
    marketing: {
      instagramUsername: "@contoh.siswa",
      instagramFollowProofUrl: "https://drive.contoh.test/follow",
      broadcastProofUrl: "https://drive.contoh.test/broadcast",
      twibbonUploadUrl: "https://drive.contoh.test/twibbon",
      storyUploadUrl: "https://drive.contoh.test/story",
    },
    interview: {
      motivationHigherEducation: "Saya ingin kuliah supaya bisa membantu keluarga.",
      motivationSakem: "Saya ingin belajar bersama teman-teman di Sakola Kembara.\nSaya siap datang tiap pekan.",
      consistencyPlan: "Belajar setiap malam.",
      attendanceCommitment: "Hadir penuh.",
      parentResponse: "Orang tua mendukung.",
      ifParentChangesMind: "Saya akan berdiskusi lagi.",
      agreedToSignedStatement: true,
    },
  };
}

// ------------------------------------------------------------------- batches

function countsOf(batchId: string) {
  const counts = { pending: 0, under_review: 0, accepted: 0, rejected: 0, total: 0 };
  for (const application of world.applications) {
    if (application.batch.id !== batchId) continue;
    counts[application.status] += 1;
    counts.total += 1;
  }
  return counts;
}

/** The dashboard's own rule (src/dashboard/payload.ts `batchPhase`), in miniature. */
function phaseOf(batch: BatchItem, undecided: number, total: number): BatchListed["phase"] {
  const now = Date.now();
  if (now < Date.parse(batch.opensAt)) return "upcoming";
  if (now <= Date.parse(batch.closesAt)) return "open";
  if (batch.resultsPublishedAt) return "published";
  if (total === 0) return "closed_empty";
  return undecided > 0 ? "awaiting_decisions" : "ready_to_publish";
}

function listedBatch(batch: BatchRow): BatchListed {
  const counts = countsOf(batch.id);
  const { id, year, name, description, opensAt, closesAt, resultsPublishedAt, createdAt, updatedAt } = batch;
  return {
    id, year, name, description, opensAt, closesAt, resultsPublishedAt, createdAt, updatedAt,
    phase: phaseOf(batch, counts.pending + counts.under_review, counts.total),
    pending: counts.pending,
    underReview: counts.under_review,
  };
}

function detailOf(batch: BatchRow): BatchDetail {
  const counts = countsOf(batch.id);
  const undecided = counts.pending + counts.under_review;
  const { id, year, name, description, opensAt, closesAt, resultsPublishedAt, createdAt, updatedAt } = batch;
  const recent = world.applications
    .filter((application) => application.batch.id === batch.id)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .slice(0, 5)
    .map((a) => ({ id: a.id, fullName: a.fullName, email: a.email, schoolName: a.schoolName, status: a.status, submittedAt: a.submittedAt }));
  return {
    id, year, name, description, opensAt, closesAt, resultsPublishedAt, createdAt, updatedAt,
    phase: phaseOf(batch, undecided, counts.total),
    counts,
    canPublish: !resultsPublishedAt && counts.total > 0 && undecided === 0,
    recent,
  };
}

const batches: MockResource<BatchRow> = {
  path: "/api/admin/batches",
  area: "pendaftaran",
  seed: () => {
    world = seedWorld();
    return world.batches;
  },
  parse(body) {
    const fields: Record<string, string> = {};
    const year = body.year === "" || body.year === null ? 0 : Number(body.year);
    if (Number.isNaN(year)) fields.year = "Tahun harus berupa angka";
    else if (!Number.isInteger(year)) fields.year = "Tahun harus bilangan bulat";
    else if (year < 2024) fields.year = "Tahun terlalu jauh ke belakang";
    else if (year > 2100) fields.year = "Tahun terlalu jauh ke depan";
    const name = text(body.name);
    if (name.length < 3) fields.name = "Nama minimal 3 karakter";
    else if (name.length > 120) fields.name = "Nama maksimal 120 karakter";
    const description = text(body.description);
    if (description.length > 1000) fields.description = "Deskripsi maksimal 1000 karakter";
    const date = (value: unknown, missing: string) => {
      if (typeof value !== "string" || value === "") return { error: missing };
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? { error: "Format tanggal tidak valid" } : { date: parsed };
    };
    const opens = date(body.opensAt, "Tanggal buka wajib diisi");
    const closes = date(body.closesAt, "Tanggal tutup wajib diisi");
    if (opens.error) fields.opensAt = opens.error;
    if (closes.error) fields.closesAt = closes.error;
    if (opens.date && closes.date && closes.date.getTime() <= opens.date.getTime()) fields.closesAt = "Tanggal tutup harus setelah tanggal buka";
    if (Object.keys(fields).length > 0) return { ok: false, fields };
    return { ok: true, values: { year, name, description: description || null, opensAt: opens.date!.toISOString(), closesAt: closes.date!.toISOString(), resultsPublishedAt: null } };
  },
  inUse: (row) => (world.applications.some((application) => application.batch.id === row.id) ? ["Pendaftar"] : null),
  custom({ method, rest, url, init, rows }) {
    // The year is unique (a 409 on the field, after the form itself passed, like the Worker's unique index).
    if ((method === "POST" && rest === "") || (method === "PUT" && !rest.includes("/"))) {
      const body = bodyOf(init);
      const parsed = body ? batches.parse(body) : null;
      const selfId = rest === "" ? "" : decodeURIComponent(rest);
      if (parsed?.ok && rows.some((other) => other.year === parsed.values.year && other.id !== selfId)) {
        return failure(409, "conflict", "Data bentrok dengan data lain yang sudah ada.", { fields: { year: "Tahun sudah dipakai batch lain" } });
      }
      return null; // the generic store checks the form and stores it
    }
    if (rest === "" && method === "GET") {
      const wanted = url.searchParams.get("sort") || "-year";
      const name = wanted.replace(/^-/, "");
      if (!["year", "opensAt", "name"].includes(name)) return refused("sort");
      const q = (url.searchParams.get("q") ?? "").trim().slice(0, 48).toLowerCase();
      const direction = wanted.startsWith("-") ? -1 : 1;
      const found = rows
        .filter((row) => !q || row.name.toLowerCase().includes(q))
        .sort((a, b) => direction * (String(a[name as "year"]) < String(b[name as "year"]) ? -1 : String(a[name as "year"]) > String(b[name as "year"]) ? 1 : 0));
      return json(envelope(found.map(listedBatch), url));
    }
    const [id, verb] = rest.split("/");
    const batch = rows.find((row) => row.id === decodeURIComponent(id ?? ""));
    if (verb === undefined && method === "GET" && rest !== "") return batch ? json({ item: detailOf(batch) }, 200, { ETag: `"${batch.updatedAt}"` }) : failure(404, "not_found", NOT_FOUND);
    if (method !== "POST" || (verb !== "publish" && verb !== "unpublish")) return null;
    if (!batch) return failure(404, "not_found", "Batch tidak ditemukan");
    const detail = detailOf(batch);
    const touch = () => (batch.updatedAt = new Date(Math.max(Date.now(), Date.parse(batch.updatedAt) + 1)).toISOString());
    if (verb === "publish") {
      if (batch.resultsPublishedAt) return failure(409, "already_published", "Hasil sudah dipublikasikan");
      if (detail.counts.total === 0) return failure(409, "no_applicants", "Belum ada pendaftar di batch ini");
      const undecided = detail.counts.pending + detail.counts.under_review;
      if (undecided > 0) return failure(409, "undecided", `Masih ada ${undecided} pendaftar yang belum diputuskan`, { undecided });
      batch.resultsPublishedAt = new Date().toISOString();
      touch();
    } else if (batch.resultsPublishedAt) {
      batch.resultsPublishedAt = null;
      touch();
    }
    return json({ item: detailOf(batch) }, 200, { ETag: `"${batch.updatedAt}"` });
  },
};

// -------------------------------------------------------------- applications

const applicationsMock: MockResource<ApplicationRow> = {
  path: "/api/admin/applications",
  area: "pendaftaran",
  seed: () => world.applications,
  parse: () => ({ ok: false, fields: {} }),
  custom({ method, rest, url, init, rows }) {
    if (rest === "") {
      if (method !== "GET") return failure(404, "not_found");
      const params = url.searchParams;
      const status = params.get("status");
      if (status && !(STATUSES as readonly string[]).includes(status)) return refused("status");
      const batch = params.get("batch");
      const wanted = params.get("sort") || "-submittedAt";
      const name = wanted.replace(/^-/, "");
      if (!["submittedAt", "fullName"].includes(name)) return refused("sort");
      const q = (params.get("q") ?? "").trim().slice(0, 48).toLowerCase();
      // A PREFIX of the name or of the email, like the Worker; never the middle.
      const found = rows
        .filter((row) => (!status || row.status === status) && (!batch || batch === "all" || row.batch.id === batch))
        .filter((row) => !q || row.fullName.toLowerCase().startsWith(q) || row.email.toLowerCase().startsWith(q))
        .sort((a, b) => (wanted.startsWith("-") ? -1 : 1) * (a[name as "fullName"] < b[name as "fullName"] ? -1 : a[name as "fullName"] > b[name as "fullName"] ? 1 : 0));
      const items: ApplicationListed[] = found.map((row) => ({
        id: row.id,
        fullName: row.fullName,
        email: row.email,
        schoolName: row.schoolName,
        graduationYear: row.graduationYear,
        branchPreference: row.branchPreference,
        status: row.status,
        submittedAt: row.submittedAt,
        updatedAt: row.updatedAt,
        batch: row.batch,
      }));
      return json(envelope(items, url));
    }

    const [rawId, verb] = rest.split("/");
    const application = rows.find((row) => row.id === decodeURIComponent(rawId ?? ""));
    if (verb === undefined) {
      if (method !== "GET") return failure(404, "not_found");
      return application ? json({ item: application }, 200, { ETag: `"${application.updatedAt}"` }) : failure(404, "not_found", NOT_FOUND);
    }
    if (verb !== "status" || method !== "POST") return failure(404, "not_found");

    // The review: the Worker's order of answers (428, the body, 404, stale, the revocation rule).
    const precondition = new Headers(init.headers).get("If-Match");
    if (precondition === null) return failure(428, "precondition_required", "Versi data tidak disertakan. Muat ulang halaman lalu coba lagi.");
    const body = bodyOf(init);
    if (!body) return failure(400, "invalid_json", "Isi permintaan bukan JSON yang valid.");
    const status = body.status as ApplicationStatus;
    const notes = text(body.reviewNotes);
    const fields: Record<string, string> = {};
    if (!(STATUSES as readonly unknown[]).includes(status)) fields.status = "Status tidak dikenal";
    if (notes.length > 2000) fields.reviewNotes = "Catatan review maksimal 2000 karakter";
    else if ((status === "accepted" || status === "rejected") && notes === "") fields.reviewNotes = "Catatan review wajib diisi saat menerima atau menolak.";
    if (Object.keys(fields).length > 0) return failure(400, "invalid", INVALID, { fields });
    if (!application) return failure(404, "not_found", "Pendaftar tidak ditemukan.");
    if (precondition !== `"${application.updatedAt}"`) return failure(409, "stale", "Data ini sudah diubah orang lain sejak kamu membukanya. Muat ulang untuk melihat versi terbaru.");
    if (application.status === "accepted" && status === "rejected" && notes.length < REVOCATION_NOTES_MIN) {
      return failure(400, "invalid", INVALID, { fields: { reviewNotes: `Alasan pencabutan wajib diisi minimal ${REVOCATION_NOTES_MIN} karakter — jelaskan mengapa penerimaan ini dibatalkan.` } });
    }
    application.status = status;
    application.reviewNotes = notes || null;
    application.reviewedAt = new Date().toISOString();
    application.updatedAt = new Date(Math.max(Date.now(), Date.parse(application.updatedAt) + 1)).toISOString();
    return json({ item: application }, 200, { ETag: `"${application.updatedAt}"` });
  },
};

// ----------------------------------------------------------- Pusat Dokumen

type ResourceRow = ResourceItem & MockRowBase;

function seedResources(): ResourceRow[] {
  const row = (id: string, over: Partial<ResourceItem>): ResourceRow => ({
    id,
    title: id,
    description: null,
    category: "panduan",
    displayOrder: 100,
    contentType: "text",
    filePath: null,
    fileSize: null,
    externalUrl: null,
    bodyText: "Teks contoh",
    notes: null,
    createdAt: iso(-30 * DAY),
    updatedAt: iso(-10 * DAY),
    ...over,
  });
  return [
    row("mock-res-1", { title: "Panduan Pendaftaran Sakola Kembara Gen 7", description: "Alur pendaftaran dari awal sampai pengumuman.", category: "panduan", displayOrder: 10, contentType: "file", filePath: "/uploads/resource/2026/00000000-0000-4000-8000-000000000001-panduan.pdf", fileSize: 1_250_000, bodyText: null }),
    row("mock-res-2", { title: "Templat Surat Izin Orang Tua", description: "Cetak, isi, tanda tangani, lalu unggah ke Google Drive.", category: "berkas-pendaftaran", displayOrder: 10, contentType: "file", filePath: "/uploads/resource/2026/00000000-0000-4000-8000-000000000002-surat-izin.pdf", fileSize: 85_000, bodyText: null }),
    row("mock-res-3", { title: "Folder Berkas Contoh", category: "berkas-pendaftaran", displayOrder: 20, contentType: "url", externalUrl: "https://drive.contoh.test/folder-contoh", bodyText: null, notes: "Dikelola Panitia" }),
    row("mock-res-4", { title: "Caption Instagram", description: "Salin, tempel, lalu bagikan.", category: "berkas-marketing", displayOrder: 10, contentType: "text", bodyText: "Aku daftar jadi siswa Sakola Kembara! #SakolaKembara" }),
    row("mock-res-5", { title: "Cara Mendapatkan Token Listrik PLN", category: "tutorial", displayOrder: 10, contentType: "url", externalUrl: "https://youtube.contoh.test/watch?v=contoh", bodyText: null }),
  ];
}

const resources: MockResource<ResourceRow> = {
  path: "/api/admin/resources",
  area: "pendaftaran",
  seed: seedResources,
  search: ["title", "description"],
  filters: { category: CATEGORIES, contentType: CONTENT_TYPES },
  sorts: ["category", "title", "displayOrder", "updatedAt"],
  defaultSort: "category",
  parse(body) {
    const fields: Record<string, string> = {};
    const title = text(body.title);
    if (title.length < 2) fields.title = "Judul minimal 2 karakter";
    else if (title.length > 200) fields.title = "Judul maksimal 200 karakter";
    const description = text(body.description);
    if (description.length > 1000) fields.description = "Deskripsi maksimal 1000 karakter";
    if (!(CATEGORIES as readonly unknown[]).includes(body.category)) fields.category = "Kategori tidak dikenal";
    const order = body.displayOrder === "" ? Number.NaN : Number(body.displayOrder);
    if (Number.isNaN(order)) fields.displayOrder = "Wajib diisi";
    else if (!Number.isInteger(order)) fields.displayOrder = "Harus bilangan bulat";
    else if (order < 0) fields.displayOrder = "Tidak boleh negatif";
    else if (order > 9999) fields.displayOrder = "Maksimal 9999";
    const type = body.contentType;
    if (!(CONTENT_TYPES as readonly unknown[]).includes(type)) fields.contentType = "Tipe konten tidak dikenal";
    const filePath = text(body.filePath);
    const externalUrl = text(body.externalUrl);
    const bodyText = text(body.bodyText);
    const size = body.fileSize === null || body.fileSize === undefined || body.fileSize === "" ? null : Number(body.fileSize);
    if (type === "file" && (!filePath || size === null)) fields.filePath = "File wajib diupload.";
    if (type === "file" && size !== null && size > 25_000_000) fields.fileSize = "Ukuran file maksimal 25 MB.";
    if (type === "url") {
      if (!externalUrl) fields.externalUrl = "URL wajib diisi untuk tipe Link Eksternal.";
      else if (!/^https?:\/\//i.test(externalUrl)) fields.externalUrl = "Format URL tidak valid";
    }
    if (type === "text" && !bodyText) fields.bodyText = "Isi teks yang bisa disalin.";
    if (text(body.notes).length > 500) fields.notes = "Catatan maksimal 500 karakter";
    if (Object.keys(fields).length > 0) return { ok: false, fields };
    return {
      ok: true,
      values: {
        title,
        description: description || null,
        category: body.category as ResourceItem["category"],
        displayOrder: order,
        contentType: type as ResourceItem["contentType"],
        filePath: type === "file" ? filePath : null,
        fileSize: type === "file" ? size : null,
        externalUrl: type === "url" ? externalUrl : null,
        bodyText: type === "text" ? bodyText : null,
        notes: text(body.notes) || null,
      },
    };
  },
  custom({ method, rest, url, rows }) {
    // The list in the public page's own order: the categories as the page has them, then the manual order, then creation.
    if (rest !== "" || method !== "GET") return null;
    const params = url.searchParams;
    const wanted = params.get("sort") || "category";
    const name = wanted.replace(/^-/, "");
    if (!["category", "title", "displayOrder", "updatedAt"].includes(name)) return refused("sort");
    for (const [filter, values] of [["category", CATEGORIES], ["contentType", CONTENT_TYPES]] as const) {
      const raw = params.get(filter);
      if (raw && !(values as readonly string[]).includes(raw)) return refused(filter);
    }
    const q = (params.get("q") ?? "").trim().slice(0, 48).toLowerCase();
    const found = rows
      .filter((row) => !params.get("category") || row.category === params.get("category"))
      .filter((row) => !params.get("contentType") || row.contentType === params.get("contentType"))
      .filter((row) => !q || row.title.toLowerCase().includes(q) || (row.description ?? "").toLowerCase().includes(q));
    const direction = wanted.startsWith("-") ? -1 : 1;
    const byOrder = (a: ResourceRow, b: ResourceRow) => a.displayOrder - b.displayOrder || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
    found.sort((a, b) => {
      if (name === "category") return direction * (CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category)) || byOrder(a, b);
      const left = a[name as "title"];
      const right = b[name as "title"];
      return direction * (left < right ? -1 : left > right ? 1 : 0) || a.id.localeCompare(b.id);
    });
    return json(envelope(found, url, 100));
  },
};

const all: AnyMockResource[] = [batches, applicationsMock, resources];
export default all;
