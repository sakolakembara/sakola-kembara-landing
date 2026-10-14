import { validateStep, type StepValues } from "../../shared/application-form/rules";
import { missingFilesMessage, missingSlots, missingSlotsOfStep, type SlotId } from "../../shared/application-form/slots";
import { STEP_IDS, STEP_NOT_SAVED_MESSAGE, type StepId } from "../../shared/application-form/steps";
import type { ApplicationStatus, DraftFormData } from "../db/schema";

// The rules of the student's application API (docs/cloudflare/portal-api.md, sections 5, 6, 9 and 10), as plain
// functions: no D1, no Hono, no clock of their own (a caller passes `now`). Everything here is decided from values the
// route already read, so each rule can be tested without a request and the route stays a short sequence of them.
//
// Where the rules are the legacy app's (app/(portal)/portal/**, lib/admission-batches.ts, lib/student-applications.ts)
// the comment says so; where the contract settled a choice the legacy left open, the section is named.

// ─── The messages (legacy wording; docs/cloudflare/portal-api.md, section 13) ───

export const MESSAGES = {
  noOpenBatch: "Belum ada batch pendaftaran yang dibuka. Silakan kembali saat pendaftaran berikutnya diumumkan.",
  batchClosed: "Pendaftaran untuk batch ini sudah ditutup. Isianmu tidak bisa disimpan atau dikirim.",
  alreadySubmitted: "Kamu sudah mengirim pendaftaran untuk batch ini. Cek status di halaman Portal Siswa.",
  noDraft: "Belum ada isian yang tersimpan. Isi formulir pendaftaran dulu.",
  duplicateWhatsapp: "Pendaftaran dari nomor WhatsApp ini baru saja dikirim. Mohon tunggu sebelum mencoba lagi.",
  draftChanged: "Isianmu berubah saat dikirim. Periksa lagi lalu kirim ulang.",
  verifyBeforeSubmit: "Verifikasi email kamu dulu sebelum mengirim pendaftaran.",
} as const;

// ─── The open batch and the gate (6.2) ───

/** The batch that is open now, as the routes use it. Dates are `Date`s; `present.ts` turns them into ISO strings. */
export interface OpenBatch {
  id: string;
  year: number;
  name: string;
  description: string | null;
  opensAt: Date;
  closesAt: Date;
}

/** The student's side of the open batch: the application they sent, and the draft they have (the answers only when the route asked for them). */
export interface OpenState {
  batch: OpenBatch;
  application: { id: string; submittedAt: Date } | null;
  draft: { id: string; updatedAt: Date; lastStep: StepId | null; formData: DraftFormData | null } | null;
}

export type Gate = "open" | "submitted" | "no_open_batch";

/** `open`: a batch is open and the student has no application for it. `submitted`: they have. `no_open_batch`: nothing is open. */
export function gateOf(state: OpenState | null): Gate {
  if (state === null) return "no_open_batch";
  return state.application === null ? "open" : "submitted";
}

export type WriteRefusalCode = "no_open_batch" | "batch_closed" | "already_submitted";

export interface WriteRefusal {
  error: WriteRefusalCode;
  message: string;
}

/**
 * Why a write (a step save, the submit) is refused, or null when it may go on. `hasOtherDraft`: the student still has a
 * draft although no batch is open now, which is a draft whose batch closed after they started: that is `batch_closed`
 * ("Isianmu tidak bisa disimpan atau dikirim"), not `no_open_batch` (6.2, last row).
 */
export function writeRefusal(state: OpenState | null, hasOtherDraft: boolean): WriteRefusal | null {
  switch (gateOf(state)) {
    case "open":
      return null;
    case "submitted":
      return { error: "already_submitted", message: MESSAGES.alreadySubmitted };
    case "no_open_batch":
      return hasOtherDraft ? { error: "batch_closed", message: MESSAGES.batchClosed } : { error: "no_open_batch", message: MESSAGES.noOpenBatch };
  }
}

// ─── Words about the student ───

/** The first word of the name; "Sakemers" when there is none (legacy: `student.name?.split(" ")[0] ?? "Sakemers"`, which let an empty name through as an empty greeting). */
export function firstNameOf(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first ? first : "Sakemers";
}

// ─── The draft (5.1) ───

/** The buckets a draft holds, in the API's order (`STEP_IDS`), whatever order they were saved in. Anything that is not one of the seven is ignored. */
export function savedStepsOf(formData: DraftFormData | null | undefined): StepId[] {
  if (!formData) return [];
  return STEP_IDS.filter((step) => formData[step] !== undefined);
}

/** `draft.steps` of the answer: only the saved buckets, exactly as stored, in the API's order. */
export function stepsOf(formData: DraftFormData | null | undefined): DraftFormData {
  const steps: DraftFormData = {};
  for (const step of savedStepsOf(formData)) steps[step] = formData![step]!;
  return steps;
}

/** Did the student say they are registered in DTKS? Only the stored "ya" counts: the `dtks` slot is required then. */
export function dtksRegisteredIn(formData: DraftFormData | null | undefined): boolean {
  return formData?.documents?.dtksRegistered === "ya";
}

/** The required slots that have no file, in the slots' order (`missingFiles` of the draft). */
export function missingFilesOf(counts: Readonly<Record<string, number>>, dtksRegistered: boolean): SlotId[] {
  return missingSlots(counts, dtksRegistered);
}

/** How many live files each slot holds, from the rows of the files (or from `[slot, n]` pairs of a count query). */
export function countBySlot(files: readonly { slot: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of files) counts[file.slot] = (counts[file.slot] ?? 0) + 1;
  return counts;
}

// ─── The key of an object in the private bucket (portal-architecture.md, 8.1) ───

const EXTENSION_OF_CONTENT_TYPE: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" };

/**
 * `applications/<batch year>/<application id>/<file id>.<ext>`: no part of it comes from the client (the year is the
 * batch's, both ids are made by the server, the extension is from the SNIFFED type). Null for a type nothing stores.
 * The routes that store files (src/portal/files.ts) build the same key; this copy is only used to delete the
 * `dtks` objects when the student says they are not in DTKS (`PUT steps/documents`).
 */
export function applicationFileKey(file: { year: number; applicationId: string; fileId: string; contentType: string }): string | null {
  const extension = EXTENSION_OF_CONTENT_TYPE[file.contentType];
  return extension ? `applications/${file.year}/${file.applicationId}/${file.fileId}.${extension}` : null;
}

// ─── The status of an application and the privacy contract (10) ───

export type StatusResult =
  | { state: "processing" }
  | { state: "awaiting_decision"; announcedAt: string }
  | { state: "decided"; decision: "accepted" | "rejected"; announcedAt: string; notes: string | null };

export interface ResultRow {
  /** What the row's status is, as far as the query chose to hand it over (null before the batch is published). */
  status: ApplicationStatus | null;
  reviewNotes: string | null;
  /** The batch's `results_published_at`. */
  publishedAt: Date | null;
}

/**
 * What a student may know about one application. The promise of docs/architecture/student-portal.md: a verdict is
 * visible only after the batch's results are published, even when an admin has already set the status; before it the
 * answer is `processing` and nothing else, whatever the status and the note say. This is the ONE place that decides.
 * (The query that feeds it does not even select the status or the note of an unpublished batch: queries.ts.)
 */
export function resultOf(row: ResultRow): StatusResult {
  if (row.publishedAt === null) return { state: "processing" };
  const announcedAt = row.publishedAt.toISOString();
  if (row.status === "accepted" || row.status === "rejected") {
    const notes = row.reviewNotes?.trim();
    return { state: "decided", decision: row.status, announcedAt, notes: notes ? notes : null };
  }
  // Published, but the application is still pending or under review: the admin's publish guard should make this
  // impossible; a manual database write could. The legacy page says so.
  return { state: "awaiting_decision", announcedAt };
}

// ─── The submit (9) ───

/** The legacy soft anti-duplicate: no application with the same WhatsApp number in the last hour. */
export const DUPLICATE_WINDOW_MS = 60 * 60 * 1000;

export type SubmitCheck =
  | { ok: true; values: StepValues }
  | {
      ok: false;
      step: StepId;
      message: string;
      /** The first failing field of a bucket that no longer passes. */
      fields?: Record<string, string>;
      /** The required slots with no file, when the bucket passes and its files are what is missing. */
      missingFiles?: SlotId[];
    };

/**
 * Check 5 and 5b of the submit (9.1), in the legacy order: identity, household, housing, organizations, documents,
 * marketing, interview. Each bucket must be present (a bucket never saved is the legacy "belum lengkap" line) and must
 * pass its rules again; after `documents` passes its required files must be there, and after `marketing` passes its
 * proofs must be. The first failure answers. `counts` is how many live files each slot holds.
 */
export function checkSubmission(formData: DraftFormData, counts: Readonly<Record<string, number>>): SubmitCheck {
  const values: Partial<StepValues> = {};
  for (const step of STEP_IDS) {
    const bucket = formData[step];
    if (bucket === undefined) return { ok: false, step, message: STEP_NOT_SAVED_MESSAGE[step] };
    const result = validateStep(step, bucket);
    if (!result.ok) {
      const first = Object.entries(result.fields)[0];
      return { ok: false, step, message: result.message, fields: first ? { [first[0]]: first[1] } : {} };
    }
    (values as Record<StepId, unknown>)[step] = result.value;
    if (step === "documents" || step === "marketing") {
      const missing = missingSlotsOfStep(step, counts, values.documents?.dtksRegistered === "ya");
      // The sentence of the contract, from the shared module so the wizard and the server say the same thing.
      if (missing.length > 0) return { ok: false, step, message: missingFilesMessage(missing), missingFiles: missing };
    }
  }
  return { ok: true, values: values as StepValues };
}

