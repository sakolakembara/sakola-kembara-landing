// What the wizard holds while the student types: one object per bucket, every field in the form a control gives it
// (text, a switch, a list), and the three things that are decided about it without a screen:
//
//   * `normalizeBucket`  turns anything (a stored bucket from the server, a copy read from `localStorage` that somebody
//                        may have edited) into a bucket the screens can draw: unknown keys dropped, the wrong type
//                        replaced by the default, a number written as text;
//   * `canon`            the text two buckets are compared by, so "is this still what the server holds?" does not depend on
//                        a trailing space or on a number that was a string on one side (it is `validateStep`'s stored value);
//   * `mergeStart`       what the wizard opens with: the server's saved steps and the browser's copy, by the rule of
//                        docs/cloudflare/portal-architecture.md#73 (the saved steps win unless the local copy of a step is
//                        newer and different, and then it is kept and marked "belum disimpan").
//
// Pure (no DOM, no React). The rules themselves are `shared/application-form/rules.ts`: the wizard does not carry a copy
// of them, and it does not import `zod` (the plain functions are what the Worker's schemas wrap).

import { type LocalDraft } from "../../../../shared/application-form/draft";
import { validateStep } from "../../../../shared/application-form/rules";
import { STEP_IDS, UI_STEP_ORDER, type StepId, type UiStepId } from "../../../../shared/application-form/steps";
import type { ServerDraft } from "./api";
import { firstIncompleteScreen, screenOf, screensDone } from "./screens";

export type IdentityForm = {
  fullName: string;
  nickname: string;
  gender: string;
  religion: string;
  schoolName: string;
  branch: string;
  homeAddress: string;
  graduationBatch: string;
  whatsapp: string;
};

export type HouseholdForm = {
  livingWith: string[];
  fatherName: string;
  fatherOccupation: string;
  fatherIncome: string;
  motherName: string;
  motherOccupation: string;
  motherIncome: string;
  hasOtherEarner1: boolean;
  earner1Relation: string;
  earner1Income: string;
  hasOtherEarner2: boolean;
  earner2Relation: string;
  earner2Income: string;
  familySize: string;
};

export type HousingForm = {
  residenceStatus: string;
  buildingArea: string;
  motorcycles: string;
  cars: string;
  hasDebt: boolean;
  debtType: string;
  debtAmount: string;
  debtInstallmentMonths: string;
  debtDescription: string;
};

export type OrganizationEntryForm = { name: string; position: string };
export type OrganizationsForm = { hasOrganizations: boolean; entries: OrganizationEntryForm[] };

export type DocumentsForm = { dtksRegistered: string };
export type MarketingForm = { instagramUsername: string };

export type InterviewForm = {
  motivationHigherEducation: string;
  motivationSakem: string;
  consistencyPlan: string;
  attendanceCommitment: string;
  parentResponse: string;
  ifParentChangesMind: string;
  agreedToSignedStatement: string;
};

export type WizardValues = {
  identity: IdentityForm;
  household: HouseholdForm;
  housing: HousingForm;
  organizations: OrganizationsForm;
  documents: DocumentsForm;
  marketing: MarketingForm;
  interview: InterviewForm;
};

export const BLANK_ENTRY: OrganizationEntryForm = { name: "", position: "" };

/** A new application: every field empty (as the legacy form started), the account's name in the name field, no motorcycle and no car. */
export function emptyValues(accountName: string): WizardValues {
  return {
    identity: { fullName: accountName, nickname: "", gender: "", religion: "", schoolName: "", branch: "", homeAddress: "", graduationBatch: "", whatsapp: "" },
    household: {
      livingWith: [],
      fatherName: "",
      fatherOccupation: "",
      fatherIncome: "",
      motherName: "",
      motherOccupation: "",
      motherIncome: "",
      hasOtherEarner1: false,
      earner1Relation: "",
      earner1Income: "",
      hasOtherEarner2: false,
      earner2Relation: "",
      earner2Income: "",
      familySize: "",
    },
    housing: { residenceStatus: "", buildingArea: "", motorcycles: "0", cars: "0", hasDebt: false, debtType: "", debtAmount: "", debtInstallmentMonths: "", debtDescription: "" },
    organizations: { hasOrganizations: false, entries: [{ ...BLANK_ENTRY }] },
    documents: { dtksRegistered: "" },
    marketing: { instagramUsername: "" },
    interview: {
      motivationHigherEducation: "",
      motivationSakem: "",
      consistencyPlan: "",
      attendanceCommitment: "",
      parentResponse: "",
      ifParentChangesMind: "",
      agreedToSignedStatement: "",
    },
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A bucket the screens can draw, from whatever was stored or typed: every key of `base` is kept with its own type (a
 * number becomes its text), anything else is dropped, and what is missing or of the wrong type is the default.
 */
export function normalizeBucket<T extends WizardValues[StepId]>(raw: unknown, base: T): T {
  if (!isRecord(raw)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, fallback] of Object.entries(base as Record<string, unknown>)) {
    const value = raw[key];
    if (typeof fallback === "string") {
      if (typeof value === "string") out[key] = value;
      else if (typeof value === "number" && Number.isFinite(value)) out[key] = String(value);
    } else if (typeof fallback === "boolean") {
      if (typeof value === "boolean") out[key] = value;
    } else if (key === "livingWith") {
      if (Array.isArray(value)) out[key] = value.filter((item): item is string => typeof item === "string");
    } else if (key === "entries" && Array.isArray(value)) {
      const entries = value.filter(isRecord).map((entry) => ({ name: typeof entry.name === "string" ? entry.name : "", position: typeof entry.position === "string" ? entry.position : "" }));
      // The form always shows at least one row to type in.
      out[key] = entries.length > 0 ? entries : [{ ...BLANK_ENTRY }];
    }
  }
  return out as T;
}

/** The text a bucket is compared by: what `validateStep` would store, or the bucket itself while it does not pass. */
export function canon(step: StepId, bucket: unknown): string {
  const result = validateStep(step, bucket);
  return JSON.stringify(result.ok ? result.value : { invalid: bucket });
}

/** What the server holds of each bucket, by `canon`; a bucket it does not hold has no entry. */
export type SavedSnapshots = Partial<Record<StepId, string>>;

/** Is the bucket as the student has it different from what the server holds? A bucket never saved and never touched is not "unsaved": it is empty. */
export function isDirty(step: StepId, values: WizardValues, saved: SavedSnapshots, pristine: WizardValues): boolean {
  const held = saved[step] ?? canon(step, pristine[step]);
  return canon(step, values[step]) !== held;
}

/** The snapshots of the buckets a server draft holds. */
export function snapshotsOf(draft: ServerDraft | null): SavedSnapshots {
  const out: SavedSnapshots = {};
  if (!draft) return out;
  for (const step of STEP_IDS) {
    const stored = draft.steps[step];
    if (stored !== undefined) out[step] = canon(step, normalizeBucket(stored, emptyValues("")[step]));
  }
  return out;
}

export interface Start {
  values: WizardValues;
  saved: SavedSnapshots;
  /** Index into `UI_STEP_ORDER`. */
  screen: number;
  visited: UiStepId[];
}

/**
 * What the wizard opens with. The server's saved buckets, then the browser's copy over them where it should win:
 *
 *   - a bucket the server does not hold is the browser's (it is typed and not saved yet);
 *   - a bucket both hold stays the server's, unless the browser's copy was written AFTER the server's draft last changed
 *     and is different, and then it is kept (and shows as "belum disimpan" until it is saved).
 *
 * `skew` is how far the phone's clock is ahead of the server's, from the server's `now`: a phone that is wrong by minutes
 * must not decide which copy is newer.
 */
export function mergeStart(input: { accountName: string; draft: ServerDraft | null; local: LocalDraft | null; skewMs: number }): Start {
  const { accountName, draft, local, skewMs } = input;
  const pristine = emptyValues(accountName);
  const values = emptyValues(accountName);
  const saved = snapshotsOf(draft);

  for (const step of STEP_IDS) {
    const stored = draft?.steps[step];
    if (stored !== undefined) (values[step] as unknown) = normalizeBucket(stored, pristine[step]);
  }

  const localIsNewer = !draft || Date.parse(draft.updatedAt) < (local?.savedAt ?? 0) - skewMs;
  if (local) {
    for (const step of STEP_IDS) {
      const typed = local.values[step];
      if (typed === undefined) continue;
      const mine = normalizeBucket(typed, pristine[step]);
      if (saved[step] === undefined || (localIsNewer && canon(step, mine) !== saved[step])) (values[step] as unknown) = mine;
    }
  }

  const done = screensDone(Object.keys(saved) as StepId[]);
  const visited = new Set<UiStepId>(["intro", ...done]);
  let screen: number;
  if (local && localIsNewer) {
    local.visited.forEach((id) => visited.add(id));
    screen = local.stepIndex;
  } else {
    // The server's draft is the newer: carry on where it stops. Nothing at all yet is the intro.
    screen = draft ? firstIncompleteScreen(Object.keys(saved) as StepId[]) : 0;
    if (local) local.visited.forEach((id) => visited.add(id));
  }
  visited.add(UI_STEP_ORDER[screen] as UiStepId);
  return { values, saved, screen, visited: UI_STEP_ORDER.filter((id) => visited.has(id)) };
}

/** The screen a bucket is drawn on (re-exported so callers import the one place). */
export { screenOf };
