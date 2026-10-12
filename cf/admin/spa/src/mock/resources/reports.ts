import { CATEGORIES, type ReportCategory, type ReportItem } from "~/pages/reports/model";
import { isValidReportYear } from "../../../../src/reports/rules";
import type { MockResource } from "../resources";

// MOCK, local development only. The reports of `GET /api/admin/reports`, with the Worker's rules (src/api/reports.ts)
// in miniature. The year is the Worker's own function, so the same years are accepted.
//
// One thing the generic store cannot tell: whether a body is a create or an update. A create carries the file
// (`filePath`, from the upload field), an update never does (a report's file cannot be replaced), so the presence of
// `filePath` is what decides here. The screen always sends the key on a create, empty when no file was picked.

const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** The Worker's item, plus the `createdAt` the generic store keeps on every row (a report has no such column: its upload time is its creation). */
type MockReport = ReportItem & { createdAt: string };

function seed(): MockReport[] {
  const row = (n: number, year: string, category: ReportCategory, title: string, description: string | null, fileSize: number, ageDays: number): MockReport => ({
    id: `mock-report-${n}`,
    title,
    description,
    category,
    year,
    filePath: `/uploads/report/2026/00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}-laporan-contoh-${n}.pdf`,
    fileSize,
    uploadedAt: iso(-ageDays * DAY),
    createdAt: iso(-ageDays * DAY),
    updatedAt: iso(-ageDays * DAY),
  });
  return [
    row(1, "2025/2026", "impact", "Laporan Dampak 2025/2026", "Ringkasan dampak program bagi siswa dan cabang pada tahun ajaran berjalan (data contoh).", 1_843_200, 10),
    row(2, "2025/2026", "financial", "Laporan Keuangan Semester 1 2025/2026", null, 512_000, 40),
    row(3, "2025", "yearly", "Laporan Tahunan 2025", "Gambaran kegiatan, capaian, dan pengelolaan sepanjang tahun 2025 (data contoh).", 3_145_728, 200),
    row(4, "2025", "donation", "Laporan Donasi 2025", "Penerimaan dan penyaluran donasi sepanjang tahun 2025 (data contoh).", 87_040, 210),
    row(5, "2024/2025", "impact", "Laporan Dampak 2024/2025", null, 1_572_864, 400),
  ];
}

const resource: MockResource<MockReport> = {
  path: "/api/admin/reports",
  area: "konten",
  seed,
  search: ["title", "description", "year"],
  filters: { category: CATEGORIES },
  sorts: ["year", "title", "category", "uploadedAt", "fileSize"],
  defaultSort: "-year",
  parse(body) {
    const fields: Record<string, string> = {};
    const title = text(body.title);
    const description = text(body.description);
    const year = text(body.year);
    if (title.length < 3) fields.title = "Judul minimal 3 karakter";
    else if (title.length > 200) fields.title = "Judul maksimal 200 karakter";
    if (description.length > 1000) fields.description = "Deskripsi maksimal 1000 karakter";
    if (!(CATEGORIES as readonly unknown[]).includes(body.category)) fields.category = "Kategori tidak dikenal";
    if (!isValidReportYear(year)) fields.year = "Format tahun tidak valid. Contoh: 2025 atau 2025/2026";

    const creating = "filePath" in body;
    const filePath = text(body.filePath);
    const fileSize = body.fileSize;
    if (creating) {
      if (!/^\/uploads\/report\/\d{4}\/[0-9a-f-]{36}-[a-z0-9-]+\.pdf$/.test(filePath)) fields.filePath = "File PDF wajib diupload.";
      else if (typeof fileSize !== "number" || !Number.isInteger(fileSize) || fileSize < 0) fields.fileSize = "Ukuran file tidak valid.";
      else if (fileSize > 20_000_000) fields.fileSize = "Ukuran file maksimal 20 MB.";
    }
    if (Object.keys(fields).length > 0) return { ok: false, fields };

    return {
      ok: true,
      values: {
        title,
        description: description || null,
        category: body.category as ReportCategory,
        year,
        ...(creating ? { filePath, fileSize: fileSize as number, uploadedAt: new Date().toISOString() } : {}),
      },
    };
  },
};

export default resource;
