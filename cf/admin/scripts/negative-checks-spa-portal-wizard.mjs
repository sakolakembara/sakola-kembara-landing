// The negative checks of the portal's registration wizard (SAKEM-083, task P3), in their own file so the shared list in
// negative-checks-spa.mjs stays short: it imports and spreads `portalWizardSpaChecks`. Same rules as there: each check breaks
// ONE safeguard in the source, runs the tests that must notice, expects them to FAIL, and the runner restores the file.
//
//   node scripts/negative-checks-spa.mjs --only "portal wizard:"
//
// The wizard's tests live in portal-spa/test and run with portal-spa/vitest.config.ts, so every check names that config.
// A check with a list in `from` and `to` breaks a safeguard that is built in two places (both must go for the behaviour to
// change). Every pattern below is a line of the source as it is: the runner reports a pattern it does not find, so a refactor
// cannot turn a check into a no-op without somebody noticing.

const CONFIG = "portal-spa/vitest.config.ts";
const t = (...names) => names.map((name) => `portal-spa/test/${name}`).join(" ");

const LIB = "wizard-lib.test.ts";
const PERSIST = "wizard-persist.test.ts";
const STEPS = "wizard-steps.test.tsx";
const FLOW = "wizard-flow.test.tsx";
const ERRORS = "wizard-errors.test.tsx";
const GATES = "wizard-gates.test.tsx";
const A11Y = "wizard-a11y.test.tsx";
const PRIVACY = "wizard-privacy.test.tsx";
const RULES = "wizard-rules.test.ts";
const MOCK = "wizard-mock.test.tsx";

const W = "portal-spa/src/lib/wizard";
const P = "portal-spa/src/pages/daftar";

const check = (name, file, from, to, tests) => ({ name: `portal wizard: ${name}`, config: CONFIG, file, from, to, tests });

export const portalWizardSpaChecks = [
  // ---------------------------------------------- what the browser keeps (architecture 7.3)
  check(
    "the copy in the browser is written without the time it was written",
    `${W}/persist.ts`,
    "storage()?.setItem(localDraftKey(userId, batchId), writeLocalDraft(draft, now));",
    "storage()?.setItem(localDraftKey(userId, batchId), JSON.stringify({ version: 1, ...draft }));",
    t(PERSIST, FLOW),
  ),
  check(
    "the copy is kept under another key than the one of two ids (the ids swapped)",
    `${W}/persist.ts`,
    "storage()?.setItem(localDraftKey(userId, batchId), writeLocalDraft(draft, now));",
    "storage()?.setItem(localDraftKey(batchId, userId), writeLocalDraft(draft, now));",
    t(PERSIST, PRIVACY, FLOW),
  ),
  check("a copy older than 30 days is read and used", `${W}/persist.ts`, "const draft = readLocalDraft(text, now);", "const draft = readLocalDraft(text, 0);", t(PERSIST, FLOW)),
  check("a copy that cannot be read is left in the browser", `${W}/persist.ts`, "if (!draft) store.removeItem(key);", "", t(PERSIST, PRIVACY)),
  check(
    "opening the wizard writes a copy (the 30 days then run from the last visit, not the last change)",
    `${W}/use-wizard.ts`,
    "    if (last.values === values && last.screen === screen && last.visited === visited) return;\n",
    "",
    t(FLOW),
  ),
  check(
    "the copy stays in the browser after the application is sent",
    `${W}/use-wizard.ts`,
    "        persist.current = false;\n        clearLocal(userId, batch.id);\n        setSent(outcome.data);",
    "        persist.current = false;\n        setSent(outcome.data);",
    t(FLOW),
  ),
  check(
    "the copy stays in the browser when a save or the send finds the batch closed or the application sent",
    `${W}/use-wizard.ts`,
    "    persist.current = false;\n    clearLocal(userId, batch.id);\n    onGate(gate, message);",
    "    persist.current = false;\n    onGate(gate, message);",
    t(ERRORS),
  ),
  check(
    "the wizard's page leaves the student's copies when no batch is open",
    `${P}/DaftarPage.tsx`,
    '    if (answer.gate === "no_open_batch") wipeLocalDrafts(me.id);\n',
    "",
    t(GATES),
  ),
  check(
    "the wizard's page leaves the copy of a batch whose application is already sent",
    `${P}/DaftarPage.tsx`,
    '    if (answer.gate === "submitted" && answer.batch) clearLocal(me.id, answer.batch.id);\n',
    "",
    t(GATES),
  ),
  check(
    "the browser's copy wins over the server's draft even when it is older",
    `${W}/values.ts`,
    "const localIsNewer = !draft || Date.parse(draft.updatedAt) < (local?.savedAt ?? 0) - skewMs;",
    "const localIsNewer = true;",
    t(LIB, FLOW),
  ),
  check(
    "the browser's copy never wins over the server's draft",
    `${W}/values.ts`,
    "const localIsNewer = !draft || Date.parse(draft.updatedAt) < (local?.savedAt ?? 0) - skewMs;",
    "const localIsNewer = !draft;",
    t(LIB, FLOW),
  ),
  check(
    "a phone whose clock is wrong decides which copy is newer",
    `${W}/values.ts`,
    "Date.parse(draft.updatedAt) < (local?.savedAt ?? 0) - skewMs;",
    "Date.parse(draft.updatedAt) < (local?.savedAt ?? 0);",
    t(LIB),
  ),
  check(
    "two buckets are told apart by their exact text (a trailing space is a change)",
    `${W}/values.ts`,
    "return JSON.stringify(result.ok ? result.value : { invalid: bucket });",
    "return JSON.stringify(bucket);",
    t(LIB, FLOW),
  ),
  check(
    "a count the server stored as a number is not read as text",
    `${W}/values.ts`,
    '      else if (typeof value === "number" && Number.isFinite(value)) out[key] = String(value);\n',
    "",
    t(LIB),
  ),
  check(
    "a student who has saved the documents but not the proofs is sent past the documents",
    `${W}/screens.ts`,
    "return buckets.length > 0 && buckets.every((bucket) => saved.includes(bucket));",
    "return buckets.length > 0 && buckets.some((bucket) => saved.includes(bucket));",
    t(LIB),
  ),
  check("a student whose every step is saved is not taken to the review", `${W}/screens.ts`, "return index === -1 ? REVIEW_INDEX : index;", "return index === -1 ? 0 : index;", t(LIB)),

  // ---------------------------------------------- the same rules as the Worker, and what is sent
  check(
    "'Selanjutnya' goes on without checking the screen",
    `${W}/use-wizard.ts`,
    "      if (Object.keys(found).length > 0) {\n        showErrors(screenId, found);\n        return;\n      }\n      for (const bucket of UI_STEP_BUCKETS[screenId]) {",
    "      for (const bucket of UI_STEP_BUCKETS[screenId]) {",
    t(STEPS, A11Y),
  ),
  check(
    "'Selanjutnya' goes on although the Worker refused the save",
    `${W}/use-wizard.ts`,
    '        if ((await saveBucket(bucket)) === "stopped") return;\n      }\n      goTo(screen + 1);',
    "        await saveBucket(bucket);\n      }\n      goTo(screen + 1);",
    t(ERRORS),
  ),
  check("a bucket the server already holds is sent again every time", `${W}/use-wizard.ts`, '    if (savedRef.current[bucket] === snapshot) return "ok";\n', "", t(FLOW)),
  check(
    "the send does not save what was changed after a screen was left",
    `${W}/use-wizard.ts`,
    '      for (const bucket of STEP_IDS) {\n        if ((await saveBucket(bucket)) === "stopped") return;\n      }\n      setStatus({ kind: "submitting" });',
    '      setStatus({ kind: "submitting" });',
    t(FLOW, ERRORS),
  ),
  check(
    "the send is made although a required document is missing",
    `${W}/use-wizard.ts`,
    '      if (lacking.length > 0) {\n        goTo(indexOfScreen("documents"));',
    '      if (false) {\n        goTo(indexOfScreen("documents"));',
    t(FLOW),
  ),
  check(
    "a double press sends twice",
    `${W}/use-wizard.ts`,
    "  const { pending, run } = useSubmitLock();",
    "  const { pending } = useSubmitLock();\n  const run = (task: () => Promise<void>) => void task();",
    t(FLOW),
  ),

  // ---------------------------------------------- DTKS: the one answer that governs a document
  check(
    "the SKTM is required of every student, not only of one registered in DTKS (when going on)",
    `${W}/use-wizard.ts`,
    'missingSlots(countsOf(atFiles), values.documents.dtksRegistered === "ya")',
    "missingSlots(countsOf(atFiles), true)",
    t(STEPS, FLOW),
  ),
  check(
    "the SKTM is required of every student, not only of one registered in DTKS (when sending)",
    `${W}/use-wizard.ts`,
    'missingSlots(countsOf(files), values.documents.dtksRegistered === "ya")',
    "missingSlots(countsOf(files), true)",
    t(FLOW),
  ),
  check(
    "the SKTM slot is shown to a student who is not registered in DTKS",
    `${P}/steps/Documents.tsx`,
    '{dtks === "ya" && <Slot slot="dtks" required',
    '{dtks !== "" && <Slot slot="dtks" required',
    t(STEPS),
  ),
  check(
    "the SKTM the Worker removed is still in the screen's list of files",
    `${W}/use-wizard.ts`,
    "      if (gone.length > 0) setFiles((prev) => prev.filter((file) => !gone.includes(file.slot)));\n",
    "",
    t(STEPS),
  ),

  // ---------------------------------------------- reading the Worker's answers
  check(
    "an answer with a gate the wizard does not know is read as a form",
    `${W}/api.ts`,
    '  if (gate !== "open" && gate !== "no_open_batch" && gate !== "submitted") return null;\n',
    "",
    t(LIB),
  ),
  check("an open gate without a batch is read as a form", `${W}/api.ts`, '  if (gate === "open" && !batch) return null;\n', "", t(LIB)),
  check("a 409 of the gate is shown as an ordinary failure", `${W}/api.ts`, "if (failure.status === 409 && isGateError(failure.code))", "if (false && isGateError(failure.code))", t(LIB, ERRORS)),
  check("a lost session is shown as an ordinary failure", `${W}/api.ts`, '  if (failure.status === 401) return { kind: "unauthorized" };\n', "", t(LIB, ERRORS)),
  check("a dropped connection has no sentence of its own", `${W}/api.ts`, "  if (failure.status === 0) return NETWORK_ERROR;\n", "", t(LIB, ERRORS)),
  check("the fields the Worker names for a refused bucket are dropped", `${W}/api.ts`, "fields: failure.fields ?? {}, message:", "fields: {}, message:", t(LIB, ERRORS)),

  // ---------------------------------------------- privacy of a child's application
  check(
    "a save writes the answers to the console",
    `${W}/api.ts`,
    'return settle(await api<unknown>(stepPath(step), { method: "PUT", json: body }), parseStepSaved);',
    'console.log(body);\n  return settle(await api<unknown>(stepPath(step), { method: "PUT", json: body }), parseStepSaved);',
    t(PRIVACY, RULES),
  ),
  check(
    "a save puts the answers into the address",
    `${W}/api.ts`,
    'api<unknown>(stepPath(step), { method: "PUT", json: body })',
    'api<unknown>(`${stepPath(step)}?answers=${encodeURIComponent(JSON.stringify(body))}`, { method: "PUT", json: body })',
    t(PRIVACY),
  ),

  // ---------------------------------------------- the first load
  check(
    "the wizard's page is imported by the first load, not loaded when it is opened",
    "portal-spa/src/App.tsx",
    ['import { DaftarRoute } from "./pages/daftar/DaftarRoute";', '<Route path="daftar" element={<DaftarRoute />} />'],
    ['import DaftarPage from "./pages/daftar/DaftarPage";', '<Route path="daftar" element={<DaftarPage />} />'],
    t(RULES),
  ),
  check(
    "the wizard pulls in zod (the plain rules are enough)",
    `${W}/use-wizard.ts`,
    'import { useEffect, useMemo, useRef, useState } from "react";',
    'import { useEffect, useMemo, useRef, useState } from "react";\nimport "@shared/application-form/schemas";',
    t(RULES),
  ),

  // ---------------------------------------------- accessibility
  check(
    "a new screen does not take focus on its heading",
    `${P}/Wizard.tsx`,
    '    panel.current?.querySelector<HTMLElement>("[data-step-heading]")?.focus();\n',
    "",
    t(FLOW, A11Y),
  ),
  check("the summary of what needs fixing does not take focus", `${P}/Wizard.tsx`, "    if (wizard.summaryToken > 0) summary.current?.focus();\n", "", t(A11Y, ERRORS)),
  check(
    "the save status is not a live region",
    `${P}/Wizard.tsx`,
    '<p role="status" aria-live="polite" className="mt-3 min-h-5 text-sm text-gray-600">',
    '<p className="mt-3 min-h-5 text-sm text-gray-600">',
    t(A11Y),
  ),
  check("a line of the summary does not move focus to its field", `${P}/ErrorSummary.tsx`, '? marked : marked.querySelector<HTMLElement>("input:not([disabled]), textarea, select, button:not([disabled])");', "? marked : null;", t(A11Y)),
  check("a screen not reached yet can be opened from the list", `${P}/Stepper.tsx`, "disabled={!canJump || busy}", "disabled={busy}", t(FLOW)),
  check("the list does not say which screen is the current one", `${P}/Stepper.tsx`, 'aria-current={isCurrent ? "step" : undefined}', "", t(FLOW, A11Y)),
  check(
    "a group of options is not a group (no fieldset, no legend)",
    `${P}/form.tsx`,
    '<Field group id={name} label={label} required={required} hint={hint} error={errors[name]}>\n      <div className={GRID[columns]} data-field={name}>',
    '<Field id={name} label={label} required={required} hint={hint} error={errors[name]}>\n      <div className={GRID[columns]} data-field={name}>',
    t(A11Y),
  ),

  // ---------------------------------------------- the mock holds to the contract
  check(
    "the mock accepts a step the real rules refuse",
    "portal-spa/src/mock/applications.ts",
    '    const checked = validateStep(step, body);\n    if (!checked.ok) return json({ error: "invalid"',
    '    const checked = validateStep(step, body);\n    if (false) return json({ error: "invalid"',
    t(MOCK),
  ),
  check(
    "the mock saves a step although no batch is open or the application is sent",
    "portal-spa/src/mock/applications.ts",
    "    const refused = verifiedRefusal() ?? gateRefusal();\n    if (refused) return refused;\n    const body = bodyOf(init);",
    "    const refused = verifiedRefusal();\n    if (refused) return refused;\n    const body = bodyOf(init);",
    t(MOCK),
  ),
];
