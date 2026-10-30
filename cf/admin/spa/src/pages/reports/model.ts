import type { TagTone } from "~/components/ui/tag";
import { makeStatusMap } from "~/components/crud/StatusTag";
import type { ListSpec } from "~/lib/crud/query";

// What the Laporan screens share: the types, the labels, the list's spec and the form's values. Labels, tones and
// the rules of the year are the legacy admin's (lib/report-types.ts, app/(admin)/admin/reports/*).

/** The API collection and the SPA route of the menu. */
export const API_PATH = "/api/admin/reports";
export const ROUTE = "/reports";

export type ReportCategory = "yearly" | "financial" | "impact" | "donation";

/** An item as the API answers it (`present` in src/api/reports.ts). */
export interface ReportItem {
  id: string;
  title: string;
  description: string | null;
  category: ReportCategory;
  year: string;
  filePath: string;
  fileSize: number;
  uploadedAt: string;
  updatedAt: string;
}

export const CATEGORY_LABEL: Record<ReportCategory, string> = {
  yearly: "Laporan Tahunan",
  financial: "Laporan Keuangan",
  impact: "Laporan Dampak",
  donation: "Laporan Donasi",
};
export const CATEGORY_TONE: Record<ReportCategory, TagTone> = { yearly: "blue", financial: "green", impact: "purple", donation: "amber" };
export const CATEGORIES = Object.keys(CATEGORY_LABEL) as ReportCategory[];

export const CATEGORY_STATUS = makeStatusMap({
  yearly: { label: CATEGORY_LABEL.yearly, tone: CATEGORY_TONE.yearly },
  financial: { label: CATEGORY_LABEL.financial, tone: CATEGORY_TONE.financial },
  impact: { label: CATEGORY_LABEL.impact, tone: CATEGORY_TONE.impact },
  donation: { label: CATEGORY_LABEL.donation, tone: CATEGORY_TONE.donation },
});

/**
 * What the list offers: the same names as the Worker's filters and sorts (src/api/reports.ts). The legacy list showed
 * every report on one page, so a page holds as many as the API allows.
 */
export const LIST_SPEC: ListSpec = {
  filters: ["category"],
  sorts: ["year", "title", "category", "uploadedAt", "fileSize"],
  defaultSort: "-year",
  pageSize: 100,
};

/** "512 B", "340 KB", "1.8 MB" (legacy `formatBytes`). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** "Tahun Ajaran" for 2025/2026, "Tahun" for 2025 (the line under the year in the list). */
export function yearKind(year: string): string {
  return year.includes("/") ? "Tahun Ajaran" : "Tahun";
}

/** The form's first suggestion for the year: the academic year that starts this year (legacy: `2026/2027`). */
export function defaultYear(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  return `${year}/${year + 1}`;
}

// ----------------------------------------------------------------------- the form

export interface ReportValues extends Record<string, string | boolean> {
  title: string;
  description: string;
  category: ReportCategory;
  year: string;
  /** The path of the uploaded PDF ("" before one is picked); only a new report has it in its form. */
  filePath: string;
  /** The size the upload answered, in bytes, as text ("" before a file is picked). */
  fileSize: string;
}

export function toValues(item: ReportItem | null): ReportValues {
  return {
    title: item?.title ?? "",
    description: item?.description ?? "",
    category: item?.category ?? "yearly",
    year: item?.year ?? defaultYear(),
    filePath: item?.filePath ?? "",
    fileSize: item ? String(item.fileSize) : "",
  };
}

/** The body of `POST`: the metadata and the file that was uploaded. */
export function toCreateBody(values: ReportValues) {
  return {
    title: values.title,
    description: values.description,
    category: values.category,
    year: values.year,
    filePath: values.filePath,
    fileSize: values.fileSize === "" ? null : Number(values.fileSize),
  };
}

/** The body of `PUT`: the metadata only. A report's file cannot be replaced (the legacy rule). */
export function toUpdateBody(values: ReportValues) {
  return { title: values.title, description: values.description, category: values.category, year: values.year };
}

/** For the error summary: the field names the Worker reports, in the legacy labels. */
export const FIELD_LABELS: Record<string, string> = {
  title: "Judul",
  description: "Deskripsi",
  category: "Kategori",
  year: "Tahun",
  filePath: "File PDF",
  fileSize: "File PDF",
};
