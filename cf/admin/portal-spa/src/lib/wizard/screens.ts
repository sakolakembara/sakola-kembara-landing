// The eight screens of the wizard and the seven buckets behind them (shared/application-form/steps.ts): which bucket is
// drawn where, and where a student who comes back should land. Pure.

import { STEP_IDS, UI_STEP_BUCKETS, UI_STEP_ORDER, type StepId, type UiStepId } from "../../../../shared/application-form/steps";

export const REVIEW_INDEX = UI_STEP_ORDER.indexOf("review");

/** The screen a bucket is drawn on: `marketing` has none of its own, it sits under the documents. */
export function screenOf(bucket: StepId): UiStepId {
  const found = UI_STEP_ORDER.find((screen) => UI_STEP_BUCKETS[screen].includes(bucket));
  // Every bucket is on a screen (a test walks them); `identity` is the fallback only so the type is total.
  return found ?? "identity";
}

/** The index of a screen in `UI_STEP_ORDER`. */
export const indexOfScreen = (screen: UiStepId): number => UI_STEP_ORDER.indexOf(screen);

/** The screens whose buckets the server holds in full. `intro` and `review` hold nothing and are never "done" here. */
export function screensDone(saved: readonly StepId[]): UiStepId[] {
  return UI_STEP_ORDER.filter((screen) => {
    const buckets = UI_STEP_BUCKETS[screen];
    return buckets.length > 0 && buckets.every((bucket) => saved.includes(bucket));
  });
}

/**
 * Where a student who has saved `saved` carries on: the first screen with a bucket the server does not hold, or the
 * review when it holds them all. It is the same as "the screen after the last one saved" for a student who went through
 * in order, and it is right for one who went back to change something.
 */
export function firstIncompleteScreen(saved: readonly StepId[]): number {
  const done = screensDone(saved);
  const index = UI_STEP_ORDER.findIndex((screen) => UI_STEP_BUCKETS[screen].length > 0 && !done.includes(screen));
  return index === -1 ? REVIEW_INDEX : index;
}

/** The buckets in the order the submit checks them, with the screen each is on (the order a refusal is reported in). */
export const BUCKET_SCREENS: readonly { bucket: StepId; screen: UiStepId }[] = STEP_IDS.map((bucket) => ({ bucket, screen: screenOf(bucket) }));
