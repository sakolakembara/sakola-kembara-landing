// Proves the tests are not vacuous: each check breaks one safeguard in the
// source (or in a migration), runs the tests that should notice, expects them
// to FAIL, and always restores the file.
//
//   node scripts/negative-checks.mjs        (pnpm test:negative)
//
// Run it on a clean tree: it rewrites files under src/ and migrations/ for a
// few seconds each. A check whose pattern is not found exactly once is
// reported as FAIL, so a refactor that moves the code cannot silently turn a
// check into a no-op. A check is either one edit (file, from, to) or a list of
// `edits` for safeguards that live in two places.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { uploadChecks } from "./negative-checks-uploads.mjs";

const PERMISSION_TESTS = "test/permissions.test.ts test/areas.test.ts test/announcements.test.ts";

// GET /api/dashboard (SAKEM-082): the route, the rules and the SPA's side of the contract.
const DASHBOARD_TESTS = "test/dashboard.test.ts test/dashboard-rules.test.ts test/spa-contract.test.ts";

// The public API (SAKEM-081, part C): docs/cloudflare/public-api.md.
const PUBLIC_READ = "test/public-read.test.ts";
const PUBLIC_BLOG = "test/public-blog.test.ts test/public-blog-parity.test.ts";
const PUBLIC_LEAK = "test/public-leak.test.ts";
const PUBLIC_CONTACT = "test/public-contact.test.ts";
const PUBLIC_BUDGET = "test/public-budget.test.ts";
const PUBLIC_PURGE = "test/public-purge.test.ts";
const PUBLIC_FACE = "test/public-face.test.ts";

const checks = [
  // The upload API (SAKEM-082): scripts/negative-checks-uploads.mjs.
  ...uploadChecks,

  // ---------------------------------------------------------------- auth
  {
    name: "verification requirement removed",
    file: "src/auth/factory.ts",
    from: "requireEmailVerification: true,",
    to: "requireEmailVerification: false,",
    tests: "test/auth.test.ts",
  },
  {
    name: "the auth gate (route table, rate limits, Turnstile) not mounted",
    file: "src/worker.ts",
    from: "app.use(`${AUTH_BASE_PATH}/*`, authGate);",
    to: "",
    tests: "test/rate-limit.test.ts test/gate.test.ts test/register.test.ts",
  },
  {
    name: "production treated as development (email no longer fails closed)",
    file: "src/env.ts",
    from: 'return env.ENVIRONMENT !== "development" && env.ENVIRONMENT !== "test";',
    to: "return false;",
    tests: "test/email.test.ts test/gate.test.ts",
  },
  {
    name: "clients may set their own role (registration forwards the whole body, and Better Auth accepts a role)",
    edits: [
      { file: "src/auth/register.ts", from: "body: JSON.stringify({\n      name: input.name,", to: "body: JSON.stringify({\n      ...(raw as object),\n      name: input.name," },
      { file: "src/auth/factory.ts", from: 'defaultValue: "student", input: false', to: 'defaultValue: "student", input: true' },
    ],
    tests: "test/register.test.ts",
  },
  {
    name: "Google email_verified no longer checked",
    file: "src/auth/factory.ts",
    from: "source.oauth.profile?.email_verified !== true",
    to: "false",
    tests: "test/linking.test.ts",
  },
  {
    name: "account linking weakened (Google trusted, local verification not required)",
    file: "src/auth/factory.ts",
    from: "// Account linking stays at Better Auth's safe defaults on purpose:",
    to: 'account: { accountLinking: { enabled: true, trustedProviders: ["google"], requireLocalEmailVerified: false } },\n    // Account linking stays at Better Auth\'s safe defaults on purpose:',
    tests: "test/linking.test.ts",
  },

  // ------------------------------------------------- permission model
  {
    name: "viewer allowed to write (viewer is no longer strictly read-only)",
    file: "src/auth/permissions.ts",
    from: 'return area === "sistem" ? "none" : "read";',
    to: 'return area === "sistem" ? "none" : "write";',
    tests: PERMISSION_TESTS,
  },
  {
    name: "viewer allowed into Sistem",
    file: "src/auth/permissions.ts",
    from: 'return area === "sistem" ? "none" : "read";',
    to: 'return "read";',
    tests: PERMISSION_TESTS,
  },
  {
    name: "area check removed: an editor writes outside the areas granted to them",
    file: "src/auth/permissions.ts",
    from: 'return grantedAreas.includes(area) ? "write" : "none";',
    to: 'return "write";',
    tests: PERMISSION_TESTS,
  },
  {
    name: "an editor reads the areas not granted to them (the rule before SAKEM-082)",
    file: "src/auth/permissions.ts",
    from: 'return grantedAreas.includes(area) ? "write" : "none";',
    to: 'return grantedAreas.includes(area) ? "write" : "read";',
    tests: `${PERMISSION_TESTS} test/seed.test.ts test/spa-contract.test.ts`,
  },
  {
    name: "/api/me lists every grantable area as visible (the menu would show areas an editor cannot open)",
    file: "src/worker.ts",
    from: "visible: visibleAreas(user.role, grantedAreas),",
    to: 'visible: ["pendaftaran", "komunikasi", "konten"],',
    tests: "test/areas.test.ts test/spa-contract.test.ts",
  },
  {
    name: "editor allowed into Sistem",
    file: "src/auth/permissions.ts",
    from: 'if (area === "sistem") return "none";\n      return grantedAreas',
    to: "return grantedAreas",
    tests: PERMISSION_TESTS,
  },
  {
    name: "student treated like a viewer",
    file: "src/auth/permissions.ts",
    from: 'case "student":\n      return "none";',
    to: 'case "student":\n      return "read";',
    tests: PERMISSION_TESTS,
  },
  {
    name: "unknown roles accepted as roles",
    file: "src/auth/roles.ts",
    from: 'export function isUserRole(role: unknown): role is UserRole {\n  return typeof role === "string" && (userRoles as readonly string[]).includes(role);',
    to: "export function isUserRole(role: unknown): role is UserRole {\n  return true;",
    tests: PERMISSION_TESTS,
  },
  {
    name: "Sistem made grantable to editors",
    file: "src/auth/permissions.ts",
    from: 'export const grantableAreas = ["pendaftaran", "komunikasi", "konten"] as const;',
    to: 'export const grantableAreas = ["pendaftaran", "komunikasi", "konten", "sistem"] as const;',
    tests: PERMISSION_TESTS,
  },

  // --------------------------------------------------------- the guard
  {
    name: "guard no longer checks the area (any signed-in user passes)",
    file: "src/auth/guard.ts",
    from: 'if (!can(access.user.role, access.grantedAreas, area, action)) return c.json({ error: "forbidden" }, 403);',
    to: "",
    tests: PERMISSION_TESTS,
  },
  {
    name: "area grants are never loaded from the database",
    file: "src/auth/guard.ts",
    from: 'const grantedAreas = user.role === "editor" ? await loadGrantedAreas(c.env.DB, user.id) : [];',
    to: "const grantedAreas: GrantableArea[] = [];",
    tests: PERMISSION_TESTS,
  },
  {
    name: "area grants cached between requests (a revoked grant would keep working)",
    file: "src/db/grants.ts",
    from: "  return rows.map((row) => row.area).filter(isGrantableArea);\n}",
    to: "  const fresh = rows.map((row) => row.area).filter(isGrantableArea);\n  const stale = memo.get(userId);\n  if (stale) return stale;\n  memo.set(userId, fresh);\n  return fresh;\n}\nconst memo = new Map<string, GrantableArea[]>();",
    tests: PERMISSION_TESTS,
  },
  {
    name: "announcement writes only need read access",
    file: "src/api/announcements.ts",
    from: 'announcementRoutes.post("/", requireArea("komunikasi", "write"),',
    to: 'announcementRoutes.post("/", requireArea("komunikasi", "read"),',
    tests: "test/announcements.test.ts",
  },
  {
    name: "announcements guarded by the wrong area",
    file: "src/api/announcements.ts",
    from: 'announcementRoutes.delete("/:id", requireArea("komunikasi", "write"),',
    to: 'announcementRoutes.delete("/:id", requireArea("konten", "write"),',
    tests: "test/announcements.test.ts",
  },
  {
    name: "granting areas open to anyone who can write somewhere (not Sistem only)",
    file: "src/api/admin-users.ts",
    from: 'adminUserRoutes.put("/:id/areas", requireArea("sistem", "write"),',
    to: 'adminUserRoutes.put("/:id/areas", requireArea("komunikasi", "write"),',
    tests: "test/areas.test.ts",
  },
  {
    name: "admin user list open to every reader",
    file: "src/api/admin-users.ts",
    from: 'adminUserRoutes.get("/", requireArea("sistem", "read"),',
    to: 'adminUserRoutes.get("/", requireArea("komunikasi", "read"),',
    tests: "test/areas.test.ts",
  },
  {
    name: "grants can be given to roles that cannot hold them",
    file: "src/api/admin-users.ts",
    from: 'if (target.role !== "editor") return c.json({ error: "not_editor" }, 409);',
    to: "",
    tests: "test/areas.test.ts",
  },

  // ------------------------------------------------ the dashboard (SAKEM-082)
  // GET /api/dashboard: who may call it, what it holds per area, what it costs.
  // The rules are in src/dashboard/payload.ts, the statements in queries.ts.
  {
    name: "dashboard not guarded (a request without a session reaches the handler)",
    file: "src/api/dashboard.ts",
    from: 'dashboardRoutes.get("/", requireAdmin(), async (c) => {',
    to: 'dashboardRoutes.get("/", async (c) => {',
    tests: DASHBOARD_TESTS,
  },
  {
    name: "dashboard answers a student (the admin role check removed)",
    file: "src/auth/guard.ts",
    from: 'if (!isAdminRole(access.user.role)) return c.json({ error: "forbidden" }, 403);',
    to: "",
    tests: DASHBOARD_TESTS,
  },
  {
    name: "dashboard ignores the caller's areas (everyone is treated as seeing every area)",
    file: "src/api/dashboard.ts",
    from: 'visibleAreas(user.role, c.get("grantedAreas"))',
    to: '["pendaftaran", "komunikasi", "konten", "sistem"]',
    tests: DASHBOARD_TESTS,
  },
  {
    name: "dashboard reads the applicants and the batches although Pendaftaran is not visible",
    file: "src/dashboard/queries.ts",
    from: 'const wantsAdmission = visible.includes("pendaftaran");',
    to: "const wantsAdmission = true;",
    tests: DASHBOARD_TESTS,
  },
  {
    name: "dashboard reads the unread messages although Komunikasi is not visible",
    file: "src/dashboard/queries.ts",
    from: 'const wantsMessages = visible.includes("komunikasi");',
    to: "const wantsMessages = true;",
    tests: DASHBOARD_TESTS,
  },
  {
    name: "unread messages counts the messages that were read",
    file: "src/dashboard/queries.ts",
    from: "db.select({ n: count() }).from(contactMessages).where(isNull(contactMessages.readAt));",
    to: "db.select({ n: count() }).from(contactMessages);",
    tests: DASHBOARD_TESTS,
  },
  {
    name: "waiting applicants counts the decided ones too",
    file: "src/dashboard/queries.ts",
    from: 'inArray(studentApplications.status, ["pending", "under_review"])',
    to: 'inArray(studentApplications.status, ["pending", "under_review", "accepted", "rejected"])',
    tests: DASHBOARD_TESTS,
  },
  {
    name: "waiting applicants not filtered by status (a walk over every application)",
    file: "src/dashboard/queries.ts",
    from: '    .where(inArray(studentApplications.status, ["pending", "under_review"]))\n    .groupBy(',
    to: "    .groupBy(",
    tests: DASHBOARD_TESTS,
  },
  {
    name: "batches not limited to the newest few",
    file: "src/dashboard/queries.ts",
    from: "    .orderBy(desc(admissionBatches.opensAt))\n    .limit(BATCH_CANDIDATES);",
    to: "    .orderBy(desc(admissionBatches.opensAt));",
    tests: DASHBOARD_TESTS,
  },
  {
    name: "the dashboard's statements run one after the other (a round trip each)",
    file: "src/dashboard/queries.ts",
    from: 'const results = await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);',
    to: "const results: unknown[] = [];\n  for (const statement of statements) results.push(await statement);",
    tests: DASHBOARD_TESTS,
  },
  {
    name: "a closed batch with applications waiting is called ready to publish",
    file: "src/dashboard/payload.ts",
    from: 'return undecided > 0 ? "awaiting_decisions" : "ready_to_publish";',
    to: 'return "ready_to_publish";',
    tests: DASHBOARD_TESTS,
  },
  {
    name: "a batch waiting for decisions no longer outranks an open one",
    file: "src/dashboard/payload.ts",
    from: "  awaiting_decisions: 0,",
    to: "  awaiting_decisions: 5,",
    tests: DASHBOARD_TESTS,
  },
  {
    name: "the dashboard carries applicants' names and addresses",
    file: "src/api/dashboard.ts",
    from: "return c.json(dashboard);",
    to: 'return c.json({ ...dashboard, debug: (await c.env.DB.prepare("select full_name, email from student_applications limit 3").all()).results });',
    tests: DASHBOARD_TESTS,
  },
  {
    name: "the blanket no-store header removed (the dashboard could be cached)",
    file: "src/worker.ts",
    from: '  c.header("Cache-Control", "no-store");',
    to: "",
    tests: DASHBOARD_TESTS,
  },
  {
    name: "a dashboard link points at a route the SPA does not have",
    file: "src/dashboard/payload.ts",
    from: '  unreadMessages: "/messages?filter=unread",',
    to: '  unreadMessages: "/inbox?filter=unread",',
    tests: DASHBOARD_TESTS,
  },

  // ------------------------------------------- same-origin guard (CSRF)
  {
    name: "same-origin guard not mounted",
    file: "src/worker.ts",
    from: 'app.use("/api/*", sameOriginGuard);',
    to: "",
    tests: "test/csrf.test.ts",
  },
  {
    name: "a foreign Origin header accepted",
    file: "src/security/csrf.ts",
    from: 'if (origin !== null) return allowed(originOf(origin)) ? { ok: true } : { ok: false, reason: "origin_mismatch" };',
    to: "if (origin !== null) return { ok: true };",
    tests: "test/csrf.test.ts",
  },
  {
    name: "Sec-Fetch-Site cross-site and same-site accepted when there is no Origin",
    file: "src/security/csrf.ts",
    from: 'return site === "same-origin" || site === "none" ? { ok: true } : { ok: false, reason: "cross_site" };',
    to: "return { ok: true };",
    tests: "test/csrf.test.ts",
  },
  {
    name: "a cookie with no origin signal at all accepted",
    file: "src/security/csrf.ts",
    from: 'return headers.has("cookie") ? { ok: false, reason: "no_origin_signal" } : { ok: true };',
    to: "return { ok: true };",
    tests: "test/csrf.test.ts",
  },

  // --------------------------------------------- the auth gate and register
  {
    name: "Better Auth's own sign-up exposed (skips Turnstile and the legacy validation)",
    file: "src/auth/gate.ts",
    from: '  { method: "POST", path: "/sign-out", limits: none },',
    to: '  { method: "POST", path: "/sign-out", limits: none },\n  { method: "POST", path: "/sign-up/email", limits: none },',
    tests: "test/register.test.ts test/gate.test.ts",
  },
  {
    name: "routes missing from the table pass through to Better Auth",
    file: "src/auth/gate.ts",
    from: 'if (!policy) return c.json({ error: "not_found" }, 404);',
    to: "if (!policy) return next();",
    tests: "test/gate.test.ts",
  },
  {
    name: "form-encoded bodies accepted by the gate",
    file: "src/auth/gate.ts",
    from: 'if (!c.req.header("content-type")?.toLowerCase().startsWith("application/json")) {',
    to: "if (false) {",
    tests: "test/gate.test.ts",
  },
  {
    name: "body size cap removed",
    file: "src/auth/gate.ts",
    from: 'if (body.tooBig) return c.json({ error: "body_too_large" }, 413);',
    to: "",
    tests: "test/gate.test.ts",
  },
  {
    name: "Turnstile not asked for on the gated routes",
    file: "src/auth/gate.ts",
    from: "const refused = await guardTurnstile(c.env, c.req.raw, policy.turnstile);",
    to: "const refused = null as Response | null;",
    tests: "test/gate.test.ts",
  },
  {
    name: "routes that send email no longer check that email can be sent",
    file: "src/auth/gate.ts",
    from: "if (policy.sendsEmail && !emailAvailable(c.env)) {",
    to: "if (false) {",
    tests: "test/gate.test.ts",
  },
  {
    name: "one mailbox no longer limited across register, reset and resend",
    file: "src/auth/gate.ts",
    from: 'limits: ({ ip, email }) => [{ name: "register", key: ip }, ...byEmail("mailTarget", email)],',
    to: 'limits: ({ ip }) => [{ name: "register", key: ip }],',
    tests: "test/rate-limit.test.ts",
  },
  {
    name: "registration answers an existing address differently (leaks Better Auth's answer)",
    file: "src/auth/register.ts",
    from: "if (result.ok) return c.json({ ok: true, message: REGISTER_MESSAGE });",
    to: "if (result.ok) return c.json({ ok: true, message: REGISTER_MESSAGE, user: await result.clone().json() });",
    tests: "test/register.test.ts",
  },
  {
    name: "the owner of an existing address is not told about the attempt",
    file: "src/auth/factory.ts",
    from: "onExistingUserSignUp: async ({ user }, request) => {",
    to: "onExistingUserSignUp: async ({ user }, request) => {\n        return;",
    tests: "test/register.test.ts",
  },
  {
    name: "honeypot ignored",
    file: "src/auth/register.ts",
    from: "if (input.website) return c.json({ ok: true, message: REGISTER_MESSAGE });",
    to: "",
    tests: "test/register.test.ts",
  },
  {
    name: "visitor address taken from X-Forwarded-For (legacy bug SAKEM-008)",
    file: "src/security/client.ts",
    from: 'const value = headers.get("cf-connecting-ip")?.trim().toLowerCase();',
    to: 'const value = (headers.get("x-forwarded-for")?.split(",")[0] ?? headers.get("cf-connecting-ip"))?.trim().toLowerCase();',
    tests: "test/rate-limit.test.ts",
  },
  {
    name: "a missing rate limit binding no longer refuses in production",
    file: "src/security/rate-limit.ts",
    from: "if (isProductionEnv(env)) {",
    to: "if (false) {",
    tests: "test/rate-limit.test.ts",
  },

  // ------------------------------------------------------------- Turnstile
  {
    name: "Turnstile answer never checked (every token passes)",
    file: "src/security/turnstile.ts",
    from: 'if (answer.success !== true) return { ok: false, reason: "rejected", errorCodes };',
    to: "",
    tests: "test/turnstile.test.ts test/gate.test.ts",
  },
  {
    name: "Turnstile skipped in production when the secret is missing (fails open)",
    file: "src/security/turnstile.ts",
    from: "if (config.production) {",
    to: "if (false) {",
    tests: "test/turnstile.test.ts test/gate.test.ts",
  },
  {
    name: "Turnstile counted as passed when Siteverify cannot be reached",
    file: "src/security/turnstile.ts",
    from: 'console.error("[turnstile] Siteverify could not be reached or read");\n    return { ok: false, reason: "unavailable", errorCodes: [] };',
    to: 'console.error("[turnstile] Siteverify could not be reached or read");\n    return { ok: true };',
    tests: "test/turnstile.test.ts test/gate.test.ts",
  },
  {
    name: "Turnstile token minted for another form accepted",
    file: "src/security/turnstile.ts",
    from: "if (expectedAction && answer.action && answer.action !== expectedAction) {",
    to: "if (false) {",
    tests: "test/turnstile.test.ts",
  },

  // ----------------------------------------------------------------- email
  {
    name: "production without an email provider reports success instead of failing closed",
    file: "src/email/send.ts",
    from: "if (isProduction(env)) {\n      console.error(`[email] provider not configured;",
    to: "if (false) {\n      console.error(`[email] provider not configured;",
    tests: "test/email.test.ts",
  },
  {
    name: "routes can't tell that email is unavailable (emailAvailable always true)",
    file: "src/email/send.ts",
    from: "return !isProduction(env) || Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);",
    to: "return true;",
    tests: "test/email.test.ts test/gate.test.ts",
  },
  {
    name: "a non-2xx answer from Resend counted as sent",
    file: "src/email/send.ts",
    from: "if (res.ok) return { ok: true };",
    to: "return { ok: true };",
    tests: "test/email.test.ts",
  },
  {
    name: "the admin invite ignores a failed send",
    file: "src/api/admin-users.ts",
    from: "if (!sent.ok) return emailFailure(c, sent, present(created));",
    to: "",
    tests: "test/admin-users.test.ts",
  },

  // ------------------------------------------------- sessions and passwords
  {
    name: "a password reset leaves other sessions alive",
    file: "src/auth/factory.ts",
    from: "revokeSessionsOnPasswordReset: true,",
    to: "revokeSessionsOnPasswordReset: false,",
    tests: "test/auth.test.ts",
  },
  {
    name: "a password reset no longer proves the mailbox (an invited admin could not sign in)",
    file: "src/auth/factory.ts",
    from: "db.update(schema.users).set({ emailVerified: true }).where(eq(schema.users.id, user.id)),",
    to: "db.update(schema.users).set({ emailVerified: false }).where(eq(schema.users.id, user.id)),",
    tests: "test/auth.test.ts test/admin-users.test.ts",
  },
  {
    name: "production session cookie loses its __Host- prefix",
    file: "src/auth/factory.ts",
    from: 'cookiePrefix: "__Host-better-auth",',
    to: 'cookiePrefix: "better-auth",',
    tests: "test/auth.test.ts",
  },
  {
    name: "a deactivated account can open a session (session hook removed)",
    file: "src/auth/factory.ts",
    from: "if (row?.deactivatedAt) {",
    to: "if (false) {",
    tests: "test/admin-users.test.ts",
  },
  {
    name: "a session of a deactivated account is still honoured",
    file: "src/auth/session.ts",
    from: "if ((session.user as { deactivatedAt?: unknown }).deactivatedAt) return null;",
    to: "",
    tests: "test/admin-users.test.ts",
  },

  // ------------------------------------------------------- admin users API
  {
    name: "the last super_admin trigger does nothing",
    file: "migrations/0006_keep_one_super_admin.sql",
    from: "SELECT RAISE(ABORT, 'last_super_admin');",
    to: "SELECT 1;",
    tests: "test/admin-users.test.ts",
  },
  {
    name: "the trigger's refusal is not turned into a 409",
    file: "src/api/admin-users.ts",
    from: 'if (mentions(error, "last_super_admin")) {\n      return c.json({ error: "last_super_admin", message: "Tidak dapat menurunkan',
    to: 'if (false) {\n      return c.json({ error: "last_super_admin", message: "Tidak dapat menurunkan',
    tests: "test/admin-users.test.ts",
  },
  {
    name: "a super_admin may deactivate themselves",
    file: "src/api/admin-users.ts",
    from: "if (id === actor.id) {",
    to: "if (false) {",
    tests: "test/admin-users.test.ts",
  },
  {
    name: "deactivating leaves the account's sessions alive",
    file: "src/api/admin-users.ts",
    from: "db.delete(schema.sessions).where(eq(schema.sessions.userId, id)),",
    to: "",
    tests: "test/admin-users.test.ts",
  },
  {
    name: "a demoted editor keeps the area grants",
    file: "src/api/admin-users.ts",
    from: 'const grantsRemoved = roleChanges && target.role === "editor" ? target.areas : [];',
    to: "const grantsRemoved: GrantableArea[] = [];",
    tests: "test/admin-users.test.ts",
  },
  {
    name: "a deactivation is not audited",
    file: "src/api/admin-users.ts",
    from: 'auditStatement(db, actor, { action: "admin.deactivate", resourceType: "admin_user", resourceId: id, metadata: { email: target.email, role: target.role } }),',
    to: "",
    tests: "test/admin-users.test.ts",
  },
  {
    name: "an admin invite lives 60 seconds instead of 7 days",
    file: "src/api/admin-users.ts",
    from: "expiresAt: new Date(Date.now() + ADMIN_INVITE_SECONDS * 1000),",
    to: "expiresAt: new Date(Date.now() + 60 * 1000),",
    tests: "test/admin-users.test.ts",
  },
  {
    name: "resending an invite leaves the old link working",
    file: "src/api/admin-users.ts",
    from: 'await c.env.DB.prepare("DELETE FROM verification WHERE value = ?").bind(userId).run();',
    to: "",
    tests: "test/admin-users.test.ts",
  },
  {
    name: "students can be managed (promoted) through the admin users API",
    file: "src/api/admin-users.ts",
    from: "and(inArray(schema.users.role, adminRoles), eq(schema.users.id, only))",
    to: "eq(schema.users.id, only)",
    tests: "test/admin-users.test.ts",
  },
  {
    name: "deactivation open to editors (guarded by an area an editor can hold)",
    file: "src/api/admin-users.ts",
    from: 'adminUserRoutes.post("/:id/deactivate", requireArea("sistem", "write"),',
    to: 'adminUserRoutes.post("/:id/deactivate", requireArea("konten", "write"),',
    tests: "test/admin-users.test.ts",
  },

  // ------------------------------------------------------------------ cron
  {
    name: "cleanup deletes sessions that have not expired",
    file: "src/cron/cleanup.ts",
    from: 'deleteInChunks(env.DB, "session", "expires_at", now)',
    to: 'deleteInChunks(env.DB, "session", "expires_at", now + 365 * DAY_MS)',
    tests: "test/cron.test.ts",
  },
  {
    name: "an unreadable audit retention deletes audit rows",
    file: "src/cron/cleanup.ts",
    from: "if (!/^[0-9]{1,5}$/.test(text)) return null;",
    to: "if (false) return null;",
    tests: "test/cron.test.ts",
  },

  // ------------------------------------------------------------ the schema
  {
    name: "enum CHECK removed from a migration (announcements.severity)",
    file: "migrations/0002_communication.sql",
    from: `\tCONSTRAINT "announcements_severity_check" CHECK("announcements"."severity" in ('info', 'warning', 'urgent')),\n`,
    to: "",
    tests: "test/schema.test.ts",
  },
  {
    name: "area grants no longer cascade when their user is deleted",
    file: "migrations/0000_auth_audit_permissions.sql",
    from: "ON DELETE cascade,\n\tFOREIGN KEY (`granted_by`)",
    to: "ON DELETE no action,\n\tFOREIGN KEY (`granted_by`)",
    tests: "test/schema.test.ts",
  },
  {
    name: "(user, area) no longer unique on area grants",
    file: "migrations/0000_auth_audit_permissions.sql",
    from: "\tPRIMARY KEY(`user_id`, `area`),\n",
    to: "",
    tests: "test/schema.test.ts",
  },
  {
    name: "a batch with applications can be deleted (RESTRICT turned into CASCADE)",
    file: "migrations/0001_admission.sql",
    from: "REFERENCES `admission_batches`(`id`) ON UPDATE no action ON DELETE restrict",
    to: "REFERENCES `admission_batches`(`id`) ON UPDATE no action ON DELETE cascade",
    tests: "test/schema.test.ts",
  },

  // --------------------------------------------------- the public API: leaks
  {
    name: "public serializer passes the whole row through (no field allow-list)",
    file: "src/public/serializers.ts",
    from: "export function serializeReport(row: PublicReport): PublicReport {\n  return {\n    id: row.id,\n    title: row.title,\n    description: row.description,\n    category: row.category,\n    year: row.year,\n    filePath: row.filePath,\n    fileSize: row.fileSize,\n  };\n}",
    to: "export function serializeReport(row: PublicReport): PublicReport {\n  return { ...row };\n}",
    tests: PUBLIC_LEAK,
  },
  {
    name: "public blog card exposes an extra column (the author's user id)",
    file: "src/public/serializers.ts",
    from: "    author: row.author,\n    featured: row.featured,\n  };\n}\n\nexport interface BlogArticleRow",
    to: "    author: row.author,\n    featured: row.featured,\n    createdBy: (row as unknown as { createdBy?: string }).createdBy,\n  } as PublicBlogSummary;\n}\n\nexport interface BlogArticleRow",
    tests: PUBLIC_LEAK,
  },

  // --------------------------------------------- the public API: what is served
  {
    name: "public blog serves drafts (published-only filter removed)",
    file: "src/public/queries.ts",
    from: 'const published = eq(blogPosts.status, "published");',
    to: "const published = sql`1 = 1`;",
    tests: `${PUBLIC_BLOG} ${PUBLIC_LEAK}`,
  },
  {
    name: "announcement shown although it is switched off",
    file: "src/public/queries.ts",
    from: "and(eq(announcements.active, true), or(isNull(announcements.startsAt)",
    to: "and(sql`1 = 1`, or(isNull(announcements.startsAt)",
    tests: PUBLIC_READ,
  },
  {
    name: "announcement still shown after its end (window end ignored)",
    file: "src/public/queries.ts",
    from: "or(isNull(announcements.endsAt), gte(announcements.endsAt, now))",
    to: "sql`1 = 1`",
    tests: PUBLIC_READ,
  },
  {
    name: "announcement shown before its start (window start ignored)",
    file: "src/public/queries.ts",
    from: "or(isNull(announcements.startsAt), lte(announcements.startsAt, now))",
    to: "sql`1 = 1`",
    tests: PUBLIC_READ,
  },
  {
    name: "team not ranked by category",
    file: "src/public/queries.ts",
    from: ".orderBy(rankBy(teamMembers.category, teamCategory), asc(teamMembers.displayOrder)",
    to: ".orderBy(asc(teamMembers.displayOrder)",
    tests: PUBLIC_READ,
  },
  {
    name: "resources in category text order instead of the page's order",
    file: "src/public/queries.ts",
    from: "rankBy(siteResources.category, resourceCategory)",
    to: "asc(siteResources.category)",
    tests: PUBLIC_READ,
  },
  {
    name: "reports oldest year first",
    file: "src/public/queries.ts",
    from: ".orderBy(desc(reports.year), desc(reports.uploadedAt), byRowidDesc)",
    to: ".orderBy(asc(reports.year), desc(reports.uploadedAt), byRowidDesc)",
    tests: PUBLIC_READ,
  },
  {
    name: "blog oldest first",
    file: "src/public/queries.ts",
    from: "const newestFirst = [desc(blogPosts.publishedAt), byRowidDesc] as const;",
    to: "const newestFirst = [asc(blogPosts.publishedAt), byRowidDesc] as const;",
    tests: PUBLIC_BLOG,
  },
  {
    name: "featured article repeated in the grid",
    file: "src/public/queries.ts",
    from: "and(published, ne(blogPosts.id, sql`(${featuredId})`))",
    to: "published",
    tests: PUBLIC_BLOG,
  },
  {
    name: "blog page not clamped to the last page",
    file: "src/public/blog-rules.ts",
    from: "const page = Math.min(Math.max(1, requestedPage ?? 1), totalPages);",
    to: "const page = Math.max(1, requestedPage ?? 1);",
    tests: `${PUBLIC_BLOG} test/public-rules.test.ts`,
  },
  {
    name: "related window one day too wide",
    file: "src/public/blog-rules.ts",
    from: "export const RELATED_WINDOW_DAYS = 180;",
    to: "export const RELATED_WINDOW_DAYS = 181;",
    tests: `${PUBLIC_BLOG} test/public-rules.test.ts`,
  },
  {
    name: "Cache-Control of the lists no longer the contract's",
    file: "src/public/cache.ts",
    from: 'export const CACHE_CONTENT = "public, s-maxage=60, stale-while-revalidate=300";',
    to: 'export const CACHE_CONTENT = "public, s-maxage=3600";',
    tests: PUBLIC_READ,
  },
  {
    name: "public answers put behind a blanket no-store (the entrypoint's app wraps every answer)",
    file: "src/api/public/index.ts",
    from: '  app.use("*", markServiceBindingCall);\n  app.route(PUBLIC_BASE_PATH, publicReadRoutes);',
    to: '  app.use("*", markServiceBindingCall);\n  app.use("*", async (c, next) => {\n    await next();\n    c.header("Cache-Control", "no-store");\n  });\n  app.route(PUBLIC_BASE_PATH, publicReadRoutes);',
    tests: PUBLIC_READ,
  },
  {
    name: "read endpoints mounted on the public face again (reachable from the internet: cache-busting query strings spend the daily D1 read budget)",
    file: "src/api/public/index.ts",
    from: "export function createPublicApp() {\n  const app = new Hono<{ Bindings: Bindings }>();\n  return app;\n}",
    to: "export function createPublicApp() {\n  const app = new Hono<{ Bindings: Bindings }>();\n  app.route(PUBLIC_BASE_PATH, publicReadRoutes);\n  return app;\n}",
    tests: PUBLIC_FACE,
  },
  {
    name: "read endpoints dropped from the PublicApi entrypoint's app (the Astro Worker would read nothing)",
    file: "src/api/public/index.ts",
    from: '  app.use("*", markServiceBindingCall);\n  app.route(PUBLIC_BASE_PATH, publicReadRoutes);',
    to: '  app.use("*", markServiceBindingCall);',
    tests: `${PUBLIC_READ} ${PUBLIC_FACE}`,
  },

  // --------------------------------------------------- the public API: the budget
  {
    name: "blog index queries run one after the other instead of in one batch (round trips triple)",
    file: "src/api/public/read.ts",
    from: "const [featuredRows, countRows, guessedRows] = await db.batch([\n    featuredPostQuery(db),\n    publishedCountQuery(db),\n    blogPageQuery(db, pageSize, (guessedPage - 1) * pageSize),\n  ]);",
    to: "const featuredRows = await featuredPostQuery(db);\n  const countRows = await publishedCountQuery(db);\n  const guessedRows = await blogPageQuery(db, pageSize, (guessedPage - 1) * pageSize);",
    tests: PUBLIC_BUDGET,
  },
  {
    name: "an impossible slug is looked up in D1 instead of refused (no shape check)",
    file: "src/api/public/read.ts",
    from: "if (slug.length > SLUG_MAX_LENGTH || !SLUG_PATTERN.test(slug)) return notFound(c);",
    to: "",
    tests: PUBLIC_BUDGET,
  },
  {
    name: "index for the featured article dropped from the migration (a sort of every article)",
    file: "migrations/0004_public_blog_index.sql",
    from: "CREATE INDEX `blog_posts_status_featured_published_idx` ON `blog_posts` (`status`,`featured`,`published_at`);",
    to: "SELECT 1;",
    tests: PUBLIC_BUDGET,
  },

  // ------------------------------------------- the public API: the contact form
  {
    name: "contact route mounted on the public app, with the service binding mark (the internet can post)",
    file: "src/api/public/index.ts",
    from: "export function createPublicApp() {\n  const app = new Hono<{ Bindings: Bindings }>();\n",
    to: 'export function createPublicApp() {\n  const app = new Hono<{ Bindings: Bindings }>();\n  app.use("*", markServiceBindingCall);\n  app.route(PUBLIC_BASE_PATH, createContactRoutes(resolveContactDeps));\n',
    tests: `${PUBLIC_CONTACT} ${PUBLIC_FACE}`,
  },
  {
    name: "contact route no longer checks that the call came through the binding",
    file: "src/api/public/contact.ts",
    from: 'routes.post("/contact", requireServiceBinding, async (c) => {',
    to: 'routes.post("/contact", async (c) => {',
    tests: PUBLIC_CONTACT,
  },
  {
    name: "visitor address taken from CF-Connecting-IP when the header is missing",
    file: "src/api/public/contact.ts",
    from: "const ip = c.req.header(CLIENT_IP_HEADER)?.trim();",
    to: 'const ip = (c.req.header(CLIENT_IP_HEADER) ?? c.req.header("cf-connecting-ip"))?.trim();',
    tests: PUBLIC_CONTACT,
  },
  {
    name: "visitor address taken from X-Forwarded-For",
    file: "src/api/public/contact.ts",
    from: "const ip = c.req.header(CLIENT_IP_HEADER)?.trim();",
    to: 'const ip = (c.req.header("x-forwarded-for")?.split(",")[0] ?? c.req.header(CLIENT_IP_HEADER))?.trim();',
    tests: PUBLIC_CONTACT,
  },
  {
    name: "contact rate limit not applied",
    file: "src/api/public/contact.ts",
    from: "if (!verdict.allowed) {",
    to: "if (false) {",
    tests: PUBLIC_CONTACT,
  },
  {
    name: "contact body size not capped while reading",
    file: "src/api/public/contact.ts",
    from: "if (size > max) {",
    to: "if (false) {",
    tests: PUBLIC_CONTACT,
  },
  {
    name: "contact honeypot hit is processed like a real message",
    file: "src/api/public/contact.ts",
    from: 'if (parsed.kind === "honeypot") return c.json({ ok: true, message: CONTACT_MESSAGES.success }, 201, headers);',
    to: "",
    tests: PUBLIC_CONTACT,
  },
  {
    name: "contact duplicate guard removed (the same email is saved again within 5 minutes)",
    file: "src/public/contact.ts",
    from: "WHERE NOT EXISTS (SELECT 1 FROM contact_messages WHERE email = ? AND created_at >= ?)",
    to: "WHERE ? IS NOT NULL AND ? IS NOT NULL",
    tests: PUBLIC_CONTACT,
  },
  {
    name: "contact audit row written even when the message was refused as a duplicate",
    file: "src/public/contact.ts",
    from: "WHERE EXISTS (SELECT 1 FROM contact_messages WHERE id = ?)",
    to: "WHERE ? IS NOT NULL",
    tests: PUBLIC_CONTACT,
  },

  // ----------------------- the contact seam: the shared limiter and Turnstile
  {
    name: "contact seam: Turnstile bypassed (a check that passes everything)",
    file: "src/public/contact-deps.ts",
    from: "verifyTurnstile: sharedTurnstile(env),",
    to: "verifyTurnstile: turnstileDisabled,",
    tests: PUBLIC_CONTACT,
  },
  {
    name: "contact seam: a Turnstile check that cannot run is counted as passed (fails open)",
    file: "src/public/contact-deps.ts",
    from: 'throw new ContactInfrastructureError("TurnstileUnavailable");',
    to: "return true;",
    tests: PUBLIC_CONTACT,
  },
  {
    name: "contact seam: a missing rate limit binding no longer refuses in production",
    file: "src/public/contact-deps.ts",
    from: 'if (result.reason === "unavailable") throw new ContactInfrastructureError("RateLimitUnavailable");',
    to: 'if (result.reason === "unavailable") return { allowed: true, retryAfterSeconds: 0 };',
    tests: PUBLIC_CONTACT,
  },
  {
    name: "contact seam: the limiter is asked about a different key than the route built",
    file: "src/public/contact-deps.ts",
    from: 'const result = await checkLimits(env, [{ name: "contact", key }]);',
    to: 'const result = await checkLimits(env, [{ name: "contact", key: "contact:shared" }]);',
    tests: PUBLIC_CONTACT,
  },
  {
    name: "contact seam: the token is checked for the wrong form (action not contact)",
    file: "src/public/contact-deps.ts",
    from: 'token, ip, "contact");',
    to: 'token, ip, "login");',
    tests: PUBLIC_CONTACT,
  },

  // ------------------------------------------------ the public API: purge plan
  {
    name: "purge plan of a team save names no cache tag",
    file: "src/public/purge.ts",
    from: "return { paths: [PATHS.team], tags: [TAGS.team] };",
    to: "return { paths: [PATHS.team], tags: [] };",
    tests: PUBLIC_PURGE,
  },
  // ---------------------------------------- the SPA and the Worker agree (SAKEM-082)
  // The SPA's own side of these is in negative-checks-spa.mjs; these break the
  // agreement from either end and expect test/spa-contract.test.ts to notice.
  {
    name: "the SPA sends the Turnstile token under another header name",
    file: "spa/src/lib/captcha.ts",
    from: 'export const TURNSTILE_HEADER = "X-Turnstile-Token";',
    to: 'export const TURNSTILE_HEADER = "X-Captcha-Token";',
    tests: "test/spa-contract.test.ts",
  },
  {
    name: "the Worker asks another action of the sign-in widget than the SPA declares",
    file: "src/auth/gate.ts",
    from: 'turnstile: "login",',
    to: 'turnstile: "register",',
    tests: "test/spa-contract.test.ts",
  },
  {
    name: "the Worker renames captcha_failed, which the SPA maps",
    file: "src/security/turnstile.ts",
    from: 'error: "captcha_failed"',
    to: 'error: "captcha_denied"',
    tests: "test/spa-contract.test.ts",
  },
  {
    name: "the Worker renames email_unavailable, which the SPA maps",
    file: "src/auth/gate.ts",
    from: 'error: "email_unavailable"',
    to: 'error: "email_missing"',
    tests: "test/spa-contract.test.ts",
  },
  {
    name: "the SPA stops mapping captcha_unavailable",
    file: "spa/src/lib/auth-errors.ts",
    from: 'if (code === "captcha_unavailable") return CAPTCHA_UNAVAILABLE_MESSAGE;',
    to: "",
    tests: "test/spa-contract.test.ts",
  },
];

// `node scripts/negative-checks.mjs --only <text>` runs the checks whose name contains <text>.
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : undefined;

let bad = 0;
let ran = 0;
for (const check of checks) {
  if (only && !check.name.includes(only)) continue;
  ran++;
  const edits = check.edits ?? [{ file: check.file, from: check.from, to: check.to }];
  const originals = new Map(edits.map((edit) => [edit.file, readFileSync(edit.file, "utf8")]));
  const missing = edits.find((edit) => originals.get(edit.file).split(edit.from).length - 1 !== 1);
  if (missing) {
    const occurrences = originals.get(missing.file).split(missing.from).length - 1;
    console.log(`FAIL  ${check.name}: pattern found ${occurrences} times in ${missing.file}, expected exactly once`);
    bad++;
    continue;
  }
  try {
    for (const edit of edits) writeFileSync(edit.file, readFileSync(edit.file, "utf8").replace(edit.from, () => edit.to));
    const run = spawnSync("pnpm", ["exec", "vitest", "run", ...check.tests.split(" ")], { encoding: "utf8" });
    const failed = (run.stdout + run.stderr).match(/Tests\s+(\d+) failed/);
    if (run.status !== 0 && failed) console.log(`OK    ${check.name}: ${failed[1]} test(s) failed as they should`);
    else {
      console.log(`FAIL  ${check.name}: tests still pass (exit ${run.status})`);
      bad++;
    }
  } finally {
    for (const [file, original] of originals) writeFileSync(file, original);
  }
}
console.log(bad === 0 ? `\nAll ${ran} safeguards are covered by tests.` : `\n${bad} of ${ran} checks did not behave.`);
process.exit(bad === 0 ? 0 : 1);
