import type { DraftFormData } from "../db/schema";
import { firstNameOf, resultOf, type Gate, type OpenBatch, type OpenState, type ResultRow, type StatusResult } from "./rules";
import { SLOT_IDS, type SlotId } from "../../shared/application-form/slots";
import type { StepId } from "../../shared/application-form/steps";

// What the student's application API sends, as explicit field lists (docs/cloudflare/portal-api.md, sections 4, 5, 8
// and 10). Every object is built key by key from values the route chose: a row of D1 is never serialized as it is, so a
// column added to a table tomorrow (a note, a reviewer, an account id) cannot start to leak, and a test pins the exact
// key set of every answer. Dates go out as ISO 8601 strings in UTC.

const iso = (date: Date) => date.toISOString();

/** The open batch: the admin's name and description of it and its window. Nothing else of the row. */
export function presentOpenBatch(batch: OpenBatch) {
  return {
    id: batch.id,
    year: batch.year,
    name: batch.name,
    description: batch.description,
    opensAt: iso(batch.opensAt),
    closesAt: iso(batch.closesAt),
  };
}

/** `current` of the overview: the student's side of the open batch. */
export function presentCurrentState(state: OpenState | null) {
  if (state?.application) return { state: "submitted" as const, submittedAt: iso(state.application.submittedAt) };
  if (state?.draft) return { state: "draft" as const, updatedAt: iso(state.draft.updatedAt) };
  return { state: "none" as const };
}

export interface HistoryRow {
  id: string;
  year: number;
  name: string;
  submittedAt: Date;
  publishedAt: Date | null;
}

/** `GET /portal/api/overview` (4.3). The history is verdict-free: `published` only says the results are out. */
export function presentOverview(input: { now: Date; name: string; state: OpenState | null; history: readonly HistoryRow[] }) {
  return {
    now: iso(input.now),
    student: { name: input.name, firstName: firstNameOf(input.name) },
    openBatch: input.state ? presentOpenBatch(input.state.batch) : null,
    current: presentCurrentState(input.state),
    history: input.history.map((row) => ({
      id: row.id,
      batch: { year: row.year, name: row.name },
      submittedAt: iso(row.submittedAt),
      published: row.publishedAt !== null,
    })),
  };
}

export interface FileRow {
  id: string;
  slot: SlotId;
  contentType: string;
  size: number;
  width: number | null;
  height: number | null;
  createdAt: Date;
}

const SLOT_ORDER = new Map<string, number>(SLOT_IDS.map((id, index) => [id, index]));

/** One file of the list: its place in the form and what the wizard shows. No object key, no checksum, no file name (none is stored). */
export function presentFile(file: FileRow) {
  return {
    id: file.id,
    slot: file.slot,
    contentType: file.contentType,
    size: file.size,
    width: file.width,
    height: file.height,
    uploadedAt: iso(file.createdAt),
  };
}

/** The files in the order of the form's slots, oldest first within a slot (the id breaks a tie, so the order is the same on every read). */
export function presentFiles(files: readonly FileRow[]) {
  return [...files]
    .sort((a, b) => (SLOT_ORDER.get(a.slot) ?? 0) - (SLOT_ORDER.get(b.slot) ?? 0) || a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1))
    .map(presentFile);
}

/** `GET /portal/api/applications/current` (5.1). */
export function presentCurrent(input: {
  now: Date;
  gate: Gate;
  state: OpenState | null;
  user: { name: string; email: string };
  steps: DraftFormData;
  saved: readonly StepId[];
  missingFiles: readonly SlotId[];
  files: readonly FileRow[];
}) {
  const { state, gate } = input;
  const draft = gate === "open" && state?.draft ? state.draft : null;
  return {
    now: iso(input.now),
    gate,
    batch: state ? presentOpenBatch(state.batch) : null,
    application: gate === "submitted" && state?.application ? { id: state.application.id, submittedAt: iso(state.application.submittedAt) } : null,
    user: { name: input.user.name, email: input.user.email },
    draft: draft ? { id: draft.id, updatedAt: iso(draft.updatedAt), lastStep: draft.lastStep, steps: input.steps, saved: [...input.saved], missingFiles: [...input.missingFiles] } : null,
    files: gate === "no_open_batch" ? [] : presentFiles(input.files),
  };
}

/** The `draft` of a step save's answer (8.1): the id, the version, the buckets it holds and the required files it still lacks. */
export function presentSavedDraft(draft: { id: string; updatedAt: Date }, saved: readonly StepId[], missingFiles: readonly SlotId[]) {
  return { id: draft.id, updatedAt: iso(draft.updatedAt), saved: [...saved], missingFiles: [...missingFiles] };
}

export interface StatusRow extends ResultRow {
  id: string;
  batchId: string;
  year: number;
  name: string;
  submittedAt: Date;
}

/** One item of `GET /portal/api/applications` (10.1): the batch, when it was sent, and `result`, which `resultOf` alone decides. */
export function presentStatusItem(row: StatusRow): { id: string; batch: { id: string; year: number; name: string }; submittedAt: string; result: StatusResult } {
  return {
    id: row.id,
    batch: { id: row.batchId, year: row.year, name: row.name },
    submittedAt: iso(row.submittedAt),
    result: resultOf({ status: row.status, reviewNotes: row.reviewNotes, publishedAt: row.publishedAt }),
  };
}
