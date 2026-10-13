// The seven buckets as zod schemas, for code that wants a `ZodType` (a form resolver in the wizard, a `safeParse`).
// Imports zod (4): only the Worker and the portal's lazy wizard chunk import this file. The admin SPA must not, and
// `pnpm check:spa` fails if zod reaches its bundle. Code that only needs the rules imports `rules.ts`, which has no
// dependency.
//
// Nothing is decided here. Each schema runs the plain function of `rules.ts` and turns its issues into zod issues
// (the same messages, the same paths, the same order), so there is one copy of every rule and the schema, the server
// and `validateStep` can never disagree. Parsing gives the STORED value of the bucket (trimmed, sanitised).

import { z } from "zod";
import { validateStep, type StepValues } from "./rules";
import { STEP_IDS, type StepId } from "./steps";

function stepSchema<K extends StepId>(step: K): z.ZodType<StepValues[K]> {
  return z.unknown().transform((input, ctx): StepValues[K] => {
    const result = validateStep(step, input);
    if (result.ok) return result.value;
    for (const issue of result.issues) ctx.issues.push({ code: "custom", message: issue.message, path: issue.path, input });
    return z.NEVER;
  });
}

export const STEP_SCHEMAS: { [K in StepId]: z.ZodType<StepValues[K]> } = {
  identity: stepSchema("identity"),
  household: stepSchema("household"),
  housing: stepSchema("housing"),
  organizations: stepSchema("organizations"),
  documents: stepSchema("documents"),
  marketing: stepSchema("marketing"),
  interview: stepSchema("interview"),
};

// The plain functions, under the names of the contract (docs/cloudflare/portal-api.md, section 14).
export { parseRupiah, sanitizeStep, validateStep } from "./rules";
export type { StepValidation, StepValues } from "./rules";

/** The schema of a step by its name; `null` for anything that is not one of the seven. */
export function schemaFor(step: string): z.ZodType | null {
  return (STEP_IDS as readonly string[]).includes(step) ? STEP_SCHEMAS[step as StepId] : null;
}
