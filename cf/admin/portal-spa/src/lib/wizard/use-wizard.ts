import { useEffect, useMemo, useRef, useState } from "react";
import { validateStep } from "@shared/application-form/rules";
import { DTKS_FILE_REQUIRED_MESSAGE, missingFilesMessage, missingSlots, type SlotId } from "@shared/application-form/slots";
import { STEP_IDS, UI_STEP_BUCKETS, UI_STEP_ORDER, type StepId, type UiStepId } from "@shared/application-form/steps";
import type { FileSlotChange } from "~/components/FileSlotField";
import { useSubmitLock } from "~/lib/hooks";
import { useSession } from "~/lib/session";
import type { StoredFile } from "~/lib/files/types";
import { type CurrentAnswer, type GateError, getCurrent, type Outcome, postSubmit, putStep, type Submitted, type WizardBatch } from "./api";
import { fileErrorKey } from "./fields";
import { clearLocal, loadLocal, saveLocal } from "./persist";
import { BUCKET_SCREENS, indexOfScreen, screenOf } from "./screens";
import type { ScreenErrors } from "./summary";
import { canon, emptyValues, isDirty, mergeStart, normalizeBucket, type SavedSnapshots, snapshotsOf, type WizardValues } from "./values";

// The state machine of the wizard: what the student has typed, which screen they are on, what the server already holds,
// and the four things they can do (go on, go back, jump through the stepper, send). The screens only draw it.
//
// The rules (docs/cloudflare/portal-architecture.md#73 and docs/cloudflare/portal-api.md, sections 8 and 9):
//   * What is typed is kept in the browser at once (`./persist`), every change.
//   * "Selanjutnya" checks the screen with the SAME rules the Worker runs (`validateStep`), and only a complete, valid
//     bucket is sent (`PUT steps/:step`): the screen after it opens when the server has taken it, and not before.
//   * Going back, or jumping to a screen already visited, sends nothing: the typing is in the browser. A bucket that
//     differs from what the server holds is "belum disimpan" (the stepper and the review say so), and it is saved by the
//     next "Selanjutnya" through it or, at the latest, by "Kirim Pendaftaran", which saves every bucket the server does
//     not hold the same before it asks the Worker to send.
//   * A refusal is answered in place: the fields the Worker names, the gate (the application can no longer be saved or
//     sent: the local copy goes and the gate screen takes over), a lost session (the shell takes the student to sign in),
//     or one sentence for the rest, with the typing intact.

export type WizardStatus = { kind: "idle" } | { kind: "saving" } | { kind: "submitting" } | { kind: "saved"; screen: UiStepId };

export interface WizardInit {
  userId: string;
  batch: WizardBatch;
  answer: CurrentAnswer;
}

export interface Wizard {
  values: WizardValues;
  files: StoredFile[];
  /** Index into `UI_STEP_ORDER`, and the same screen by name. */
  screen: number;
  screenId: UiStepId;
  visited: UiStepId[];
  /** The errors of the screen the student is on, and the sentence above them when there is one that is not a field's. */
  errors: ScreenErrors;
  notice: string | null;
  /** Goes up each time the summary has something new to say: the screen moves focus to it. */
  summaryToken: number;
  status: WizardStatus;
  busy: boolean;
  /** Per screen: has the student typed something the server does not hold? */
  unsaved: Record<UiStepId, boolean>;
  sent: Submitted | null;
  update: <B extends StepId>(bucket: B, patch: Partial<WizardValues[B]>, clear?: readonly string[]) => void;
  filesOf: (slot: SlotId) => StoredFile[];
  applyFileChange: (change: FileSlotChange) => void;
  next: () => void;
  back: () => void;
  jump: (index: number) => void;
  submit: () => void;
  /** The 401 of a file call: the session is gone. */
  expire: () => void;
}

const SUMMARY_TITLE = "Beberapa isian belum lengkap. Silakan lengkapi bagian yang ditandai.";
export { SUMMARY_TITLE };

function withVisited(visited: readonly UiStepId[], id: UiStepId): UiStepId[] {
  return UI_STEP_ORDER.filter((screen) => screen === id || visited.includes(screen));
}

function countsOf(files: readonly StoredFile[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of files) counts[file.slot] = (counts[file.slot] ?? 0) + 1;
  return counts;
}

export function useWizard(init: WizardInit, onGate: (gate: GateError, message: string) => void): Wizard {
  const { userId, batch, answer } = init;
  const { expire } = useSession();
  const { pending, run } = useSubmitLock();

  // The start is worked out once, when the wizard opens: the server's draft and the browser's copy, by `mergeStart`.
  const start = useMemo(() => {
    const now = Date.now();
    const local = loadLocal(userId, batch.id, now);
    return mergeStart({ accountName: answer.user.name, draft: answer.draft, local, skewMs: now - Date.parse(answer.now) });
    // Once: a later render with a new `answer` object (the page reloading its data) is a new wizard, which the page keys.
  }, []);
  const pristine = useMemo(() => emptyValues(answer.user.name), [answer.user.name]);

  const [values, setValues] = useState<WizardValues>(start.values);
  const [saved, setSavedState] = useState<SavedSnapshots>(start.saved);
  const savedRef = useRef<SavedSnapshots>(start.saved);
  const [files, setFiles] = useState<StoredFile[]>(answer.files);
  const [screen, setScreen] = useState(start.screen);
  const [visited, setVisited] = useState<UiStepId[]>(start.visited);
  const [errorsByScreen, setErrorsByScreen] = useState<Partial<Record<UiStepId, ScreenErrors>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [summaryToken, setSummaryToken] = useState(0);
  const [status, setStatus] = useState<WizardStatus>({ kind: "idle" });
  const [sent, setSent] = useState<Submitted | null>(null);

  const screenId = UI_STEP_ORDER[screen] as UiStepId;

  // ─── The copy in the browser: written on every change, never on the way in
  const persist = useRef(true);
  const written = useRef({ values, screen, visited });
  useEffect(() => {
    const last = written.current;
    if (last.values === values && last.screen === screen && last.visited === visited) return;
    written.current = { values, screen, visited };
    if (persist.current) saveLocal(userId, batch.id, { stepIndex: screen, visited, values }, Date.now());
  }, [values, screen, visited, userId, batch.id]);

  function setSaved(bucket: StepId, snapshot: string | undefined) {
    const next = { ...savedRef.current };
    if (snapshot === undefined) delete next[bucket];
    else next[bucket] = snapshot;
    savedRef.current = next;
    setSavedState(next);
  }

  function showErrors(on: UiStepId, errors: ScreenErrors, message: string | null = null) {
    setErrorsByScreen((prev) => ({ ...prev, [on]: errors }));
    setNotice(message);
    setSummaryToken((n) => n + 1);
  }

  function goTo(index: number) {
    const target = Math.min(Math.max(index, 0), UI_STEP_ORDER.length - 1);
    setScreen(target);
    setVisited((prev) => withVisited(prev, UI_STEP_ORDER[target] as UiStepId));
    setNotice(null);
    setStatus({ kind: "idle" });
  }

  /** The application can no longer be saved or sent: the browser's copy goes, and the page shows the gate. */
  function endOnGate(gate: GateError, message: string) {
    persist.current = false;
    clearLocal(userId, batch.id);
    onGate(gate, message);
  }

  // ─── Typing

  function update<B extends StepId>(bucket: B, patch: Partial<WizardValues[B]>, clear?: readonly string[]) {
    setValues((prev) => ({ ...prev, [bucket]: { ...prev[bucket], ...patch } }));
    const gone = clear ?? Object.keys(patch);
    const on = screenOf(bucket);
    setErrorsByScreen((prev) => {
      const current = prev[on];
      if (!current) return prev;
      const kept = Object.fromEntries(Object.entries(current).filter(([key]) => !gone.some((path) => key === path || key.startsWith(`${path}.`))));
      return Object.keys(kept).length === Object.keys(current).length ? prev : { ...prev, [on]: kept };
    });
    setStatus((now) => (now.kind === "saved" ? { kind: "idle" } : now));
  }

  function applyFileChange(change: FileSlotChange) {
    setFiles((prev) => {
      if (change.kind === "added") return [...prev, change.file];
      if (change.kind === "replaced") return prev.map((file) => (file.id === change.removedId ? change.file : file));
      return prev.filter((file) => file.id !== change.fileId);
    });
    // A document that is there now is no longer "wajib diisi".
    if (change.kind !== "removed") {
      const key = fileErrorKey(change.file.slot);
      setErrorsByScreen((prev) => {
        const current = prev.documents;
        if (!current || !(key in current)) return prev;
        return { ...prev, documents: Object.fromEntries(Object.entries(current).filter(([name]) => name !== key)) };
      });
    }
  }

  // ─── Checking a screen: the Worker's rules, and the documents that must be there

  function checkScreen(on: UiStepId, atFiles: readonly StoredFile[] = files): ScreenErrors {
    const found: ScreenErrors = {};
    for (const bucket of UI_STEP_BUCKETS[on]) {
      const result = validateStep(bucket, values[bucket]);
      if (!result.ok) Object.assign(found, result.fields);
    }
    if (on === "documents") {
      for (const slot of missingSlots(countsOf(atFiles), values.documents.dtksRegistered === "ya")) {
        found[fileErrorKey(slot)] = slot === "dtks" ? DTKS_FILE_REQUIRED_MESSAGE : "Wajib diisi";
      }
    }
    return found;
  }

  // ─── Saving a bucket

  type SaveResult = "ok" | "stopped";

  /** Sends one bucket the server does not hold the same yet. It has been checked: `validateStep` passed. */
  async function saveBucket(bucket: StepId): Promise<SaveResult> {
    const checked = validateStep(bucket, values[bucket]);
    if (!checked.ok) return "stopped";
    const snapshot = canon(bucket, values[bucket]);
    if (savedRef.current[bucket] === snapshot) return "ok";

    setStatus({ kind: "saving" });
    const outcome = await putStep(bucket, checked.value);
    if (outcome.kind === "ok") {
      setSaved(bucket, snapshot);
      const gone = outcome.data.removedSlots;
      if (gone.length > 0) setFiles((prev) => prev.filter((file) => !gone.includes(file.slot)));
      return "ok";
    }
    setStatus({ kind: "idle" });
    return settleRefusal(outcome, screenOf(bucket));
  }

  /** What the screen does with a refusal that is not a success. Always "stopped". */
  function settleRefusal(outcome: Exclude<Outcome<unknown>, { kind: "ok" }>, on: UiStepId): SaveResult {
    if (outcome.kind === "unauthorized") expire();
    else if (outcome.kind === "gate") endOnGate(outcome.gate, outcome.message);
    else if (outcome.kind === "invalid") {
      if (on !== screenId) goTo(indexOfScreen(on));
      showErrors(on, outcome.fields, Object.keys(outcome.fields).length === 0 ? outcome.message : null);
    } else showErrors(on, errorsByScreen[on] ?? {}, outcome.message);
    return "stopped";
  }

  // ─── Going on

  function next() {
    void run(async () => {
      const found = checkScreen(screenId);
      if (Object.keys(found).length > 0) {
        showErrors(screenId, found);
        return;
      }
      for (const bucket of UI_STEP_BUCKETS[screenId]) {
        if ((await saveBucket(bucket)) === "stopped") return;
      }
      goTo(screen + 1);
      if (UI_STEP_BUCKETS[screenId].length > 0) setStatus({ kind: "saved", screen: screenId });
    });
  }

  function back() {
    goTo(screen - 1);
  }

  function jump(index: number) {
    const target = UI_STEP_ORDER[index];
    if (target !== undefined && (visited.includes(target) || index <= screen)) goTo(index);
  }

  // ─── Sending

  /** The server and the screen disagree (a file or a step it should hold is not there): read it again, keep what was typed. */
  async function resync(): Promise<void> {
    const outcome = await getCurrent();
    if (outcome.kind !== "ok") return;
    if (outcome.data.gate !== "open") {
      endOnGate(outcome.data.gate === "submitted" ? "already_submitted" : "no_open_batch", "");
      return;
    }
    setFiles(outcome.data.files);
    const held = snapshotsOf(outcome.data.draft);
    for (const bucket of STEP_IDS) {
      const stored = outcome.data.draft?.steps[bucket];
      setSaved(bucket, stored === undefined ? undefined : held[bucket] ?? canon(bucket, normalizeBucket(stored, pristine[bucket])));
    }
  }

  function submit() {
    void run(async () => {
      // 1. Every bucket, in the order the Worker checks them, with the same rules. The first that fails is shown where it lives.
      for (const { bucket, screen: on } of BUCKET_SCREENS) {
        const result = validateStep(bucket, values[bucket]);
        if (!result.ok) {
          goTo(indexOfScreen(on));
          showErrors(on, result.fields, null);
          return;
        }
      }
      // 2. The documents that must be there (the `dtks` one only when the student said they are registered).
      const lacking = missingSlots(countsOf(files), values.documents.dtksRegistered === "ya");
      if (lacking.length > 0) {
        goTo(indexOfScreen("documents"));
        showErrors("documents", checkScreen("documents"), missingFilesMessage(lacking));
        return;
      }
      // 3. What the server does not hold the same yet (a step changed through "Ubah" and not saved), then the submit itself.
      for (const bucket of STEP_IDS) {
        if ((await saveBucket(bucket)) === "stopped") return;
      }
      setStatus({ kind: "submitting" });
      const outcome = await postSubmit();
      setStatus({ kind: "idle" });
      if (outcome.kind === "ok") {
        persist.current = false;
        clearLocal(userId, batch.id);
        setSent(outcome.data);
        return;
      }
      if (outcome.kind === "failed") {
        if (outcome.code === "duplicate_whatsapp") {
          goTo(indexOfScreen("identity"));
          showErrors("identity", { whatsapp: outcome.message }, null);
          return;
        }
        if (outcome.code === "incomplete" || outcome.code === "no_draft") await resync();
        showErrors(screenId, {}, outcome.message);
        return;
      }
      settleRefusal(outcome, "review");
    });
  }

  const unsaved = useMemo(() => {
    const out = {} as Record<UiStepId, boolean>;
    for (const id of UI_STEP_ORDER) out[id] = UI_STEP_BUCKETS[id].some((bucket) => isDirty(bucket, values, saved, pristine));
    return out;
  }, [values, saved, pristine]);

  return {
    values,
    files,
    screen,
    screenId,
    visited,
    errors: errorsByScreen[screenId] ?? {},
    notice,
    summaryToken,
    status,
    busy: pending,
    unsaved,
    sent,
    update,
    filesOf: (slot) => files.filter((file) => file.slot === slot),
    applyFileChange,
    next,
    back,
    jump,
    submit,
    expire,
  };
}

