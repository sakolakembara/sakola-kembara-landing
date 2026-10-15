// The list under "Beberapa isian belum lengkap": one line per field that needs a fix, in the order the fields appear on
// the screen, each with the name the label above it uses. Pure.

import { SLOT_IDS, slotLabel, isSlotId } from "../../../../shared/application-form/slots";
import { UI_STEP_BUCKETS, type StepId, type UiStepId } from "../../../../shared/application-form/steps";
import { fileErrorKey, FIELD_LABELS, labelOf } from "./fields";

/** The errors of one screen: a path in a bucket (`fullName`, `entries.0.name`) or `file:<slot>` for a document. */
export type ScreenErrors = Record<string, string>;

export interface SummaryItem {
  /** The key in the screen's errors; also what `data-field` carries on the control, so the line can move focus there. */
  key: string;
  label: string;
  message: string;
}

function bucketOf(screen: UiStepId, key: string): StepId | null {
  const head = key.split(".")[0] ?? key;
  return UI_STEP_BUCKETS[screen].find((bucket) => Object.hasOwn(FIELD_LABELS[bucket], head)) ?? null;
}

/** The lines of a screen's summary. A key no field of the screen owns still gets a line (a Worker message must never be dropped). */
export function summaryItems(screen: UiStepId, errors: ScreenErrors): SummaryItem[] {
  const buckets = UI_STEP_BUCKETS[screen];
  const order = (key: string): number => {
    if (key.startsWith("file:")) return 1_000 + SLOT_IDS.indexOf(key.slice(5) as (typeof SLOT_IDS)[number]);
    const head = key.split(".")[0] as string;
    for (const [i, bucket] of buckets.entries()) {
      const at = Object.keys(FIELD_LABELS[bucket]).indexOf(head);
      if (at !== -1) return i * 100 + at;
    }
    return 999;
  };
  return Object.entries(errors)
    .filter(([, message]) => message !== "")
    .map(([key, message]): SummaryItem => {
      if (key.startsWith("file:")) {
        const slot = key.slice(5);
        return { key, label: isSlotId(slot) ? slotLabel(slot) : "Berkas", message };
      }
      const bucket = bucketOf(screen, key);
      return { key, label: bucket ? labelOf(bucket, key) : "Isian", message };
    })
    .sort((a, b) => order(a.key) - order(b.key) || a.key.localeCompare(b.key, undefined, { numeric: true }));
}

export { fileErrorKey };
