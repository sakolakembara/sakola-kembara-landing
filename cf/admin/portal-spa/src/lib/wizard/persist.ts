// The wizard's copy in the browser (docs/cloudflare/portal-architecture.md#73-the-draft-per-step-saving-and-local-persistence):
// what the student has typed, including the step being typed, so a closed tab or a dropped connection loses nothing.
//
//   key       sakem-portal:v1:<user id>:<batch id>     (two ids; the legacy key held the email)
//   value     a `LocalDraft` (shared/application-form/draft.ts) with the time it was written, written on every change
//   removed   at sign-out and when the API answers 401 (the shell: ~/lib/session), after the submit, when the API answers
//             `no_open_batch`, `batch_closed` or already submitted, and when it is 30 days old or cannot say when it was written
//
// File bodies are never kept here (the files are the field's, `FileSlotField`, and go straight to the Worker). Nothing in this
// file logs, and nothing throws: a browser that refuses storage (a private window, a full disk) simply keeps nothing.

import { localDraftKey, readLocalDraft, writeLocalDraft, type LocalDraft } from "../../../../shared/application-form/draft";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The copy this student left for this batch, or `null`. A value that is there but is not worth keeping (not JSON, a shape
 * this version cannot read, no numeric `savedAt`, older than 30 days) is removed on the spot.
 */
export function loadLocal(userId: string, batchId: string, now: number): LocalDraft | null {
  const store = storage();
  if (!store) return null;
  const key = localDraftKey(userId, batchId);
  try {
    const text = store.getItem(key);
    if (text === null) return null;
    const draft = readLocalDraft(text, now);
    if (!draft) store.removeItem(key);
    return draft;
  } catch {
    return null;
  }
}

/** Writes the copy, stamped with `now`. */
export function saveLocal(userId: string, batchId: string, draft: Omit<LocalDraft, "version" | "savedAt">, now: number): void {
  try {
    storage()?.setItem(localDraftKey(userId, batchId), writeLocalDraft(draft, now));
  } catch {
    // Storage full or refused: the typing is still on the screen and the saved steps are on the server.
  }
}

export function clearLocal(userId: string, batchId: string): void {
  try {
    storage()?.removeItem(localDraftKey(userId, batchId));
  } catch {
    // Nothing to remove from a browser that will not let us look.
  }
}
