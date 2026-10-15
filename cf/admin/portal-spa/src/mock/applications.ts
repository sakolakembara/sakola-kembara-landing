import { NETWORK_ERROR } from "@shared/spa/auth-errors";
import { INVALID_FORM_MESSAGE, validateStep } from "@shared/application-form/rules";
import { ALL_FILE_TYPES, missingFilesMessage, missingSlots, SLOTS, type SlotId } from "@shared/application-form/slots";
import { isStepId, STEP_IDS, STEP_NOT_SAVED_MESSAGE, type StepId } from "@shared/application-form/steps";
import { type FileUploader, type FileUploadRequest, setFileUploader } from "~/lib/files/client";
import type { StoredFile } from "~/lib/files/types";
import { CURRENT_PATH, GATE_MESSAGES, SUBMIT_PATH } from "~/lib/wizard/api";
import { mockOverview } from "./fixtures";
import type { Persona } from "./persona";

// MOCK, local development only (see mock/install.ts): the wizard's routes, in the shape the Worker answers them
// (docs/cloudflare/portal-api.md, sections 5, 8, 9 and 11), so every screen of the form can be worked on without a Worker.
// It keeps one student's draft, files and application IN MEMORY for the life of the page: a reload starts again from the persona.
//
// The rules are the REAL ones: a step is checked with `validateStep` of the shared module (the Worker's own function), the
// missing documents with its `missingSlots`, so the mock cannot drift from the Worker on what is valid. What it makes up is
// only the clock, the ids, and the files (the uploader below keeps no bytes).
//
// To see the refusals, type one of these words as the Nama Panggilan of the Identitas step (the first step saved with it):
//   offline      the save fails before an answer (network error)
//   dibatasi     rate limited, Retry-After 60 (429)
//   kedaluwarsa  the session is gone (401)
//   ditutup      the batch closed meanwhile (409 batch_closed)
//   kembar       the submit finds the same WhatsApp number sent a moment ago (409 duplicate_whatsapp)
//   berubah      the submit finds the draft changed (409 draft_changed)

const DAY = 24 * 60 * 60 * 1000;
const DRAFT_ID = "5f1d2c3b-0000-4000-8000-000000000002";

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function bodyOf(init: RequestInit): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(String(init.body ?? "{}"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** A complete, valid identity and household, invented, for the persona that already has a draft on the server. */
const SAVED = {
  identity: {
    fullName: "Sari Dewi",
    nickname: "Sari",
    gender: "perempuan",
    religion: "Islam",
    schoolName: "SMAN 1 Contoh",
    branch: "Bandung",
    homeAddress: "Jl. Contoh No. 1, RT 01/RW 02, Kel. Contoh, Kec. Contoh, Kota Bandung, Jawa Barat",
    graduationBatch: "2027 (Kelas 12)",
    whatsapp: "6281200000001",
  },
  household: {
    livingWith: ["Ayah", "Ibu"],
    fatherName: "Bapak Contoh",
    fatherOccupation: "Petani",
    fatherIncome: "1.200.000",
    motherName: "Ibu Contoh",
    motherOccupation: "Ibu rumah tangga",
    motherIncome: "0",
    hasOtherEarner1: false,
    hasOtherEarner2: false,
    familySize: 4,
  },
} as const;

interface MockState {
  draft: { updatedAt: number; lastStep: StepId | null; steps: Partial<Record<StepId, unknown>> } | null;
  files: StoredFile[];
  submitted: { id: string; submittedAt: string } | null;
  counter: number;
}

export interface MockApplications {
  /** Answers a route of the wizard, or `null` when the route is not one of its. */
  handle: (method: string, path: string, init: RequestInit) => Response | null;
  uploader: FileUploader;
}

/**
 * @param guard the transport's pipeline of a student data route (a session, then the role): a `Response` to refuse, or null.
 */
export function createMockApplications(persona: Persona, guard: () => Response | null, now: () => Date = () => new Date(), options: { uploadDelayMs?: number } = {}): MockApplications {
  const uploadDelayMs = options.uploadDelayMs ?? 150;
  const overview = () => mockOverview(persona, now());
  const batch = () => overview().openBatch;
  const unverified = persona === "unverified";

  const state: MockState = { draft: null, files: [], submitted: null, counter: 0 };
  if (persona === "draft") {
    state.draft = { updatedAt: now().getTime() - 2 * 60 * 60 * 1000, lastStep: "household", steps: {} };
    for (const step of ["identity", "household"] as const) {
      const checked = validateStep(step, SAVED[step]);
      if (checked.ok) state.draft.steps[step] = checked.value;
    }
    state.files = [file("family-card", "application/pdf", 812_345, null, null, state)];
  }
  if (persona === "submitted") state.submitted = { id: DRAFT_ID, submittedAt: new Date(now().getTime() - 3 * DAY).toISOString() };

  const saved = () => STEP_IDS.filter((step) => state.draft?.steps[step] !== undefined);
  const dtksYes = () => (state.draft?.steps.documents as { dtksRegistered?: string } | undefined)?.dtksRegistered === "ya";
  const counts = () => {
    const out: Record<string, number> = {};
    for (const stored of state.files) out[stored.slot] = (out[stored.slot] ?? 0) + 1;
    return out;
  };
  const missing = () => missingSlots(counts(), dtksYes());

  /** The gate every write passes (portal-api.md, 6.2): no batch, or the application already sent. */
  function gateRefusal(): Response | null {
    if (!batch()) return json({ error: "no_open_batch", message: GATE_MESSAGES.no_open_batch }, 409);
    if (state.submitted) return json({ error: "already_submitted", message: GATE_MESSAGES.already_submitted }, 409);
    return null;
  }

  function verifiedRefusal(short = false): Response | null {
    if (!unverified) return null;
    return json(
      { error: "email_not_verified", message: short ? "Verifikasi email kamu dulu sebelum mengirim pendaftaran." : "Verifikasi email kamu dulu sebelum melanjutkan. Cek inbox atau folder spam untuk tautan verifikasi." },
      403,
    );
  }

  function current(): Response {
    const open = batch();
    const gate = !open ? "no_open_batch" : state.submitted ? "submitted" : "open";
    return json({
      now: now().toISOString(),
      gate,
      batch: open,
      application: gate === "submitted" ? state.submitted : null,
      user: { name: "Sari Dewi", email: "sari@contoh.test" },
      draft:
        gate === "open" && state.draft
          ? { id: DRAFT_ID, updatedAt: new Date(state.draft.updatedAt).toISOString(), lastStep: state.draft.lastStep, steps: state.draft.steps, saved: saved(), missingFiles: missing() }
          : null,
      files: gate === "open" || gate === "submitted" ? state.files : [],
    });
  }

  function putStep(step: StepId, init: RequestInit): Response {
    const refused = verifiedRefusal() ?? gateRefusal();
    if (refused) return refused;
    const body = bodyOf(init);
    if (step === "identity") {
      // The refusals a form cannot be made to produce by typing ordinary answers.
      const word = typeof body.nickname === "string" ? body.nickname.trim().toLowerCase() : "";
      if (word === "offline") throw new TypeError("mock: network down");
      if (word === "dibatasi") return json({ error: "rate_limited", message: "Terlalu banyak percobaan. Silakan tunggu satu menit lalu coba lagi.", retryAfterSeconds: 60 }, 429, { "Retry-After": "60" });
      if (word === "kedaluwarsa") return json({ error: "unauthenticated" }, 401);
      if (word === "ditutup") return json({ error: "batch_closed", message: GATE_MESSAGES.batch_closed }, 409);
    }
    const checked = validateStep(step, body);
    if (!checked.ok) return json({ error: "invalid", message: INVALID_FORM_MESSAGE, fields: checked.fields }, 400);

    state.draft = { updatedAt: now().getTime(), lastStep: step, steps: { ...state.draft?.steps, [step]: checked.value } };
    let removedSlots: SlotId[] = [];
    if (step === "documents" && (checked.value as { dtksRegistered: string }).dtksRegistered === "tidak" && state.files.some((stored) => stored.slot === "dtks")) {
      state.files = state.files.filter((stored) => stored.slot !== "dtks");
      removedSlots = ["dtks"];
    }
    return json({ step, savedAt: new Date(state.draft.updatedAt).toISOString(), draft: { id: DRAFT_ID, updatedAt: new Date(state.draft.updatedAt).toISOString(), saved: saved(), missingFiles: missing() }, removedSlots });
  }

  function submit(): Response {
    const refused = verifiedRefusal(true) ?? gateRefusal();
    if (refused) return refused;
    if (!state.draft) return json({ error: "no_draft", message: "Belum ada isian yang tersimpan. Isi formulir pendaftaran dulu." }, 404);
    for (const step of STEP_IDS) {
      const stored = state.draft.steps[step];
      const checked = validateStep(step, stored);
      if (stored === undefined || !checked.ok) {
        const message = stored === undefined || checked.ok ? STEP_NOT_SAVED_MESSAGE[step] : checked.message;
        return json({ error: "incomplete", message, step }, 422);
      }
    }
    const lacking = missing();
    if (lacking.length > 0) {
      const step = lacking.some((slot) => SLOTS[slot].step === "documents") ? "documents" : "marketing";
      return json({ error: "incomplete", message: missingFilesMessage(lacking), step, missingFiles: lacking }, 422);
    }
    const word = String((state.draft.steps.identity as { nickname?: string } | undefined)?.nickname ?? "").toLowerCase();
    if (word === "kembar") return json({ error: "duplicate_whatsapp", message: "Pendaftaran dari nomor WhatsApp ini baru saja dikirim. Mohon tunggu sebelum mencoba lagi.", step: "identity" }, 409);
    if (word === "berubah") return json({ error: "draft_changed", message: "Isianmu berubah saat dikirim. Periksa lagi lalu kirim ulang." }, 409);

    const submittedAt = now().toISOString();
    state.submitted = { id: DRAFT_ID, submittedAt };
    state.draft = null;
    const open = batch();
    return json({ applicationId: DRAFT_ID, submittedAt, batch: open ? { id: open.id, year: open.year, name: open.name } : null }, 201);
  }

  const handle: MockApplications["handle"] = (method, path, init) => {
    if (method === "GET" && path === CURRENT_PATH) {
      const refused = guard();
      if (refused) return refused;
      return persona === "error" ? json({ error: "internal" }, 500) : current();
    }
    const step = method === "PUT" ? /^\/portal\/api\/applications\/current\/steps\/([a-z]+)$/.exec(path)?.[1] : undefined;
    if (step !== undefined) {
      const refused = guard();
      if (refused) return refused;
      return isStepId(step) ? putStep(step, init) : json({ error: "unknown_step" }, 404);
    }
    if (method === "POST" && path === SUBMIT_PATH) return guard() ?? submit();
    const fileId = method === "DELETE" ? /^\/portal\/api\/applications\/current\/files\/([^/]+)$/.exec(path)?.[1] : undefined;
    if (fileId !== undefined) {
      const refused = guard() ?? gateRefusal();
      if (refused) return refused;
      if (!state.files.some((stored) => stored.id === decodeURIComponent(fileId))) return json({ error: "not_found" }, 404);
      state.files = state.files.filter((stored) => stored.id !== decodeURIComponent(fileId));
      return json(null, 204);
    }
    return null;
  };

  /** Stands in for the XMLHttpRequest of an upload: it keeps no bytes, only what the answer says about them. */
  const uploader: FileUploader = async ({ slot, body, replace, onProgress, signal }: FileUploadRequest) => {
    for (const fraction of [0.3, 0.7, 1]) {
      await new Promise((resolve) => setTimeout(resolve, uploadDelayMs));
      if (signal?.aborted) return { ok: false, status: 0, message: "Unggahan dibatalkan.", code: "aborted" };
      onProgress?.(fraction);
    }
    const refused = guard() ?? verifiedRefusal() ?? gateRefusal();
    if (refused) {
      const refusal = (await refused.json().catch(() => null)) as { error?: string; message?: string } | null;
      return { ok: false, status: refused.status, message: refusal?.message ?? NETWORK_ERROR, code: refusal?.error };
    }
    const live = state.files.filter((stored) => stored.slot === slot && stored.id !== replace);
    if (live.length >= SLOTS[slot].maxFiles) return { ok: false, status: 409, message: "Slot ini sudah penuh. Hapus satu berkas dulu atau ganti berkas yang ada.", code: "slot_full" };

    const known = ALL_FILE_TYPES.map((type) => (type === "pdf" ? "application/pdf" : `image/${type}`));
    const contentType = known.includes(body.type) ? body.type : "application/pdf";
    const image = contentType.startsWith("image/");
    const stored = file(slot, contentType, body.size, image ? 800 : null, image ? 600 : null, state);
    state.files = [...state.files.filter((existing) => existing.id !== replace), stored];
    state.draft ??= { updatedAt: now().getTime(), lastStep: null, steps: {} };
    state.draft.updatedAt = now().getTime();
    return {
      ok: true,
      response: {
        file: stored,
        usage: { slotCount: live.length + 1, slotMax: SLOTS[slot].maxFiles, applicationFiles: state.files.length, applicationBytes: state.files.reduce((sum, existing) => sum + existing.size, 0) },
        draft: { id: DRAFT_ID, missingFiles: missing() },
      },
    };
  };

  setFileUploader(uploader);
  return { handle, uploader };
}

function file(slot: SlotId, contentType: string, size: number, width: number | null, height: number | null, state: MockState): StoredFile {
  state.counter += 1;
  return { id: `mock-file-${state.counter}`, slot, contentType, size: Math.max(size, 1), width, height, uploadedAt: new Date().toISOString() };
}
