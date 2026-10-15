// Relative imports on purpose: see pages/batches/model.ts.
import type { SlotId } from "../../../../shared/application-form/slots";
import type { ListSpec } from "../../lib/crud/query";
import type { Tone } from "../batches/model";

// What the Pendaftar screens share: the types of the API, the labels, the list's spec and the rules of the review.
// A port of app/(admin)/admin/applications/* and lib/application-status.ts; the API is src/api/applications.ts
// (docs/cloudflare/admin-pendaftaran.md).

export const API_PATH = "/api/admin/applications";
export const ROUTE = "/applications";

export type ApplicationStatus = "pending" | "under_review" | "accepted" | "rejected";
export const STATUSES: readonly ApplicationStatus[] = ["pending", "under_review", "accepted", "rejected"];

/** How an application status reads in the admin (lists, detail): the legacy `lib/application-status.ts`. */
export const APPLICATION_STATUS: Record<ApplicationStatus, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "amber" },
  under_review: { label: "Dalam Review", tone: "blue" },
  accepted: { label: "Diterima", tone: "green" },
  rejected: { label: "Ditolak", tone: "red" },
};

/** Shortest reason for revoking an acceptance: the Worker's `REVOCATION_NOTES_MIN` (a test keeps the two equal). */
export const REVOCATION_NOTES_MIN = 20;

export interface BatchRef {
  id: string;
  year: number;
  name: string;
}

/** A row of the list: no answers, no notes, no phone number. */
export interface ApplicationListed {
  id: string;
  fullName: string;
  email: string;
  schoolName: string;
  graduationYear: string;
  branchPreference: string | null;
  status: ApplicationStatus;
  submittedAt: string;
  updatedAt: string;
  batch: BatchRef;
}

/** `GET /:id` and the answer of the review. `formData` is whatever the wizard stored: read it with `profileSections`, never assume its shape. */
export interface ApplicationDetail {
  id: string;
  batch: BatchRef;
  fullName: string;
  email: string;
  whatsapp: string;
  schoolName: string;
  graduationYear: string;
  branchPreference: string | null;
  motivation: string | null;
  economicBackground: string | null;
  formData: unknown;
  status: ApplicationStatus;
  reviewNotes: string | null;
  reviewedAt: string | null;
  submittedAt: string;
  updatedAt: string;
}

/** A file an applicant uploaded, as the detail lists it (docs/cloudflare/portal-api.md, 12.1): metadata only, no key, no name. */
export interface ApplicationFile {
  id: string;
  slot: SlotId;
  contentType: string;
  size: number;
  /** Pixels; null for a PDF. */
  width: number | null;
  height: number | null;
  uploadedAt: string;
}

/**
 * `GET /:id` (the answer of the review has none of these three, and the page keeps what it had): the version of the
 * answers, the files and whether this person may open them. A viewer sees the list and `canOpenFiles` is false: opening
 * a file, and purging them, need `pendaftaran` write (Dzul, 2026-10-13).
 */
export interface ApplicationWithFiles extends ApplicationDetail {
  /** `2` the legacy links, `3` uploads; null when there are no answers. */
  formVersion: 2 | 3 | null;
  files: ApplicationFile[];
  canOpenFiles: boolean;
}

/** Opening one file (a new tab): the Worker audits every open. */
export const filePath = (applicationId: string, fileId: string) => `${API_PATH}/${encodeURIComponent(applicationId)}/files/${encodeURIComponent(fileId)}`;

/** The manual purge of an application's files: `POST` with `{ "confirm": true }`. */
export const purgePath = (applicationId: string) => `${API_PATH}/${encodeURIComponent(applicationId)}/files/purge`;

// ─── Drafts that hold files (SAKEM-093) ──────────────────────────────────────────

/** The screen of the drafts that were never submitted and still hold files: a tab of Pendaftar, for who may purge them. */
export const DRAFTS_ROUTE = `${ROUTE}/drafts`;

/** `GET`: the drafts that hold files (docs/cloudflare/portal-api.md, 12.4). Below `/drafts`, not `/:id`: a draft is not an application. */
export const DRAFT_FILES_PATH = `${API_PATH}/drafts/files`;

/** The manual purge of a draft's files: `POST` with `{ "confirm": true }`. */
export const draftPurgePath = (draftId: string) => `${API_PATH}/drafts/${encodeURIComponent(draftId)}/files/purge`;

/**
 * How long a draft must have gone without a change before its files may be purged: the Worker's `DRAFT_PURGE_MIN_INACTIVE_DAYS`
 * (a test keeps the two equal). The Worker decides; this is only the number the screen says.
 */
export const DRAFT_PURGE_MIN_DAYS = 30;

/**
 * A row of the list of drafts: opaque and light on personal data on purpose. No name, no email, no answer, no slot, no file name:
 * only the draft's id (the screen shows its first eight characters), its batch, how many live files it holds and how big they
 * are, when it last changed, and whether it may be purged now (the Worker's clock) and from when.
 */
export interface DraftFilesRow {
  id: string;
  batch: BatchRef;
  files: number;
  bytes: number;
  updatedAt: string;
  purgeable: boolean;
  /** `updatedAt` plus the 30 days: from this instant the purge is allowed. */
  purgeableAt: string;
}

/** What the list of drafts offers: pages only (no search, no filters, no sort: oldest change first, as the Worker answers). */
export const DRAFTS_LIST_SPEC: ListSpec = { pageSize: 20 };

/** The short id a row shows: the first eight characters of the draft's id. */
export const shortDraftId = (draftId: string) => draftId.slice(0, 8);

/**
 * What the list offers: the same names as the Worker's filters and sorts (src/api/applications.ts). The search is
 * a PREFIX of a name or an email (`q`), and `batch` is a batch id or `all`.
 */
export const LIST_SPEC: ListSpec = {
  filters: ["batch", "status"],
  sorts: ["submittedAt", "fullName"],
  defaultSort: "-submittedAt",
};

/** The batch filter's value for "every batch": the address says it, so the list can tell it from "no choice yet" (which opens the newest batch). */
export const ALL_BATCHES = "all";

/** The newest batch: the first of a list sorted by year, newest first (`GET /api/admin/batches?sort=-year`). */
export function newestBatch<T extends { id: string }>(batches: readonly T[]): T | null {
  return batches[0] ?? null;
}

/**
 * Where the list opens when the address names no batch, no status and no search: the newest batch (decided in
 * docs/cloudflare/admin-ia.md, question 8). A link that names a status without a batch (the dashboard's tiles
 * count every batch) means every batch, so it is left as it is.
 */
export function needsDefaultBatch(params: URLSearchParams): boolean {
  return !params.has("batch") && !params.get("status") && !params.get("q");
}

/** The status select of the review: the legacy `Ubah Status` options. */
export const STATUS_OPTIONS = STATUSES.map((value) => ({ value, label: APPLICATION_STATUS[value].label }));

export function isRevocation(current: ApplicationStatus, selected: ApplicationStatus): boolean {
  return current === "accepted" && selected === "rejected";
}

/** For the error summary of the review: the Worker's field names. */
export const REVIEW_FIELD_LABELS: Record<string, string> = { status: "Status baru", reviewNotes: "Catatan Review" };
