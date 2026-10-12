// The imports of the three model files (batches, applications, resources) are RELATIVE and reach no component on
// purpose: test/pendaftaran-spa-contract.test.ts (the Worker's suite, which has no `~/` or `@/` alias) imports them
// to check the SPA against the real Worker.
import type { ListSpec } from "../../lib/crud/query";
import type { BatchPhase } from "../../lib/dashboard";

/** The tones of `Tag` (components/ui/tag.tsx) that the screens of this area use. */
export type Tone = "gray" | "green" | "amber" | "blue" | "soft" | "red" | "purple";

// What the batch screens share: the types of the API, the labels, the list's spec and the form's values.
// A port of app/(admin)/admin/batches/*; the API is src/api/batches.ts (docs/cloudflare/admin-pendaftaran.md).

/** The API collection and the SPA route of the menu. */
export const API_PATH = "/api/admin/batches";
export const ROUTE = "/batches";

export type ApplicationStatusKey = "pending" | "under_review" | "accepted" | "rejected";
/** The tiles of the detail, in the order of the legacy page. */
export const STATUS_KEYS: readonly ApplicationStatusKey[] = ["pending", "under_review", "accepted", "rejected"];

/** A batch as `GET /:id`, `POST` and `PUT` answer it (`presentBatch`). */
export interface BatchItem {
  id: string;
  year: number;
  name: string;
  description: string | null;
  opensAt: string;
  closesAt: string;
  resultsPublishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A row of the list: the batch, where it stands (worked out by the server) and how many applicants wait for a decision. */
export interface BatchListed extends BatchItem {
  phase: BatchPhase;
  pending: number;
  underReview: number;
}

export interface BatchCounts {
  pending: number;
  under_review: number;
  accepted: number;
  rejected: number;
  total: number;
}

export interface RecentApplicant {
  id: string;
  fullName: string;
  email: string;
  schoolName: string;
  status: ApplicationStatusKey;
  submittedAt: string;
}

/** `GET /:id` and the answer of publish and unpublish. */
export interface BatchDetail extends BatchItem {
  phase: BatchPhase;
  counts: BatchCounts;
  /** The server's reading of the publish rule; the button follows it, and the server checks again. */
  canPublish: boolean;
  recent: RecentApplicant[];
}

/**
 * The phases of a batch as a tag: the four of the legacy list ("Akan datang", "Buka", "Menunggu keputusan",
 * "Hasil dipublikasikan", with their tones) and the two the dashboard added (SAKEM-082): closed and every applicant
 * decided, and closed with nobody having applied.
 */
export const PHASE_STATUS: Record<BatchPhase, { label: string; tone: Tone }> = {
  upcoming: { label: "Akan datang", tone: "gray" },
  open: { label: "Buka", tone: "green" },
  awaiting_decisions: { label: "Menunggu keputusan", tone: "amber" },
  ready_to_publish: { label: "Siap dipublikasikan", tone: "blue" },
  closed_empty: { label: "Ditutup, tanpa pendaftar", tone: "gray" },
  published: { label: "Hasil dipublikasikan", tone: "soft" },
};

/** What the list offers: the same names as the Worker's sorts (src/api/batches.ts). It has no filters, only the search over the name. */
export const LIST_SPEC: ListSpec = {
  sorts: ["year", "opensAt", "name"],
  defaultSort: "-year",
};

export const DATE_MEDIUM: Intl.DateTimeFormatOptions = { dateStyle: "medium" };

export function formatPeriod(opensAt: string, closesAt: string): string {
  const fmt = (value: string) => new Date(value).toLocaleString("id-ID", DATE_MEDIUM);
  return `${fmt(opensAt)} — ${fmt(closesAt)}`;
}

// ----------------------------------------------------------------------- the form

export interface BatchValues extends Record<string, string> {
  year: string;
  name: string;
  description: string;
  opensAt: string;
  closesAt: string;
}

/** `<input type="datetime-local">` wants `YYYY-MM-DDTHH:mm` in local time. */
export function toLocalDatetime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** The inverse: a local date-time from the input to the ISO string the API takes; "" stays "" so the Worker says it is required. */
export function fromLocalDatetime(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  // An unreadable value goes through as typed, so the Worker answers "Format tanggal tidak valid".
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export function toValues(item: BatchItem | null, now = new Date()): BatchValues {
  return {
    // The legacy form suggested the next calendar year for a new batch.
    year: String(item?.year ?? now.getFullYear() + 1),
    name: item?.name ?? "",
    description: item?.description ?? "",
    opensAt: toLocalDatetime(item?.opensAt),
    closesAt: toLocalDatetime(item?.closesAt),
  };
}

/** The body of `POST` and `PUT`. The year goes as the digits typed: the Worker reads a number or the text of one. */
export function toBody(values: BatchValues) {
  return {
    year: values.year.trim() === "" ? "" : Number(values.year),
    name: values.name,
    description: values.description,
    opensAt: fromLocalDatetime(values.opensAt),
    closesAt: fromLocalDatetime(values.closesAt),
  };
}

/** For the error summary: the field names the Worker reports, in the legacy labels. */
export const FIELD_LABELS: Record<string, string> = {
  year: "Tahun angkatan",
  name: "Nama batch",
  description: "Deskripsi",
  opensAt: "Buka pendaftaran",
  closesAt: "Tutup pendaftaran",
};

/** The Pendaftar list filtered to a batch, and optionally a status: where the tiles and the counts lead. */
export function applicantsLink(batchId: string, status?: ApplicationStatusKey): string {
  return `/applications?batch=${encodeURIComponent(batchId)}${status ? `&status=${status}` : ""}`;
}
