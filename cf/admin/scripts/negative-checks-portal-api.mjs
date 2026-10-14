// The negative checks of the student's application API (SAKEM-083, P1b), in their own file so the shared list in
// negative-checks.mjs stays short: it imports and spreads `portalApiChecks`. Same rules as there: each check breaks ONE
// safeguard in the source, runs the tests that must notice, expects them to FAIL, and the runner restores the file. A
// pattern found other than exactly once is reported as FAIL, so a refactor cannot turn a check into a no-op. A check is
// either one edit (file, from, to) or a list of `edits`.
//
//   node scripts/negative-checks.mjs --only "portal api:"

const READS = "test/portal-applications.test.ts";
const STEPS = "test/portal-applications-steps.test.ts";
const SUBMIT = "test/portal-applications-submit.test.ts";
const STATUS = "test/portal-applications-status.test.ts";
const RULES = "test/portal-applications-rules.test.ts";
const EMAIL = "test/portal-applications-email.test.ts";
const PLANS = "test/portal-applications-plans.test.ts";

export const portalApiChecks = [
  // ------------------------------------------------ the privacy contract: no verdict before publication, in two places
  {
    name: "portal api: the rule shows a verdict whatever the batch's publication (resultOf ignores results_published_at)",
    file: "src/portal/rules.ts",
    from: "if (row.publishedAt === null) return { state: \"processing\" };",
    to: "if (row.status === null) return { state: \"processing\" };",
    // The query still hands over NULLs for an unpublished batch, so only the rule's own tests notice: that is the point of having two places.
    tests: `${RULES} ${STATUS}`,
  },
  {
    name: "portal api: the status query hands over the status of an unpublished batch",
    file: "src/portal/queries.ts",
    from: "case when ${B.resultsPublishedAt} is not null then ${A.status} end",
    to: "${A.status}",
    tests: STATUS,
  },
  {
    name: "portal api: the status query hands over the review note of an unpublished batch",
    file: "src/portal/queries.ts",
    from: "case when ${B.resultsPublishedAt} is not null then ${A.reviewNotes} end",
    to: "${A.reviewNotes}",
    tests: STATUS,
  },
  {
    name: "portal api: the review note is shown untrimmed (a blank note is not null)",
    file: "src/portal/rules.ts",
    from: "const notes = row.reviewNotes?.trim();",
    to: "const notes = row.reviewNotes;",
    tests: `${RULES} ${STATUS}`,
  },

  // ------------------------------------------------ ownership: every query takes the student from the session
  {
    name: "portal api: the open-batch state joins the application of ANY student (another student's application closes the door)",
    file: "src/portal/queries.ts",
    from: ".select(stateColumns)\n    .from(B)\n    .leftJoin(A, and(eq(A.batchId, B.id), eq(A.userId, userId)))",
    to: ".select(stateColumns)\n    .from(B)\n    .leftJoin(A, eq(A.batchId, B.id))",
    tests: READS,
  },
  {
    name: "portal api: the open-batch state joins the draft of ANY student (the bootstrap shows another student's draft)",
    file: "src/portal/queries.ts",
    from: ".select({ ...stateColumns, formData: D.formData })\n    .from(B)\n    .leftJoin(A, and(eq(A.batchId, B.id), eq(A.userId, userId)))\n    .leftJoin(D, and(eq(D.batchId, B.id), eq(D.userId, userId)))",
    to: ".select({ ...stateColumns, formData: D.formData })\n    .from(B)\n    .leftJoin(A, and(eq(A.batchId, B.id), eq(A.userId, userId)))\n    .leftJoin(D, eq(D.batchId, B.id))",
    tests: `${READS} ${STEPS}`,
  },
  {
    name: "portal api: the status page lists the applications of every student",
    file: "src/portal/queries.ts",
    from: ".where(eq(A.userId, userId))\n    .orderBy(desc(A.submittedAt), asc(A.id));\n\n// ─── Files",
    to: ".where(sql`1 = 1`)\n    .orderBy(desc(A.submittedAt), asc(A.id));\n\n// ─── Files",
    tests: `${STATUS} ${READS}`,
  },
  {
    name: "portal api: the home history lists the applications of every student",
    file: "src/portal/queries.ts",
    from: ".where(eq(A.userId, userId))\n    .orderBy(desc(A.submittedAt), asc(A.id));\n\n/**\n * The status page",
    to: ".where(sql`1 = 1`)\n    .orderBy(desc(A.submittedAt), asc(A.id));\n\n/**\n * The status page",
    tests: READS,
  },
  {
    name: "portal api: a deleted file is listed as a live one",
    file: "src/portal/queries.ts",
    from: ".from(F)\n    .where(and(eq(F.applicationId, applicationId), isNull(F.deletedAt)));\n\n/** How many",
    to: ".from(F)\n    .where(eq(F.applicationId, applicationId));\n\n/** How many",
    tests: READS,
  },
  {
    name: "portal api: the files of the draft are not told from the files of other applications",
    file: "src/portal/queries.ts",
    from: ".from(F)\n    .where(and(eq(F.applicationId, applicationId), isNull(F.deletedAt)));\n\n/** How many",
    to: ".from(F)\n    .where(isNull(F.deletedAt));\n\n/** How many",
    tests: READS,
  },

  // ------------------------------------------------ the gate (6.2)
  {
    name: "portal api: the batch is still open AT closes_at (the window is closed at the closing time, not after it)",
    file: "src/portal/queries.ts",
    from: "const openAt = (now: Date) => and(lte(B.opensAt, now), gt(B.closesAt, now));",
    to: "const openAt = (now: Date) => and(lte(B.opensAt, now), gte(B.closesAt, now));",
    tests: READS,
  },
  {
    name: "portal api: the batch is not yet open AT opens_at",
    file: "src/portal/queries.ts",
    from: "const openAt = (now: Date) => and(lte(B.opensAt, now), gt(B.closesAt, now));",
    to: "const openAt = (now: Date) => and(sql`${B.opensAt} < ${now.getTime()}`, gt(B.closesAt, now));",
    tests: READS,
  },
  {
    name: "portal api: the latest batch does not win when two are open (the oldest opens_at does)",
    file: "src/portal/queries.ts",
    from: ".select(stateColumns)\n    .from(B)\n    .leftJoin(A, and(eq(A.batchId, B.id), eq(A.userId, userId)))\n    .leftJoin(D, and(eq(D.batchId, B.id), eq(D.userId, userId)))\n    .where(openAt(now))\n    .orderBy(desc(B.opensAt))",
    to: ".select(stateColumns)\n    .from(B)\n    .leftJoin(A, and(eq(A.batchId, B.id), eq(A.userId, userId)))\n    .leftJoin(D, and(eq(D.batchId, B.id), eq(D.userId, userId)))\n    .where(openAt(now))\n    .orderBy(asc(B.opensAt))",
    tests: READS,
  },
  {
    name: "portal api: a draft of a closed batch is told no_open_batch instead of batch_closed",
    file: "src/portal/rules.ts",
    from: "return hasOtherDraft ? { error: \"batch_closed\", message: MESSAGES.batchClosed } : { error: \"no_open_batch\", message: MESSAGES.noOpenBatch };",
    to: "return { error: \"no_open_batch\", message: MESSAGES.noOpenBatch };",
    tests: `${STEPS} ${SUBMIT} ${RULES}`,
  },
  {
    name: "portal api: a step is saved without the gate (the refusal of a closed door is dropped)",
    file: "src/portal/applications.ts",
    from: "if (!gate.ok) return gate.response;\n\n    const body = await readJsonBody(c, STEP_BODY_MAX_BYTES);",
    to: "\n    const body = await readJsonBody(c, STEP_BODY_MAX_BYTES);",
    tests: STEPS,
  },
  {
    name: "portal api: the statement of a step save does not check that the batch is still open",
    file: "src/portal/queries.ts",
    from: "WHERE EXISTS (SELECT 1 FROM admission_batches WHERE id = ?3 AND opens_at <= ?6 AND closes_at > ?6)\n  AND NOT EXISTS",
    to: "WHERE EXISTS (SELECT 1 FROM admission_batches WHERE id = ?3)\n  AND NOT EXISTS",
    tests: STEPS,
  },
  {
    name: "portal api: the statement of a step save does not check that the student has no application",
    file: "src/portal/queries.ts",
    from: "\n  AND NOT EXISTS (SELECT 1 FROM student_applications WHERE user_id = ?2 AND batch_id = ?3)\nON CONFLICT",
    to: "\nON CONFLICT",
    tests: STEPS,
  },

  // ------------------------------------------------ saving a step (8)
  {
    name: "portal api: a step save replaces the whole form_data instead of its own bucket",
    file: "src/portal/queries.ts",
    from: "form_data = json_set(form_data, ?7, json(?5)),",
    to: "form_data = json_object(?4, json(?5)),",
    tests: STEPS,
  },
  {
    name: "portal api: the draft's version can stay the same when two saves land in one millisecond",
    file: "src/portal/queries.ts",
    from: "updated_at = max(?6, updated_at + 1)",
    to: "updated_at = ?6",
    tests: STEPS,
  },
  {
    name: "portal api: a body that is not JSON is read (no 415 json_required)",
    file: "src/portal/applications.ts",
    from: "if (!c.req.header(\"content-type\")?.toLowerCase().startsWith(\"application/json\")) return { ok: false, response: refuse(c, 415, \"json_required\") };",
    to: "",
    tests: `${STEPS} ${SUBMIT}`,
  },
  {
    name: "portal api: a body is read whatever its size (the stream is not cut at the limit)",
    file: "src/portal/applications.ts",
    from: "if (size > maxBytes) {",
    to: "if (size > maxBytes * 1000) {",
    tests: `${STEPS} ${SUBMIT}`,
  },
  {
    name: "portal api: the DTKS file stays when the student says they are not registered (the cleanup follows ya)",
    file: "src/portal/queries.ts",
    from: "json_extract(form_data, '$.documents.dtksRegistered') = 'tidak')`;",
    to: "json_extract(form_data, '$.documents.dtksRegistered') = 'ya')`;",
    tests: STEPS,
  },
  {
    name: "portal api: the bytes of a removed DTKS file are not given back to the storage counter",
    file: "src/portal/queries.ts",
    from: "d1.prepare(RELEASE_REMOVABLE_DTKS).bind(...own, nowMs), ",
    to: "",
    tests: STEPS,
  },
  {
    name: "portal api: the object of a removed DTKS file is not deleted from the private bucket",
    file: "src/portal/applications.ts",
    from: "if (saved.removed.length > 0) c.executionCtx.waitUntil(removeDtksObjects(c.env, gate.state.batch.year, saved.draft.id, saved.removed));",
    to: "",
    tests: STEPS,
  },

  // ------------------------------------------------ the submit (9)
  {
    name: "portal api: the submit checks the buckets in the wrong order",
    file: "src/portal/rules.ts",
    from: "for (const step of STEP_IDS) {\n    const bucket = formData[step];",
    to: "for (const step of [...STEP_IDS].reverse()) {\n    const bucket = formData[step];",
    tests: `${SUBMIT} ${RULES}`,
  },
  {
    name: "portal api: the submit does not check the marketing proofs (only the documents' files)",
    file: "src/portal/rules.ts",
    from: 'if (step === "documents" || step === "marketing") {',
    to: 'if (step === "documents") {',
    tests: `${SUBMIT} ${RULES}`,
  },
  {
    name: "portal api: the anti-duplicate window is zero (a number sent a minute ago is not a duplicate)",
    file: "src/portal/rules.ts",
    from: "export const DUPLICATE_WINDOW_MS = 60 * 60 * 1000;",
    to: "export const DUPLICATE_WINDOW_MS = 0;",
    tests: `${SUBMIT} ${RULES}`,
  },
  {
    name: "portal api: the submit's write does not hold on to the version the answers were validated at (a step saved since is overwritten)",
    file: "src/portal/queries.ts",
    from: "WHERE d.id = ?1 AND d.user_id = ?2 AND d.batch_id = ?14 AND d.updated_at = ?11",
    to: "WHERE d.id = ?1 AND d.user_id = ?2 AND d.batch_id = ?14",
    tests: SUBMIT,
  },
  {
    name: "portal api: the submit's audit row is written even when the application was not inserted",
    file: "src/portal/queries.ts",
    from: "SELECT ?12, ?2, ?4, 'application.submit', 'application', ?1, ?13\nWHERE EXISTS (SELECT 1 FROM application_drafts WHERE id = ?1 AND updated_at = ?11)\n  AND EXISTS (SELECT 1 FROM student_applications WHERE id = ?1)`;",
    to: "SELECT ?12, ?2, ?4, 'application.submit', 'application', ?1, ?13`;",
    tests: SUBMIT,
  },
  {
    name: "portal api: the draft is deleted even when the application was not inserted",
    file: "src/portal/queries.ts",
    from: "DELETE FROM application_drafts WHERE id = ?1 AND updated_at = ?11 AND EXISTS (SELECT 1 FROM student_applications WHERE id = ?1)",
    to: "DELETE FROM application_drafts WHERE id = ?1",
    tests: SUBMIT,
  },
  {
    name: "portal api: the audit row of a submit carries the school (an answer) besides the ids",
    file: "src/portal/queries.ts",
    from: "const metadata = JSON.stringify({ batchId: input.batchId, batchYear: input.batchYear });",
    to: "const metadata = JSON.stringify({ batchId: input.batchId, batchYear: input.batchYear, schoolName: input.columns.schoolName });",
    tests: SUBMIT,
  },
  {
    name: "portal api: the agreement is stored as the text the builder hands over (the admin's screen would show 'Tidak')",
    file: "src/portal/rules.ts",
    from: "return { ...built, interview: { ...built.interview, agreedToSignedStatement: true } };",
    to: "return built as never;",
    tests: `${SUBMIT} ${RULES}`,
  },
  {
    name: "portal api: a second application for the pair is a server error instead of already_submitted (the unique index is not handled)",
    file: "src/portal/applications.ts",
    from: 'if (!isUniqueViolation(error, "student_applications.user_id, student_applications.batch_id")) throw error;',
    to: "throw error;",
    tests: SUBMIT,
  },
  {
    name: "portal api: the confirmation is sent before the answer (not after it, with waitUntil)",
    file: "src/portal/applications.ts",
    from: "    c.executionCtx.waitUntil(\n      sendEmail(c.env, applicationReceivedEmail(",
    to: "    await Promise.resolve(\n      sendEmail(c.env, applicationReceivedEmail(",
    tests: SUBMIT,
  },

  // ------------------------------------------------ the email budget (portal-architecture.md, 9.2)
  {
    name: "portal api: the confirmation is not held back at 80 (it is counted up to 100 like the others)",
    file: "src/email/send.ts",
    from: 'const OPTIONAL_CEILING: Partial<Record<EmailPurpose, number>> = { "application-received": EMAIL_CONFIRMATION_CEILING };',
    to: "const OPTIONAL_CEILING: Partial<Record<EmailPurpose, number>> = {};",
    tests: EMAIL,
  },
  {
    name: "portal api: the counter takes past the limit (the statement has no ceiling)",
    file: "src/email/send.ts",
    from: "ON CONFLICT (day) DO UPDATE SET sent = sent + 1 WHERE sent < ?2 RETURNING sent",
    to: "ON CONFLICT (day) DO UPDATE SET sent = sent + 1 RETURNING sent",
    tests: EMAIL,
  },
  {
    name: "portal api: an email that goes out through Resend is not counted",
    file: "src/email/send.ts",
    from: '  if (env.DB && !(await reserveSlot(env.DB, message.purpose))) return { ok: false, reason: "daily_budget" };\n\n  try {',
    to: "  try {",
    tests: EMAIL,
  },
  {
    name: "portal api: registration is not refused when the day's emails are spent",
    file: "src/auth/gate.ts",
    from: "basePath === STUDENT_AUDIENCE.basePath && (await emailQuotaSpent(c.env))",
    to: "basePath === STUDENT_AUDIENCE.basePath && (await emailQuotaSpent(c.env)) && false",
    tests: EMAIL,
  },
  {
    name: "portal api: the admin's own account routes are refused when the day's emails are spent (the quota is the portal's)",
    file: "src/auth/gate.ts",
    from: "policy.sendsEmail && basePath === STUDENT_AUDIENCE.basePath && (await emailQuotaSpent(c.env))",
    to: "policy.sendsEmail && (await emailQuotaSpent(c.env))",
    tests: EMAIL,
  },

  // ------------------------------------------------ the cost (portal-architecture.md, 10)
  {
    name: "portal api: the Drizzle handle is built again on every request (no cache)",
    file: "src/portal/queries.ts",
    from: "  let db = handles.get(d1);\n  if (!db) {",
    to: "  let db = handles.get(d1);\n  handles.delete(d1);\n  db = undefined;\n  if (!db) {",
    tests: PLANS,
  },
];
