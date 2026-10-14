// The draft the BROWSER keeps while a student fills in the wizard (docs/cloudflare/portal-architecture.md, 7.3): what is
// typed, even half typed, under a key that carries two ids and nothing else. Pure TypeScript, no dependency, no DOM:
// the wizard reads and writes `localStorage` itself and uses this file for the shape, the key and the rules about when a
// stored draft is not a draft at all.
//
// This is not the server's draft. The server keeps only a complete, valid step per bucket (`application_drafts`); this
// copy also holds the step being typed, which is why it is never sent anywhere and why it is wiped on sign-out, after a
// submit, when the API answers 401, `no_open_batch`, `batch_closed` or "already submitted", and once it is too old.

import { STEP_IDS, UI_STEP_ORDER, type StepId, type UiStepId } from "./steps";

/** Bump it when the shape below changes in a way an old copy cannot be read as; the key carries it too, so the old one is simply never read. */
export const LOCAL_DRAFT_VERSION = 1;

/** A local copy older than this is wiped on load (30 days; the architecture, 7.3). */
export const LOCAL_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The `localStorage` key: `sakem-portal:v1:<user id>:<batch id>`. The legacy key held the student's EMAIL; an id carries
 * no personal data. Both ids are UUIDs made by the server.
 */
export function localDraftKey(userId: string, batchId: string): string {
  return `sakem-portal:v${LOCAL_DRAFT_VERSION}:${userId}:${batchId}`;
}

export interface LocalDraft {
  version: typeof LOCAL_DRAFT_VERSION;
  /**
   * When this copy was last written, in epoch milliseconds (`Date.now()`). REQUIRED: a stored value without a finite,
   * positive number here is not a draft and is purged (it cannot be aged, so it could outlive the 30 days for ever).
   */
  savedAt: number;
  /** Index into `UI_STEP_ORDER` of the screen the student was on. */
  stepIndex: number;
  /** The screens the student has been to (the stepper marks them). */
  visited: UiStepId[];
  /**
   * The values of every bucket as typed, including the one being typed, keyed by bucket. NOT validated: what is half
   * typed stays here, and only a complete, valid step goes to the server (`PUT .../steps/:step`).
   */
  values: Partial<Record<StepId, Record<string, unknown>>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Is this parsed JSON a draft this version can read? (`savedAt` a finite positive number, a step index in range, known screens and buckets only.) */
export function isLocalDraft(value: unknown): value is LocalDraft {
  if (!isRecord(value)) return false;
  if (value.version !== LOCAL_DRAFT_VERSION) return false;
  if (typeof value.savedAt !== "number" || !Number.isFinite(value.savedAt) || value.savedAt <= 0) return false;
  if (typeof value.stepIndex !== "number" || !Number.isInteger(value.stepIndex) || value.stepIndex < 0 || value.stepIndex >= UI_STEP_ORDER.length) return false;
  if (!Array.isArray(value.visited) || !value.visited.every((screen) => (UI_STEP_ORDER as readonly unknown[]).includes(screen))) return false;
  if (!isRecord(value.values)) return false;
  return Object.entries(value.values).every(([bucket, typed]) => (STEP_IDS as readonly string[]).includes(bucket) && isRecord(typed));
}

/** Too old to keep: 30 days or more since it was written. A `savedAt` in the future (a clock that was wrong) is not old. */
export function isLocalDraftExpired(draft: Pick<LocalDraft, "savedAt">, now: number): boolean {
  return now - draft.savedAt >= LOCAL_DRAFT_MAX_AGE_MS;
}

/**
 * What to do with the text found under the key: the draft, or `null` when there is nothing to keep (no text, text that
 * is not JSON, a shape this version cannot read, a missing or non-numeric `savedAt`, or a draft that has expired). The
 * caller removes the key whenever it gets `null` for a text that was there.
 */
export function readLocalDraft(text: string | null | undefined, now: number): LocalDraft | null {
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isLocalDraft(parsed) || isLocalDraftExpired(parsed, now)) return null;
  return parsed;
}

/** The text to store: stamps `savedAt` with `now`. */
export function writeLocalDraft(draft: Omit<LocalDraft, "version" | "savedAt">, now: number): string {
  const stamped: LocalDraft = { ...draft, version: LOCAL_DRAFT_VERSION, savedAt: now };
  return JSON.stringify(stamped);
}
