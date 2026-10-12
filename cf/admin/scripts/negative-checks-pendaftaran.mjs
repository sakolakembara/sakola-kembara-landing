// The negative checks of the Pendaftaran area (SAKEM-082: Batch, Pendaftar, Pusat Dokumen), in their own file so the
// shared list in negative-checks.mjs stays short: it imports and spreads `pendaftaranChecks`. Same rules as there: each
// check breaks ONE safeguard in the source, runs the tests that must notice, expects them to FAIL, and the runner
// restores the file. A pattern found other than exactly once is reported as FAIL, so a refactor cannot turn a check
// into a no-op.
//
//   node scripts/negative-checks.mjs --only pendaftaran
//
// The SPA's own side (hidden write affordances, the search box that says "prefix", the revocation form) is in
// negative-checks-spa-pendaftaran.mjs.

const BATCHES = "test/batches.test.ts";
const APPLICATIONS = "test/applications.test.ts";
const RESOURCES = "test/resources.test.ts";
const RULES = "test/admission-rules.test.ts";
const PLANS = "test/pendaftaran-plans.test.ts";
const CONTRACT = "test/pendaftaran-spa-contract.test.ts";

const BATCH_API = "src/api/batches.ts";
const APPLICATION_API = "src/api/applications.ts";
const RESOURCE_API = "src/api/resources.ts";
const QUERIES = "src/admission/queries.ts";
const REVIEW = "src/admission/review.ts";

/** A guard that is not the one of the Pendaftaran area, or no guard at all: the matrix of roles must notice. */
const guard = (name, file, from, to, tests) => ({ name: `pendaftaran: ${name}`, file, from, to, tests });

export const pendaftaranChecks = [
  // ------------------------------------------------------------------ who may
  guard("batches: the area check of the writes is another area's", BATCH_API, 'const write = requireArea("pendaftaran", "write");', 'const write = requireArea("komunikasi", "write");', BATCHES),
  guard("batches: the area check of the reads is another area's", BATCH_API, 'const read = requireArea("pendaftaran", "read");', 'const read = requireArea("komunikasi", "read");', BATCHES),
  guard("batches: a create only needs read access", BATCH_API, 'app.post("/", write, handlers.create);', 'app.post("/", read, handlers.create);', BATCHES),
  guard("batches: an edit only needs read access", BATCH_API, 'app.put("/:id", write, handlers.update);', 'app.put("/:id", read, handlers.update);', BATCHES),
  guard("batches: a delete only needs read access", BATCH_API, 'app.delete("/:id", write, handlers.remove);', 'app.delete("/:id", read, handlers.remove);', BATCHES),
  guard("batches: publishing the results only needs read access", BATCH_API, 'app.post("/:id/publish", write, async (c) => {', 'app.post("/:id/publish", read, async (c) => {', BATCHES),
  guard("batches: cancelling a publication only needs read access", BATCH_API, 'app.post("/:id/unpublish", write, async (c) => {', 'app.post("/:id/unpublish", read, async (c) => {', BATCHES),
  guard("batches: the list is answered to anyone", BATCH_API, 'app.get("/", read, async (c) => {', 'app.get("/", async (c) => {', BATCHES),
  guard("batches: the detail is answered to anyone", BATCH_API, 'app.get("/:id", read, async (c) => {', 'app.get("/:id", async (c) => {', BATCHES),

  guard("applications: the area check of the review is another area's", APPLICATION_API, 'const write = requireArea("pendaftaran", "write");', 'const write = requireArea("komunikasi", "write");', APPLICATIONS),
  guard("applications: the area check of the reads is another area's", APPLICATION_API, 'const read = requireArea("pendaftaran", "read");', 'const read = requireArea("komunikasi", "read");', APPLICATIONS),
  guard("applications: the review only needs read access", APPLICATION_API, 'app.post("/:id/status", write, async (c) => {', 'app.post("/:id/status", read, async (c) => {', APPLICATIONS),
  guard("applications: the list is answered to anyone", APPLICATION_API, 'app.get("/", read, async (c) => {', 'app.get("/", async (c) => {', APPLICATIONS),
  guard("applications: the detail is answered to anyone", APPLICATION_API, 'app.get("/:id", read, async (c) => {', 'app.get("/:id", async (c) => {', APPLICATIONS),

  guard("resources: the area check of the writes is another area's", RESOURCE_API, 'const write = requireArea("pendaftaran", "write");', 'const write = requireArea("komunikasi", "write");', RESOURCES),
  guard("resources: the area check of the reads is another area's", RESOURCE_API, 'const read = requireArea("pendaftaran", "read");', 'const read = requireArea("komunikasi", "read");', RESOURCES),
  guard("resources: a create only needs read access", RESOURCE_API, 'app.post("/", write, handlers.create);', 'app.post("/", read, handlers.create);', RESOURCES),
  guard("resources: an edit only needs read access", RESOURCE_API, 'app.put("/:id", write, handlers.update);', 'app.put("/:id", read, handlers.update);', RESOURCES),
  guard("resources: a delete only needs read access", RESOURCE_API, 'app.delete("/:id", write, handlers.remove);', 'app.delete("/:id", read, handlers.remove);', RESOURCES),
  guard("resources: the list is answered to anyone", RESOURCE_API, 'app.get("/", read, async (c) => {', 'app.get("/", async (c) => {', RESOURCES),

  // ------------------------------------------------------------- concurrency
  {
    name: "pendaftaran: the review's stale check is removed (the last decision silently wins)",
    file: APPLICATION_API,
    from: "if (!matches(precondition, before.updatedAt)) return stale(c);",
    to: "",
    tests: `${APPLICATIONS} ${CONTRACT}`,
  },
  {
    name: "pendaftaran: the version is not part of the review's UPDATE (a decision made in between is overwritten)",
    file: APPLICATION_API,
    from: ".where(and(eq(studentApplications.id, id), eq(studentApplications.updatedAt, before.updatedAt)))",
    to: ".where(eq(studentApplications.id, id))",
    tests: APPLICATIONS,
  },
  {
    name: "pendaftaran: the review no longer needs If-Match",
    file: APPLICATION_API,
    from: "if (!precondition.present) return preconditionRequired(c);",
    to: "",
    tests: `${APPLICATIONS} ${CONTRACT}`,
  },

  // ------------------------------------------------------ the legacy review rules
  {
    name: "pendaftaran: a revocation needs no long reason (accepted -> rejected with one word)",
    file: REVIEW,
    from: "if (isRevocation(previous, input.status) && input.reviewNotes.length < REVOCATION_NOTES_MIN) {",
    to: "if (false) {",
    tests: `${RULES} ${APPLICATIONS} ${CONTRACT}`,
  },
  {
    name: "pendaftaran: accepting or rejecting needs no note",
    file: REVIEW,
    from: '.refine((value) => value.status === "pending" || value.status === "under_review" || value.reviewNotes.length > 0, {',
    to: ".refine(() => true, {",
    tests: `${RULES} ${APPLICATIONS} ${CONTRACT}`,
  },
  {
    name: "pendaftaran: a revocation is logged as an ordinary rejection",
    file: REVIEW,
    from: 'return isRevocation(previous, next) ? "application.revoke" : `application.${next}`;',
    to: "return `application.${next}`;",
    tests: `${RULES} ${APPLICATIONS}`,
  },
  {
    name: "pendaftaran: the audit row of a review carries the note (applicant data in the audit log)",
    file: APPLICATION_API,
    from: '{ action: reviewAction(before.status, body.data.status), resourceType: "application", resourceId: id, fields: REVIEW_FIELDS },',
    to: '{ action: reviewAction(before.status, body.data.status), resourceType: "application", resourceId: id, fields: REVIEW_FIELDS, label: body.data.reviewNotes },',
    tests: APPLICATIONS,
  },

  // -------------------------------------------------------------- batch rules
  {
    name: "pendaftaran: a batch with applications can be deleted (the in-use guard is removed: the foreign key is a 500)",
    file: BATCH_API,
    from: '      inUse: { usedBy: ["Pendaftar"], message: MESSAGES.inUse },\n',
    to: "",
    tests: BATCHES,
  },
  {
    name: "pendaftaran: a taken year is no longer a 409 on the year field",
    file: BATCH_API,
    from: '      unique: { "admission_batches.year": { field: "year", message: "Tahun sudah dipakai batch lain" } },\n',
    to: "",
    tests: `${BATCHES} ${CONTRACT}`,
  },
  {
    name: "pendaftaran: a batch may start before 2024",
    file: BATCH_API,
    from: '      .gte(2024, "Tahun terlalu jauh ke belakang")\n',
    to: "\n",
    tests: BATCHES,
  },
  {
    name: "pendaftaran: a batch may close before it opens",
    file: BATCH_API,
    from: "return closesAt.getTime() > opensAt.getTime();",
    to: "return true;",
    tests: BATCHES,
  },

  // ------------------------------------------------------------ publishing
  {
    name: "pendaftaran: the publish preconditions are gone (checked neither before the write nor in it): anything is published",
    edits: [
      { file: BATCH_API, from: "if (refusal) return fail(c, 409, refusal.code, refusal.message, refusal.extra);", to: "" },
      { file: BATCH_API, from: "              sql`exists (select 1 from student_applications where student_applications.batch_id = ${id})`,\n", to: "" },
      {
        file: BATCH_API,
        from: "              sql`not exists (select 1 from student_applications where student_applications.batch_id = ${id} and student_applications.status in ('pending', 'under_review'))`,\n",
        to: "",
      },
    ],
    tests: `${BATCHES} ${CONTRACT}`,
  },
  {
    name: "pendaftaran: the publish rule is not part of the UPDATE (an applicant sent back to pending after the check is published over)",
    edits: [
      { file: BATCH_API, from: "              sql`exists (select 1 from student_applications where student_applications.batch_id = ${id})`,\n", to: "" },
      {
        file: BATCH_API,
        from: "              sql`not exists (select 1 from student_applications where student_applications.batch_id = ${id} and student_applications.status in ('pending', 'under_review'))`,\n",
        to: "",
      },
    ],
    tests: BATCHES,
  },
  {
    name: "pendaftaran: a published batch is published again (the first check of the legacy action is gone)",
    file: BATCH_API,
    from: '  if (detail.resultsPublishedAt) return { code: "already_published", message: MESSAGES.alreadyPublished, extra: {} };\n',
    to: "",
    tests: `${BATCHES} ${RULES}`,
  },
  {
    name: "pendaftaran: a batch nobody applied to can be published (the 'no applicants' rule is gone)",
    file: BATCH_API,
    from: '  if (detail.counts.total === 0) return { code: "no_applicants", message: MESSAGES.noApplicants, extra: {} };\n',
    to: "",
    tests: `${BATCHES} ${RULES}`,
  },
  {
    name: "pendaftaran: a batch with undecided applicants can be published (the 'undecided' rule is gone)",
    file: BATCH_API,
    from: '  if (undecided > 0) return { code: "undecided", message: MESSAGES.undecided(undecided), extra: { undecided } };\n',
    to: "",
    tests: `${BATCHES} ${RULES}`,
  },

  // ----------------------------------------------------- the search: a prefix
  {
    name: "pendaftaran: the name search is a contains (`%q%`: a scan of the table)",
    file: QUERIES,
    from: "const pattern = `${escapeLike(candidate)}%`;",
    to: "const pattern = `%${escapeLike(candidate)}%`;",
    tests: `${APPLICATIONS} ${PLANS} ${RULES}`,
  },
  {
    name: "pendaftaran: the email search is a contains",
    file: QUERIES,
    from: "sql`${studentApplications.email} >= ${lower}`",
    to: "sql`${studentApplications.email} like ${`%${lower}%`}`",
    tests: `${APPLICATIONS} ${PLANS}`,
  },
  {
    name: "pendaftaran: the LIKE wildcards of a search are not escaped",
    file: QUERIES,
    from: "const pattern = `${escapeLike(candidate)}%`;",
    to: "const pattern = `${candidate}%`;",
    tests: `${APPLICATIONS} ${RULES}`,
  },
  {
    name: "pendaftaran: a search is ignored",
    file: QUERIES,
    from: 'if (text === "") return undefined;',
    to: "return undefined;",
    tests: APPLICATIONS,
  },
  {
    name: "pendaftaran: the batch filter of the applicants is not applied",
    file: APPLICATION_API,
    from: "return raw.length <= 128 ? { ok: true, where: eq(studentApplications.batchId, raw) } : { ok: false };",
    to: "return { ok: true, where: sql`1 = 1` };",
    tests: `${APPLICATIONS} ${CONTRACT}`,
  },

  // ------------------------------------------------------------------ budget
  {
    name: "pendaftaran: the applicants list asks D1 twice (the page and the total are two round trips)",
    file: APPLICATION_API,
    from: "const [rows, totals] = await db.batch([applicationsPageQuery(db, query), applicationsTotalQuery(db, query)]);",
    to: "const rows = await applicationsPageQuery(db, query); const totals = await applicationsTotalQuery(db, query);",
    tests: PLANS,
  },
  {
    name: "pendaftaran: the page of a batch reads in three round trips",
    file: BATCH_API,
    from: "const [rows, grouped, recent] = await db.batch([batchQuery(db, id), batchStatusCountsQuery(db, id), batchRecentApplicantsQuery(db, id, RECENT_APPLICANTS)]);",
    to: "const rows = await batchQuery(db, id); const grouped = await batchStatusCountsQuery(db, id); const recent = await batchRecentApplicantsQuery(db, id, RECENT_APPLICANTS);",
    tests: PLANS,
  },

  // ------------------------------------------------------------- Pusat Dokumen
  {
    name: "pendaftaran: a change to a document does not tell the public page",
    file: RESOURCE_API,
    from: '      purge: { area: "resources" },\n',
    to: "",
    tests: RESOURCES,
  },
  {
    name: "pendaftaran: the file of a replaced or deleted document stays in the bucket",
    file: RESOURCE_API,
    from: "      uploads: (row) => [row.filePath],\n",
    to: "",
    tests: RESOURCES,
  },
  {
    name: "pendaftaran: a link of any scheme is stored (`javascript:` in the public page)",
    file: RESOURCE_API,
    from: 'return protocol === "https:" || protocol === "http:";',
    to: "return true;",
    tests: RESOURCES,
  },
  {
    name: "pendaftaran: a document keeps the link of another shape (the table's CHECK is a 500)",
    file: RESOURCE_API,
    from: 'externalUrl: input.contentType === "url" ? input.externalUrl : null,',
    to: "externalUrl: input.externalUrl,",
    tests: RESOURCES,
  },
  {
    name: "pendaftaran: the documents are listed in the alphabet of their category, not the page's order",
    file: RESOURCE_API,
    from: 'const order = query.sort === "category" ? [categoryRank(), asc(siteResources.displayOrder), asc(siteResources.createdAt), asc(siteResources.id)] : query.order;',
    to: "const order = query.order;",
    tests: RESOURCES,
  },
  {
    name: "pendaftaran: a file path of another kind of upload is accepted",
    file: RESOURCE_API,
    from: "} else if (!isAllowedFilePath(data.filePath, FILE_KINDS)) {",
    to: "} else if (false) {",
    tests: RESOURCES,
  },
  {
    name: "pendaftaran: a document may be larger than 25 MB",
    file: RESOURCE_API,
    from: '      .max(MAX_FILE_BYTES, "Ukuran file maksimal 25 MB.")\n',
    to: "\n",
    tests: RESOURCES,
  },

  // ----------------------------------------- the SPA and the Worker agree (the Worker's side)
  {
    name: "pendaftaran: the SPA lists a document category the Worker does not have",
    file: "spa/src/pages/resources/model.ts",
    from: 'export const CATEGORIES = ["panduan", "berkas-pendaftaran", "berkas-marketing", "tutorial", "lainnya"] as const;',
    to: 'export const CATEGORIES = ["panduan", "berkas-pendaftaran", "berkas-marketing", "tutorial", "lainnya", "baru"] as const;',
    tests: CONTRACT,
  },
  {
    name: "pendaftaran: the SPA's revocation minimum is not the Worker's",
    file: "spa/src/pages/applications/model.ts",
    from: "export const REVOCATION_NOTES_MIN = 20;",
    to: "export const REVOCATION_NOTES_MIN = 10;",
    tests: CONTRACT,
  },
  {
    name: "pendaftaran: the SPA has a batch phase tag the Worker never gives",
    file: "spa/src/pages/batches/model.ts",
    from: '  published: { label: "Hasil dipublikasikan", tone: "soft" },\n',
    to: '  published: { label: "Hasil dipublikasikan", tone: "soft" },\n  archived: { label: "Diarsipkan", tone: "gray" },\n',
    tests: CONTRACT,
  },
  {
    name: "pendaftaran: the SPA sorts applicants by a name the Worker does not know",
    file: "spa/src/pages/applications/model.ts",
    from: '  sorts: ["submittedAt", "fullName"],',
    to: '  sorts: ["submittedAt", "fullName", "whatsapp"],',
    tests: CONTRACT,
  },
];
