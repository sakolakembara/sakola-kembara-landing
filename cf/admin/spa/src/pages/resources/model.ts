// Relative imports on purpose: see pages/batches/model.ts.
import type { ListSpec } from "../../lib/crud/query";
import type { Tone as TagTone } from "../batches/model";

// What the Pusat Dokumen screens share: the types of the API, the five categories and their labels, the three
// shapes of a row, the list's spec and the form's values. A port of app/(admin)/admin/resources/* and of
// lib/site-resources-config.ts (copied, not imported: that file reaches the legacy schema, which this build does
// not carry; test/pendaftaran-spa-contract.test.ts keeps the two lists equal to the Worker's).

export const API_PATH = "/api/admin/resources";
export const ROUTE = "/resources";

export const CATEGORIES = ["panduan", "berkas-pendaftaran", "berkas-marketing", "tutorial", "lainnya"] as const;
export type ResourceCategory = (typeof CATEGORIES)[number];

export const CONTENT_TYPES = ["file", "url", "text"] as const;
export type ResourceContentType = (typeof CONTENT_TYPES)[number];

export const CATEGORY_LABEL: Record<ResourceCategory, string> = {
  panduan: "Panduan Pendaftaran",
  "berkas-pendaftaran": "Berkas Pendaftaran",
  "berkas-marketing": "Berkas Marketing",
  tutorial: "Tutorial",
  lainnya: "Lainnya",
};

export const CATEGORY_DESCRIPTION: Record<ResourceCategory, string> = {
  panduan: "Panduan lengkap, poin-poin penting, dan alur pendaftaran Sakola Kembara.",
  "berkas-pendaftaran": "Template surat izin, surat penghasilan, SKTM, dan berkas lain yang perlu diunggah calon siswa.",
  "berkas-marketing": "Poster, twibbon, caption Instagram, dan bahan promosi lain yang wajib dibagikan calon siswa.",
  tutorial: "Video atau artikel pendek untuk membantu calon siswa menyiapkan berkas (mis. token listrik PLN).",
  lainnya: "Dokumen tambahan yang tidak masuk kategori di atas.",
};

export const CATEGORY_TONE: Record<ResourceCategory, TagTone> = {
  panduan: "blue",
  "berkas-pendaftaran": "green",
  "berkas-marketing": "purple",
  tutorial: "amber",
  lainnya: "gray",
};

export const CONTENT_TYPE_LABEL: Record<ResourceContentType, string> = {
  file: "File",
  url: "Link Eksternal",
  text: "Teks (dapat disalin)",
};

/** The three shapes of a row: what the type picker of the form says about each (the legacy words). */
export const CONTENT_TYPE_HELP: Record<ResourceContentType, { label: string; description: string }> = {
  file: { label: "File", description: "Upload file yang bisa diunduh oleh calon siswa." },
  url: { label: "Link Eksternal", description: "Tautan ke Google Drive, Canva, YouTube, dan sejenisnya." },
  text: { label: "Teks", description: "Snippet teks yang bisa disalin (mis. caption IG, template broadcast)." },
};

/** An item as the API answers it (`presentResource`). */
export interface ResourceItem {
  id: string;
  title: string;
  description: string | null;
  category: ResourceCategory;
  displayOrder: number;
  contentType: ResourceContentType;
  filePath: string | null;
  fileSize: number | null;
  externalUrl: string | null;
  bodyText: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * What the list offers: the same names as the Worker's filters and sorts (src/api/resources.ts). The default sort is
 * the page's own order (category, order, creation), and the whole catalog is one page of 100.
 */
export const LIST_SPEC: ListSpec = {
  filters: ["category", "contentType"],
  sorts: ["category", "title", "displayOrder", "updatedAt"],
  defaultSort: "category",
  pageSize: 100,
};

/** The rows of a page grouped by category, in the page's order; a category with nothing on this page is left out. */
export function groupByCategory(items: readonly ResourceItem[]): { category: ResourceCategory; items: ResourceItem[] }[] {
  const groups = CATEGORIES.map((category) => ({ category, items: items.filter((item) => item.category === category) }));
  return groups.filter((group) => group.items.length > 0);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ----------------------------------------------------------------------- the form

export interface ResourceValues extends Record<string, string> {
  title: string;
  description: string;
  category: ResourceCategory;
  displayOrder: string;
  contentType: ResourceContentType;
  /** The path an upload answered with ("" = none). */
  filePath: string;
  /** The size that upload answered with, in bytes ("" = none). */
  fileSize: string;
  externalUrl: string;
  bodyText: string;
  notes: string;
}

export function toValues(item: ResourceItem | null): ResourceValues {
  return {
    title: item?.title ?? "",
    description: item?.description ?? "",
    // The legacy form's starting points for a new row.
    category: item?.category ?? "berkas-pendaftaran",
    displayOrder: String(item?.displayOrder ?? 100),
    contentType: item?.contentType ?? "file",
    filePath: item?.filePath ?? "",
    fileSize: item?.fileSize === null || item?.fileSize === undefined ? "" : String(item.fileSize),
    externalUrl: item?.externalUrl ?? "",
    bodyText: item?.bodyText ?? "",
    notes: item?.notes ?? "",
  };
}

/**
 * The body of `POST` and `PUT`. All three shapes' fields are sent as typed: the Worker keeps the ones of the chosen
 * type and drops the others, so switching the type back and forth in the form loses nothing until it is saved.
 */
export function toBody(values: ResourceValues) {
  return {
    title: values.title,
    description: values.description,
    category: values.category,
    displayOrder: values.displayOrder.trim() === "" ? "" : Number(values.displayOrder),
    contentType: values.contentType,
    filePath: values.filePath || null,
    fileSize: values.fileSize === "" ? null : Number(values.fileSize),
    externalUrl: values.externalUrl,
    bodyText: values.bodyText,
    notes: values.notes,
  };
}

/** For the error summary: the field names the Worker reports, in the legacy labels. */
export const FIELD_LABELS: Record<string, string> = {
  title: "Judul",
  description: "Deskripsi",
  category: "Kategori",
  displayOrder: "Urutan Tampil",
  contentType: "Tipe Konten",
  filePath: "File",
  fileSize: "File",
  externalUrl: "URL",
  bodyText: "Teks",
  notes: "Catatan",
};
