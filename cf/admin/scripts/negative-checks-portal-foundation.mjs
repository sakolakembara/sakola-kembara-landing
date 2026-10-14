// The negative checks of the student portal's foundation (SAKEM-083, P1a), in their own file so the shared list in
// negative-checks.mjs stays short: it imports and spreads `portalFoundationChecks`. Same rules as there: each check
// breaks ONE safeguard in the source (or in the migration or a configuration file), runs the tests that must notice,
// expects them to FAIL, and the runner restores the file. A pattern found other than exactly once is reported as FAIL,
// so a refactor cannot turn a check into a no-op.
//
//   node scripts/negative-checks.mjs --only "portal foundation:"

const FORM = "test/portal-foundation-form.test.ts";
const SCHEMA = "test/portal-foundation-schema.test.ts";
const CONFIG = "test/portal-foundation-config.test.ts";
const SKELETON = "test/portal-foundation.test.ts";
const AUTH = "test/portal-auth.test.ts";

const MIGRATION = "migrations/0013_portal_applications.sql";

export const portalFoundationChecks = [
  // ------------------------------------------------ one Better Auth, two audiences
  {
    name: "portal foundation: the student's session cookie gets the admin's name (the audiences share a cookie)",
    file: "src/auth/audience.ts",
    from: 'errorPath: "/portal/auth/error", cookiePrefix: "sakem-student" }',
    to: 'errorPath: "/portal/auth/error", cookiePrefix: "better-auth" }',
    tests: `${AUTH} ${SKELETON}`,
  },
  // (The production cookie losing its __Host- prefix, for both audiences, is the existing check of negative-checks.mjs,
  // re-pointed at the audience's prefix; it runs this suite's portal-auth.test.ts too.)
  {
    name: "portal foundation: Better Auth is mounted at the admin's path on the portal Worker",
    file: "src/auth/factory.ts",
    from: "basePath: audience.basePath,",
    to: "basePath: AUTH_BASE_PATH,",
    tests: AUTH,
  },
  {
    name: "portal foundation: a failed auth call on the portal lands on the admin's error page",
    file: "src/auth/factory.ts",
    from: "onAPIError: { errorURL: audience.errorPath },",
    to: "onAPIError: { errorURL: AUTH_ERROR_PATH },",
    tests: AUTH,
  },
  {
    name: "portal foundation: the route table is looked up under the admin's base path (every portal auth route is a 404)",
    file: "src/auth/gate.ts",
    from: "const policy = findPolicy(c.req.method, path, basePath);",
    to: "const policy = findPolicy(c.req.method, path);",
    tests: AUTH,
  },
  {
    name: "portal foundation: registration on the portal forwards to the admin's sign-up path",
    file: "src/auth/register.ts",
    from: "url.pathname = `${basePath}/sign-up/email`;",
    to: "url.pathname = `${AUTH_BASE_PATH}/sign-up/email`;",
    tests: AUTH,
  },
  {
    name: "portal foundation: the auth gate (route table, rate limits, Turnstile) not mounted on the portal",
    file: "src/portal/worker.ts",
    from: "app.use(`${AUTH}/*`, createAuthGate(AUTH));",
    to: "",
    tests: AUTH,
  },
  {
    name: "portal foundation: the same-origin guard not mounted on the portal's writes",
    file: "src/portal/worker.ts",
    from: "app.use(`${API}/*`, sameOriginGuard);",
    to: "",
    tests: `${SKELETON} ${AUTH}`,
  },

  // ------------------------------------------------ the guard of a student route
  {
    name: "portal foundation: any role passes a student route (student_only is not checked)",
    file: "src/portal/guard.ts",
    from: 'if (user.role !== STUDENT_ROLE) return c.json({ error: "student_only", message: STUDENT_ONLY_MESSAGE }, 403);',
    to: "",
    tests: SKELETON,
  },
  {
    name: "portal foundation: an unverified address passes a student route",
    file: "src/portal/guard.ts",
    from: 'if (!user.emailVerified) return c.json({ error: "email_not_verified", message: EMAIL_NOT_VERIFIED_MESSAGE }, 403);',
    to: "",
    tests: SKELETON,
  },
  {
    name: "portal foundation: a student route is limited by address instead of by user id",
    file: "src/portal/guard.ts",
    from: "key: `${limit}:${user.id}`",
    to: 'key: `${limit}:${c.req.header("cf-connecting-ip")}`',
    tests: SKELETON,
  },
  {
    name: "portal foundation: the limiter of a student route is skipped",
    file: "src/portal/guard.ts",
    from: "if (limit) {",
    to: "if (false as boolean) {",
    tests: SKELETON,
  },

  // ------------------------------------------------ nothing is built for a request without the portal's cookie
  {
    name: "portal foundation: a request without the portal's cookie still builds Better Auth (me and the student routes)",
    file: "src/portal/guard.ts",
    from: "return hasStudentSessionCookie(c) ? currentUser(c) : null;",
    to: "return currentUser(c);",
    tests: SKELETON,
  },
  {
    name: "portal foundation: any cookie at all counts as the portal's (a request with only the admin's cookie builds Better Auth)",
    file: "src/portal/guard.ts",
    from: "return cookie !== undefined && cookie.includes(SESSION_COOKIE_SUFFIX);",
    to: "return cookie !== undefined && cookie.length > 0;",
    tests: SKELETON,
  },
  {
    name: "portal foundation: get-session without the portal's cookie builds Better Auth (the navbar's call on every visit)",
    file: "src/portal/worker.ts",
    from: "app.get(`${AUTH}/get-session`, (c, next) => (hasStudentSessionCookie(c) ? next() : c.json(null)));",
    to: "",
    tests: SKELETON,
  },

  // ------------------------------------------------ what the skeleton answers
  {
    name: "portal foundation: the no-store header is not sent on the portal API",
    file: "src/portal/headers.ts",
    from: '  "Cache-Control": "no-store",\n',
    to: "",
    tests: SKELETON,
  },
  {
    name: "portal foundation: a route's own Cache-Control is overwritten (a file answer would lose `private`)",
    file: "src/portal/headers.ts",
    from: "if (!c.res.headers.has(name)) c.header(name, value);",
    to: "c.header(name, value);",
    tests: SKELETON,
  },
  {
    name: "portal foundation: the dev mailbox answers outside development",
    file: "src/portal/worker.ts",
    from: 'if (c.env.ENVIRONMENT !== "development") return c.json({ error: "not_found" }, 404);',
    to: "",
    tests: SKELETON,
  },
  {
    name: "portal foundation: GET /portal/api/config hands out the Turnstile SECRET as the site key",
    file: "src/portal/worker.ts",
    from: "turnstileSiteKey: c.env.TURNSTILE_SITE_KEY || null,",
    to: "turnstileSiteKey: c.env.TURNSTILE_SECRET_KEY || null,",
    tests: SKELETON,
  },
  {
    name: "portal foundation: the admin origin of the config is not validated (a typo could put a script in a link)",
    file: "src/portal/worker.ts",
    from: "adminUrl: publicOrigin(c.env.ADMIN_URL),",
    to: 'adminUrl: c.env.ADMIN_URL ?? "",',
    tests: SKELETON,
  },
  {
    name: "portal foundation: the error handler answers with the error's message",
    file: "src/portal/worker.ts",
    from: 'return c.json({ error: "internal" }, 500);',
    to: "return c.json({ error: \"internal\", message: error.message }, 500);",
    tests: SKELETON,
  },
  {
    name: "portal foundation: the portal imports the blog (its bundle becomes the admin's)",
    file: "src/portal/worker.ts",
    from: 'import { apiHeaders } from "./headers";',
    to: 'import { apiHeaders } from "./headers";\nimport "../blog/render";',
    tests: CONFIG,
  },

  // ------------------------------------------------ limits and configuration
  {
    name: "portal foundation: the submit limiter is loosened from 3 to 30 a minute (the table and the config disagree)",
    file: "src/security/rate-limit.ts",
    from: '    binding: "RL_PORTAL_SUBMIT",\n    limit: 3,',
    to: '    binding: "RL_PORTAL_SUBMIT",\n    limit: 30,',
    tests: `${CONFIG} ${SKELETON}`,
  },
  {
    name: "portal foundation: the portal's assets run the Worker for every /portal path (a page view costs a Worker request)",
    file: "wrangler.portal.jsonc",
    from: '"run_worker_first": ["/portal/api/*"]',
    to: '"run_worker_first": ["/portal/*"]',
    tests: CONFIG,
  },
  {
    name: "portal foundation: the portal shares the admin's rate limit namespace (a flood of students spends an admin's bucket)",
    file: "wrangler.portal.jsonc",
    from: '"namespace_id": "8001"',
    to: '"namespace_id": "7801"',
    tests: CONFIG,
  },
  {
    name: "portal foundation: the portal binds the public bucket where the private one belongs",
    file: "wrangler.portal.jsonc",
    from: '"bucket_name": "sakem-private"',
    to: '"bucket_name": "sakem-files"',
    tests: CONFIG,
  },
  {
    name: "portal foundation: the portal's compatibility date drifts from the admin's",
    file: "wrangler.portal.jsonc",
    from: '"compatibility_date": "2026-09-01"',
    to: '"compatibility_date": "2026-08-01"',
    tests: CONFIG,
  },
  {
    name: "portal foundation: a retention period above 0 is set by default (the decision is that nothing is deleted automatically)",
    file: "wrangler.jsonc",
    from: '"REJECTED_FILES_RETENTION_DAYS": "0",',
    to: '"REJECTED_FILES_RETENTION_DAYS": "90",',
    tests: CONFIG,
  },

  {
    name: "portal foundation: an SSE-C key is declared as a variable of the Worker again (it was decided against)",
    file: "src/env.ts",
    from: "  PRIVATE_FILES_BUDGET_BYTES?: string;",
    to: "  PRIVATE_FILES_KEY?: string;\n  PRIVATE_FILES_BUDGET_BYTES?: string;",
    tests: CONFIG,
  },

  // ------------------------------------------------ migration 0013
  {
    name: "portal foundation: the migration lets a file's checksum be anything",
    file: MIGRATION,
    from: `CONSTRAINT "application_files_checksum_check" CHECK(length("application_files"."checksum") = 32 and "application_files"."checksum" not glob '*[^0-9a-f]*')`,
    to: `CONSTRAINT "application_files_checksum_check" CHECK(1)`,
    tests: SCHEMA,
  },
  {
    name: "portal foundation: the migration lets a file have only one of width and height (a lone NULL slips through)",
    file: MIGRATION,
    from: `CHECK(("application_files"."width" is null and "application_files"."height" is null) or ("application_files"."width" is not null and "application_files"."height" is not null and "application_files"."width" > 0 and "application_files"."height" > 0))`,
    to: `CHECK(("application_files"."width" is null and "application_files"."height" is null) or ("application_files"."width" > 0 and "application_files"."height" > 0))`,
    tests: SCHEMA,
  },
  {
    name: "portal foundation: a draft's batch is deleted with the batch instead of restricting it",
    file: MIGRATION,
    from: "ON UPDATE no action ON DELETE restrict",
    to: "ON UPDATE no action ON DELETE cascade",
    tests: SCHEMA,
  },
  {
    name: "portal foundation: the migration does not seed the storage counter",
    file: MIGRATION,
    from: "INSERT INTO `private_storage` (`id`, `bytes`, `files`) VALUES ('private-files', 0, 0);",
    to: "",
    tests: SCHEMA,
  },
  {
    name: "portal foundation: the size limit of a draft's form data is raised a thousand times",
    file: MIGRATION,
    from: '<= 98304 else 0 end)',
    to: '<= 98304000 else 0 end)',
    tests: SCHEMA,
  },
  {
    name: "portal foundation: a student may have several drafts for one batch",
    file: MIGRATION,
    from: "CREATE UNIQUE INDEX `application_drafts_user_batch_unique`",
    to: "CREATE INDEX `application_drafts_user_batch_unique`",
    tests: SCHEMA,
  },
  {
    name: "portal foundation: the dev seed does not empty drafts (re-seeding a database with a draft fails on the batch)",
    file: "scripts/seed-data.ts",
    from: "    schema.applicationDrafts,\n",
    to: "",
    tests: SCHEMA,
  },

  // ------------------------------------------------ the shared form module
  {
    name: "portal foundation: a name in capitals is accepted",
    file: "shared/application-form/rules.ts",
    from: "else if (/^[A-ZÀ-ÿ ]+$/.test(fullName))",
    to: "else if (false as boolean)",
    tests: FORM,
  },
  {
    name: "portal foundation: spaces in a WhatsApp number are kept",
    file: "shared/application-form/rules.ts",
    from: '(trimmed(input.whatsapp) ?? "").replace(/\\s+/g, "")',
    to: '(trimmed(input.whatsapp) ?? "")',
    tests: FORM,
  },
  {
    name: "portal foundation: a rupiah amount with Rp is accepted",
    file: "shared/application-form/rules.ts",
    from: "if (/rp/i.test(value)) return",
    to: "if (false as boolean) return",
    tests: FORM,
  },
  {
    name: "portal foundation: a rupiah amount with a comma is accepted",
    file: "shared/application-form/rules.ts",
    from: 'if (value.includes(",")) return',
    to: "if (false as boolean) return",
    tests: FORM,
  },
  {
    name: "portal foundation: a rupiah amount has no upper bound",
    file: "shared/application-form/rules.ts",
    from: "if (!Number.isFinite(amount) || amount > RUPIAH_MAX)",
    to: "if (!Number.isFinite(amount))",
    tests: FORM,
  },
  {
    name: "portal foundation: a second earner without the first is accepted",
    file: "shared/application-form/rules.ts",
    from: 'if (!hasOtherEarner1) c.add(["earner2Relation"], "Isi anggota pertama dulu.");',
    to: "",
    tests: FORM,
  },
  {
    name: "portal foundation: the interview can be submitted without agreeing to the signed statement",
    file: "shared/application-form/rules.ts",
    from: 'else if (answer === "tidak") c.add(["agreedToSignedStatement"], AGREEMENT_REFUSED_MESSAGE);',
    to: "",
    tests: FORM,
  },
  {
    name: "portal foundation: keys the form does not know are stored (a client could write anything into a draft)",
    file: "shared/application-form/rules.ts",
    from: "if (collector.issues.length === 0) return { ok: true, value };",
    to: "if (collector.issues.length === 0) return { ok: true, value: { ...body, ...value } as StepValues[K] };",
    tests: FORM,
  },
  {
    name: "portal foundation: an empty row counts as an organisation",
    file: "shared/application-form/rules.ts",
    from: 'if (name === "" && position === "") return; // an empty row is not an entry',
    to: "",
    tests: FORM,
  },
  {
    name: "portal foundation: the DTKS certificate is required of every student",
    file: "shared/application-form/slots.ts",
    from: 'return required === "dtks" ? dtksRegistered : required;',
    to: 'return required === "dtks" ? true : required;',
    tests: FORM,
  },
  {
    name: "portal foundation: the student's own photo takes a PDF",
    file: "shared/application-form/slots.ts",
    from: '"Foto Diri", "documents", true, 1, IMAGE_FILE_TYPES)',
    to: '"Foto Diri", "documents", true, 1)',
    tests: FORM,
  },
  {
    name: "portal foundation: the file size limit is doubled (the code and the CHECK of the migration disagree)",
    file: "shared/application-form/limits.ts",
    from: "export const MAX_FILE_BYTES = 10_000_000;",
    to: "export const MAX_FILE_BYTES = 20_000_000;",
    tests: `${FORM} ${SCHEMA}`,
  },
  {
    name: "portal foundation: a local draft without a numeric savedAt is kept (it could never be aged out)",
    file: "shared/application-form/draft.ts",
    from: 'if (typeof value.savedAt !== "number" || !Number.isFinite(value.savedAt) || value.savedAt <= 0) return false;',
    to: "",
    tests: FORM,
  },
  {
    name: "portal foundation: a local draft never expires",
    file: "shared/application-form/draft.ts",
    from: "return now - draft.savedAt >= LOCAL_DRAFT_MAX_AGE_MS;",
    to: "return false;",
    tests: FORM,
  },
  {
    name: "portal foundation: a submitted application is written as form_data version 2",
    file: "shared/application-form/form-data.ts",
    from: "export const FORM_DATA_VERSION = 3 as const;",
    to: "export const FORM_DATA_VERSION = 2 as never;",
    tests: FORM,
  },
  {
    name: "portal foundation: an unvalidated rupiah amount is written as 0 instead of refused",
    file: "shared/application-form/form-data.ts",
    from: 'if (!parsed.ok) throw new Error("buildFormData: a rupiah amount was not validated");',
    to: "if (!parsed.ok) return 0;",
    tests: FORM,
  },
];
