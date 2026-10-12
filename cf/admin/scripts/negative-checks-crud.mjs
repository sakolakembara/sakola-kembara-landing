// The negative checks of the admin CRUD kit (SAKEM-082), in their own file so the shared list in
// negative-checks.mjs stays short: it imports and spreads `crudChecks`. Same rules as there: each check breaks ONE
// safeguard in the source, runs the tests that must notice, expects them to FAIL, and the runner restores the
// file. A pattern found other than exactly once is reported as FAIL, so a refactor cannot turn a check into a no-op.
//
//   node scripts/negative-checks.mjs --only crud
//
// The SPA's own side (hidden write buttons, the unsaved guard, the upload limits in the browser) is in
// negative-checks-spa-crud.mjs.

const CONTRACT = "test/crud-contract.test.ts";
const HELPERS = "test/crud-helpers.test.ts";
const AUDIT = "test/crud-audit.test.ts";
const ANNOUNCEMENTS = "test/announcements.test.ts";
const SPA_CONTRACT = "test/crud-spa-contract.test.ts";

export const crudChecks = [
  // ------------------------------------------------------------------ who may
  {
    name: "crud: an update only needs read access",
    file: "src/api/crud/resource.ts",
    from: 'app.put("/:id", requireArea(config.area, "write"), handlers.update);',
    to: 'app.put("/:id", requireArea(config.area, "read"), handlers.update);',
    tests: `${CONTRACT} ${ANNOUNCEMENTS}`,
  },
  {
    name: "crud: a delete only needs read access",
    file: "src/api/crud/resource.ts",
    from: 'app.delete("/:id", requireArea(config.area, "write"), handlers.remove);',
    to: 'app.delete("/:id", requireArea(config.area, "read"), handlers.remove);',
    tests: `${CONTRACT} ${ANNOUNCEMENTS}`,
  },
  {
    name: "crud: the list is answered to anyone (no area guard on reads)",
    file: "src/api/crud/resource.ts",
    from: 'app.get("/", requireArea(config.area, "read"), handlers.list);',
    to: 'app.get("/", handlers.list);',
    tests: `${CONTRACT} ${ANNOUNCEMENTS}`,
  },
  {
    name: "crud: a resource of the sistem area is guarded by the area of another (the config's area is ignored for writes)",
    file: "src/api/crud/resource.ts",
    from: 'if (routes.create !== false) app.post("/", requireArea(config.area, "write"), handlers.create);',
    to: 'if (routes.create !== false) app.post("/", requireArea("komunikasi", "write"), handlers.create);',
    tests: CONTRACT,
  },

  // --------------------------------------------------------------- concurrency
  {
    name: "crud: the stale check removed (the last save silently wins)",
    file: "src/api/crud/resource.ts",
    from: "if (!matches(precondition, current)) return stale(c);",
    to: "",
    tests: `${CONTRACT} ${ANNOUNCEMENTS}`,
  },
  {
    name: "crud: the version is not part of the UPDATE (two saves of one version can both win)",
    file: "src/api/crud/resource.ts",
    from: ".where(and(eq(idColumn, id), eq(versionColumn, current)))",
    to: ".where(eq(idColumn, id))",
    tests: CONTRACT,
  },
  {
    name: "crud: If-Match is no longer required on an update",
    file: "src/api/crud/resource.ts",
    from: "if (!precondition.present) return preconditionRequired(c);",
    to: "",
    tests: `${CONTRACT} ${ANNOUNCEMENTS}`,
  },
  {
    name: "crud: a stale If-Match on a delete is ignored",
    file: "src/api/crud/resource.ts",
    from: "if (precondition.present && (!current || !matches(precondition, current))) return stale(c);",
    to: "",
    tests: CONTRACT,
  },
  {
    name: "crud: a save that changed nothing still writes (and bumps the version)",
    file: "src/api/crud/resource.ts",
    from: "if (fields.length === 0) {",
    to: "if (false) {",
    tests: CONTRACT,
  },
  {
    name: "crud: the next version is not later than the previous (two saves in one millisecond share an ETag)",
    file: "src/api/crud/concurrency.ts",
    from: "return new Date(Math.max(now.getTime(), previous.getTime() + 1));",
    to: "return now;",
    tests: HELPERS,
  },
  {
    name: "crud: the ETag header is not sent",
    file: "src/api/crud/resource.ts",
    from: 'if (version) c.header("ETag", etagOf(version));',
    to: "",
    tests: `${CONTRACT} ${ANNOUNCEMENTS} ${SPA_CONTRACT}`,
  },
  {
    name: "crud: the SPA builds an If-Match the Worker does not recognise",
    file: "spa/src/lib/crud/etag.ts",
    from: "return `\"${updatedAt}\"`;",
    to: "return updatedAt;",
    tests: SPA_CONTRACT,
  },

  // ---------------------------------------------------------------- validation
  {
    name: "crud: the body is no longer validated against its schema",
    file: "src/api/crud/validation.ts",
    from: "if (!parsed.success) {",
    to: "if (false) {",
    tests: `${CONTRACT} ${HELPERS} ${ANNOUNCEMENTS}`,
  },
  {
    name: "crud: a validation error loses its fields",
    file: "src/api/crud/validation.ts",
    from: "return { ok: false, response: validationError(c, fields, form) };",
    to: "return { ok: false, response: validationError(c, {}, form) };",
    tests: `${CONTRACT} ${HELPERS} ${ANNOUNCEMENTS}`,
  },
  {
    name: "crud: a body that is not application/json is read anyway (a cross-site form post could write)",
    file: "src/api/crud/validation.ts",
    from: 'if (!c.req.header("content-type")?.toLowerCase().startsWith("application/json")) return { ok: false, response: jsonRequired(c) };',
    to: "",
    tests: `${CONTRACT} ${HELPERS} ${ANNOUNCEMENTS}`,
  },
  {
    name: "crud: the size of a JSON body is not limited",
    edits: [
      { file: "src/api/crud/validation.ts", from: "Number(declared) > maxBytes", to: "false" },
      { file: "src/api/crud/validation.ts", from: "if (text.length > maxBytes) return { ok: false, response: tooLarge(c, maxBytes) };", to: "" },
    ],
    tests: `${CONTRACT} ${HELPERS}`,
  },
  {
    name: "crud: a file path of another kind is accepted in a form",
    file: "src/api/crud/validation.ts",
    from: "return kind !== null && kinds.includes(kind);",
    to: "return kind !== null;",
    tests: `${CONTRACT} ${HELPERS}`,
  },
  {
    name: "crud: a legacy path with .. is accepted in a form",
    file: "src/api/crud/validation.ts",
    from: 'return legacy && LEGACY_STATIC_PATH.test(value) && !value.includes("..");',
    to: "return legacy && LEGACY_STATIC_PATH.test(value);",
    tests: `${CONTRACT} ${HELPERS}`,
  },
  {
    name: "crud: a missing field is reported in zod's English",
    file: "src/api/crud/validation.ts",
    from: "if (ZOD_DEFAULT.test(message)) {",
    to: "if (false) {",
    tests: `${HELPERS} ${ANNOUNCEMENTS}`,
  },

  // --------------------------------------------------------------------- audit
  {
    name: "crud: the audit row is written outside the transaction of the change",
    file: "src/api/crud/audit.ts",
    from: "const results: readonly unknown[] = await db.batch([...statements, audit] as [SqliteBatchItem, ...SqliteBatchItem[]]);\n  return results.slice(0, -1);",
    to: "const results: readonly unknown[] = await db.batch(statements as [SqliteBatchItem, ...SqliteBatchItem[]]);\n  await audit;\n  return results;",
    tests: `${AUDIT} ${CONTRACT} ${ANNOUNCEMENTS}`,
  },
  {
    name: "crud: the audit row is written even when the change took no effect (a lost race leaves a row)",
    file: "src/api/crud/audit.ts",
    from: " where changes() > 0`);",
    to: "`);",
    tests: `${AUDIT} ${CONTRACT}`,
  },
  {
    name: "crud: the audit label carries the whole body (personal data in the log)",
    file: "src/api/crud/resource.ts",
    from: 'fields: Object.keys(values).filter((key) => key !== "id" && key !== "createdBy"), label: labelOf(values) },',
    to: 'fields: Object.keys(values).filter((key) => key !== "id" && key !== "createdBy"), label: JSON.stringify(values) },',
    tests: CONTRACT,
  },
  {
    name: "crud: an update's audit row names every field, not only the ones that changed",
    file: "src/api/crud/resource.ts",
    from: "{ action: action(\"update\"), resourceType: config.audit.type, resourceId: id, fields, label: labelOf({ ...before, ...values }) },",
    to: "{ action: action(\"update\"), resourceType: config.audit.type, resourceId: id, fields: Object.keys(values), label: labelOf({ ...before, ...values }) },",
    tests: CONTRACT,
  },

  // --------------------------------------------------------------------- lists
  {
    name: "crud: the sort whitelist is bypassed",
    file: "src/api/crud/pagination.ts",
    from: "if (!Object.hasOwn(spec.sorts, name)) return { ok: false };",
    to: "if (false) return { ok: false };",
    tests: `${CONTRACT} ${HELPERS}`,
  },
  {
    name: "crud: the page size is not clamped",
    file: "src/api/crud/pagination.ts",
    from: "const maxPageSize = options.maxPageSize ?? MAX_PAGE_SIZE;",
    to: "const maxPageSize = 1_000_000;",
    tests: `${CONTRACT} ${HELPERS}`,
  },
  {
    name: "crud: an unknown filter value is ignored instead of refused",
    file: "src/api/crud/pagination.ts",
    from: "if (!result.ok) return { ok: false, response: invalidQuery(c, name) };",
    to: "if (!result.ok) continue;",
    tests: `${CONTRACT} ${HELPERS} ${ANNOUNCEMENTS}`,
  },
  {
    name: "crud: the wildcards of a search are not escaped",
    file: "src/api/crud/pagination.ts",
    from: "return text.replace(/[!%_]/g, (character) => `${LIKE_ESCAPE}${character}`);",
    to: "return text;",
    tests: `${CONTRACT} ${HELPERS}`,
  },
  {
    name: "crud: the search is not cut to the 50 bytes D1 accepts in a LIKE pattern",
    file: "src/api/crud/pagination.ts",
    from: "if (encoder.encode(pattern).length <= MAX_LIKE_PATTERN_BYTES) return pattern;",
    to: "return pattern;",
    tests: `${CONTRACT} ${HELPERS}`,
  },
  {
    name: "crud: a list answers the raw rows, not what `present` chose (secrets leak)",
    file: "src/api/crud/resource.ts",
    from: "(rows as Row[]).map(presentInList)",
    to: "(rows as Row[])",
    tests: CONTRACT,
  },

  // ------------------------------------------------------------- side effects
  {
    name: "crud: the public cache is not told about a change",
    file: "src/api/crud/resource.ts",
    from: "deps.notify(change, waitUntil);",
    to: "",
    tests: `${CONTRACT} ${ANNOUNCEMENTS}`,
  },
  {
    name: "crud: a replaced or removed upload is not cleaned up",
    file: "src/api/crud/resource.ts",
    from: "if (removed.length > 0) {",
    to: "if (false) {",
    tests: CONTRACT,
  },
  {
    name: "crud: a unique index is a 500, not a 409 on its field",
    file: "src/api/crud/resource.ts",
    from: "if (isUniqueViolation(error, target)) return conflict(c, { [field]: message });",
    to: "if (false) return conflict(c, { [field]: message });",
    tests: CONTRACT,
  },
  {
    name: "crud: a foreign key that refuses a delete is a 500, not a 409 in_use",
    file: "src/api/crud/resource.ts",
    from: "if (config.inUse && isForeignKeyViolation(error)) return inUse(c, config.inUse.usedBy, config.inUse.message);",
    to: "",
    tests: CONTRACT,
  },

  // ------------------------------------------------- the SPA and the Worker agree
  {
    name: "crud: the SPA's upload limit differs from the Worker's",
    file: "spa/src/lib/crud/upload-kinds.ts",
    from: '"team-photo": { area: "konten", maxBytes: 5_000_000, types: IMAGES },',
    to: '"team-photo": { area: "konten", maxBytes: 6_000_000, types: IMAGES },',
    tests: SPA_CONTRACT,
  },
  {
    name: "crud: the SPA refuses a file with words the Worker does not use",
    file: "spa/src/lib/crud/upload-kinds.ts",
    from: "tooBig: (bytes: number) => `Ukuran file maksimal ${megabytes(bytes)}.`,",
    to: "tooBig: (bytes: number) => `Ukuran file maksimal ${megabytes(bytes)} saja.`,",
    tests: SPA_CONTRACT,
  },
  {
    name: "crud: the SPA shows an upload path with a base the Worker would not",
    file: "spa/src/lib/crud/upload-kinds.ts",
    from: "return ORIGIN.test(trimmed) ? trimmed : \"\";",
    to: "return trimmed;",
    tests: SPA_CONTRACT,
  },
  {
    // The rule moved to src/config/public-origin.ts when the site's address (SITE_URL) began to use it too.
    name: "crud: the Worker serves a base that is not an origin to the SPA",
    file: "src/config/public-origin.ts",
    from: 'return ORIGIN.test(trimmed) ? trimmed : "";',
    to: "return trimmed;",
    tests: SPA_CONTRACT,
  },
  {
    name: "crud: the SPA no longer recognises a stale save",
    file: "spa/src/lib/crud/errors.ts",
    from: 'const stale = failure.status === 409 && failure.code === "stale";',
    to: "const stale = false;",
    tests: SPA_CONTRACT,
  },
  {
    name: "crud: the SPA no longer reads the Worker's `fields`",
    file: "spa/src/lib/api.ts",
    from: "fields: stringFields(failure.fields),",
    to: "fields: undefined,",
    tests: SPA_CONTRACT,
  },
  {
    name: "crud: the announcements stop telling the public cache",
    file: "src/api/announcements.ts",
    from: 'purge: { area: "announcement" },',
    to: "",
    tests: ANNOUNCEMENTS,
  },
];
