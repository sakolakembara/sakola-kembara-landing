// What the wizard asks of the Worker and how it reads the answers (docs/cloudflare/portal-api.md, sections 5, 8, 9 and 13):
//
//   GET  /portal/api/applications/current          the bootstrap: the gate, the batch, the draft and its files
//   PUT  /portal/api/applications/current/steps/:step     one complete, valid bucket
//   POST /portal/api/applications/current/submit          the whole application
//
// The parsers are pure (no DOM, no React) and read ONLY what the wizard uses, so a body that does not have the shape is
// `null` (an error screen) and never a form full of blanks. They import with relative paths, like `lib/files`, so a Worker
// contract test can run them against the real routes.
//
// `api()` keeps `status`, `code`, `message`, `fields` and `retryAfter` of an error and drops the rest of its body (`step`,
// `missingFiles`, `max`): the wizard does not need them, because it validates every bucket and counts the files itself
// before it asks, so it can tell which screen a refusal belongs to.

import { type ApiFailure, type ApiResult, api } from "../../../../shared/spa/api";
import { NETWORK_ERROR } from "../../../../shared/spa/auth-errors";
import { formatWait } from "../../../../shared/spa/format";
import { INVALID_FORM_MESSAGE } from "../../../../shared/application-form/rules";
import { isSlotId, type SlotId } from "../../../../shared/application-form/slots";
import { isStepId, STEP_IDS, type StepId } from "../../../../shared/application-form/steps";
import { parseStoredFile, type StoredFile } from "../files/types";
import { API } from "../paths";

export const CURRENT_PATH = `${API}/applications/current`;
export const stepPath = (step: StepId) => `${CURRENT_PATH}/steps/${step}`;
export const SUBMIT_PATH = `${CURRENT_PATH}/submit`;

// ─── What `GET applications/current` answers ──────────────────────────────

export interface WizardBatch {
  id: string;
  year: number;
  name: string;
  description: string | null;
  opensAt: string;
  closesAt: string;
}

/** The draft the server holds: the complete, valid buckets the student has saved. */
export interface ServerDraft {
  id: string;
  updatedAt: string;
  lastStep: StepId | null;
  /** Each bucket exactly as stored (the validated input); unknown buckets are dropped. */
  steps: Partial<Record<StepId, unknown>>;
  saved: StepId[];
  missingFiles: SlotId[];
}

export type Gate = "open" | "no_open_batch" | "submitted";

export interface CurrentAnswer {
  /** The server's clock: the local copy's age is compared against it, not against the phone's own (they can differ by minutes). */
  now: string;
  gate: Gate;
  batch: WizardBatch | null;
  application: { id: string; submittedAt: string } | null;
  user: { name: string };
  draft: ServerDraft | null;
  files: StoredFile[];
}

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Obj) : null);
const isoDate = (value: unknown): string | null => (typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null);

function parseBatch(raw: unknown): WizardBatch | null {
  const batch = obj(raw);
  if (!batch) return null;
  const opensAt = isoDate(batch.opensAt);
  const closesAt = isoDate(batch.closesAt);
  if (typeof batch.id !== "string" || typeof batch.year !== "number" || typeof batch.name !== "string" || !opensAt || !closesAt) return null;
  const description = typeof batch.description === "string" && batch.description.trim() !== "" ? batch.description : null;
  return { id: batch.id, year: batch.year, name: batch.name, description, opensAt, closesAt };
}

function parseDraft(raw: unknown): ServerDraft | null {
  const draft = obj(raw);
  const stored = obj(draft?.steps);
  const updatedAt = isoDate(draft?.updatedAt);
  if (!draft || !stored || !updatedAt || typeof draft.id !== "string") return null;
  const steps: Partial<Record<StepId, unknown>> = {};
  for (const step of STEP_IDS) if (obj(stored[step])) steps[step] = stored[step];
  return {
    id: draft.id,
    updatedAt,
    lastStep: isStepId(draft.lastStep) ? draft.lastStep : null,
    steps,
    saved: Array.isArray(draft.saved) ? draft.saved.filter(isStepId) : [],
    missingFiles: Array.isArray(draft.missingFiles) ? draft.missingFiles.filter(isSlotId) : [],
  };
}

function parseFiles(raw: unknown): StoredFile[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseStoredFile).filter((file): file is StoredFile => file !== null);
}

/** `GET /portal/api/applications/current`. `null` when the body is not what the wizard can run on. */
export function parseCurrent(raw: unknown): CurrentAnswer | null {
  const body = obj(raw);
  const now = isoDate(body?.now);
  const user = obj(body?.user);
  if (!body || !now || !user) return null;
  const gate = body.gate;
  if (gate !== "open" && gate !== "no_open_batch" && gate !== "submitted") return null;

  const batch = body.batch === null || body.batch === undefined ? null : parseBatch(body.batch);
  if (body.batch !== null && body.batch !== undefined && !batch) return null;
  // An open batch is the whole point of an open gate.
  if (gate === "open" && !batch) return null;

  let application: CurrentAnswer["application"] = null;
  if (gate === "submitted") {
    const sent = obj(body.application);
    const submittedAt = isoDate(sent?.submittedAt);
    if (!sent || typeof sent.id !== "string" || !submittedAt) return null;
    application = { id: sent.id, submittedAt };
  }

  let draft: ServerDraft | null = null;
  if (body.draft !== null && body.draft !== undefined) {
    draft = parseDraft(body.draft);
    if (!draft) return null;
  }
  return { now, gate, batch, application, user: { name: typeof user.name === "string" ? user.name : "" }, draft, files: parseFiles(body.files) };
}

// ─── What a step save and the submit answer ───────────────────────────────

export interface StepSaved {
  step: StepId;
  savedAt: string;
  draft: { id: string; updatedAt: string; saved: StepId[]; missingFiles: SlotId[] };
  /** The slots whose files the server removed along with the save (the `dtks` file when DTKS turns "tidak"). */
  removedSlots: SlotId[];
}

/** `200` of `PUT .../steps/:step`. */
export function parseStepSaved(raw: unknown): StepSaved | null {
  const body = obj(raw);
  const draft = obj(body?.draft);
  const savedAt = isoDate(body?.savedAt);
  const updatedAt = isoDate(draft?.updatedAt);
  if (!body || !draft || !savedAt || !updatedAt || !isStepId(body.step) || typeof draft.id !== "string") return null;
  return {
    step: body.step,
    savedAt,
    draft: {
      id: draft.id,
      updatedAt,
      saved: Array.isArray(draft.saved) ? draft.saved.filter(isStepId) : [],
      missingFiles: Array.isArray(draft.missingFiles) ? draft.missingFiles.filter(isSlotId) : [],
    },
    removedSlots: Array.isArray(body.removedSlots) ? body.removedSlots.filter(isSlotId) : [],
  };
}

export interface Submitted {
  applicationId: string;
  submittedAt: string;
}

/** `201` of `POST .../submit`. */
export function parseSubmitted(raw: unknown): Submitted | null {
  const body = obj(raw);
  const submittedAt = isoDate(body?.submittedAt);
  if (!body || typeof body.applicationId !== "string" || !submittedAt) return null;
  return { applicationId: body.applicationId, submittedAt };
}

// ─── Refusals, in Indonesian ───────────────────────────────────────────────

/** The three 409 states of the gate (docs/cloudflare/portal-api.md, 6.2): the batch is not open, has closed, or the application is already sent. */
export type GateError = "no_open_batch" | "batch_closed" | "already_submitted";

/** The Worker's own sentences (portal-api.md, section 13), used when an answer arrives without its `message`. */
export const GATE_MESSAGES: Record<GateError, string> = {
  no_open_batch: "Belum ada batch pendaftaran yang dibuka. Silakan kembali saat pendaftaran berikutnya diumumkan.",
  batch_closed: "Pendaftaran untuk batch ini sudah ditutup. Isianmu tidak bisa disimpan atau dikirim.",
  already_submitted: "Kamu sudah mengirim pendaftaran untuk batch ini. Cek status di halaman Portal Siswa.",
};

export const WIZARD_MESSAGES = {
  server: "Terjadi kesalahan di server. Coba lagi sebentar lagi.",
  badAnswer: "Jawaban server tidak bisa dibaca. Coba lagi.",
} as const;

const isGateError = (code: string | undefined): code is GateError => code === "no_open_batch" || code === "batch_closed" || code === "already_submitted";

/** What a failed call comes to, for the wizard to act on. */
export type Outcome<T> =
  | { kind: "ok"; data: T }
  /** 401: the session is gone. The shell sends the student to sign in and wipes the local copy. */
  | { kind: "unauthorized" }
  /** 409 `no_open_batch`, `batch_closed`, `already_submitted`: the application cannot be saved or sent any more. */
  | { kind: "gate"; gate: GateError; message: string }
  /** 400 `invalid`: the Worker refused fields (the wizard's own rules should have caught them first). `fields` is keyed by the path in the bucket. */
  | { kind: "invalid"; fields: Record<string, string>; message: string }
  /** Anything else: offline, a limiter, a 5xx, `incomplete`, `duplicate_whatsapp`, `draft_changed`. `message` is ready to show. */
  | { kind: "failed"; status: number; code?: string; message: string };

/** The sentence for a failure that has no screen of its own: the Worker's, when it sent one, else the SPA's. */
export function failureMessage(failure: Pick<ApiFailure, "status" | "message" | "retryAfter">): string {
  if (failure.status === 0) return NETWORK_ERROR;
  if (failure.message) return failure.message;
  if (failure.status === 429) return `Terlalu banyak percobaan. Coba lagi dalam ${formatWait(failure.retryAfter ?? 60)}.`;
  return WIZARD_MESSAGES.server;
}

export function classify(failure: ApiFailure): Exclude<Outcome<never>, { kind: "ok" }> {
  if (failure.status === 401) return { kind: "unauthorized" };
  if (failure.status === 409 && isGateError(failure.code)) return { kind: "gate", gate: failure.code, message: failure.message ?? GATE_MESSAGES[failure.code] };
  if (failure.status === 400 && failure.code === "invalid") return { kind: "invalid", fields: failure.fields ?? {}, message: failure.message ?? INVALID_FORM_MESSAGE };
  return { kind: "failed", status: failure.status, code: failure.code, message: failureMessage(failure) };
}

function settle<T>(result: ApiResult<unknown>, parse: (raw: unknown) => T | null): Outcome<T> {
  if (!result.ok) return classify(result);
  const data = parse(result.data);
  return data === null ? { kind: "failed", status: 200, message: WIZARD_MESSAGES.badAnswer } : { kind: "ok", data };
}

/** `PUT .../steps/:step` with the validated bucket (a body the Worker will store as it is). */
export async function putStep(step: StepId, body: unknown): Promise<Outcome<StepSaved>> {
  return settle(await api<unknown>(stepPath(step), { method: "PUT", json: body }), parseStepSaved);
}

/** `POST .../submit`. */
export async function postSubmit(): Promise<Outcome<Submitted>> {
  return settle(await api<unknown>(SUBMIT_PATH, { method: "POST", json: {} }), parseSubmitted);
}

/** `GET .../current` again, after a refusal that says the server and the screen disagree. */
export async function getCurrent(): Promise<Outcome<CurrentAnswer>> {
  return settle(await api<unknown>(CURRENT_PATH), parseCurrent);
}
