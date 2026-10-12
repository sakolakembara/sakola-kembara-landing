// Proves the tests are not vacuous: each check breaks one safeguard in the
// source (or in a migration), runs the tests that should notice, expects them
// to FAIL, and always restores the file.
//
//   node scripts/negative-checks.mjs        (pnpm test:negative)
//
// Run it on a clean tree: it rewrites files under src/ and migrations/ for a
// few seconds each. A check whose pattern is not found exactly once is
// reported as FAIL, so a refactor that moves the code cannot silently turn a
// check into a no-op.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const PERMISSION_TESTS = "test/permissions.test.ts test/areas.test.ts test/announcements.test.ts";

// The public API (SAKEM-081, part C): docs/cloudflare/public-api.md.
const PUBLIC_READ = "test/public-read.test.ts";
const PUBLIC_BLOG = "test/public-blog.test.ts";
const PUBLIC_LEAK = "test/public-leak.test.ts";
const PUBLIC_CONTACT = "test/public-contact.test.ts";
const PUBLIC_BUDGET = "test/public-budget.test.ts";
const PUBLIC_PURGE = "test/public-purge.test.ts";

const checks = [
  // ---------------------------------------------------------------- auth
  {
    name: "verification requirement removed",
    file: "src/auth/factory.ts",
    from: "requireEmailVerification: true,",
    to: "requireEmailVerification: false,",
    tests: "test/auth.test.ts",
  },
  {
    name: "rate limiting not mounted",
    file: "src/worker.ts",
    from: "app.use(`${AUTH_BASE_PATH}/*`, authRateLimit);",
    to: "",
    tests: "test/rate-limit.test.ts",
  },
  {
    name: "production treated as development (email no longer fails closed)",
    file: "src/env.ts",
    from: 'return env.ENVIRONMENT !== "development" && env.ENVIRONMENT !== "test";',
    to: "return false;",
    tests: "test/auth.test.ts",
  },
  {
    name: "clients may set their own role",
    file: "src/auth/factory.ts",
    from: 'defaultValue: "student", input: false',
    to: 'defaultValue: "student", input: true',
    tests: "test/auth.test.ts",
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
    from: 'return grantedAreas.includes(area) ? "write" : "read";',
    to: 'return "write";',
    tests: PERMISSION_TESTS,
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
    name: "public answers put behind the admin API's blanket no-store",
    file: "src/worker.ts",
    from: 'app.route("/", createPublicApp());',
    to: 'app.use("/api/public/*", async (c, next) => {\n  await next();\n  c.header("Cache-Control", "no-store");\n});\napp.route("/", createPublicApp());',
    tests: PUBLIC_READ,
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
    tests: PUBLIC_CONTACT,
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

  // ------------------------------------------------ the public API: purge plan
  {
    name: "purge plan of a team save names no cache tag",
    file: "src/public/purge.ts",
    from: "return { paths: [PATHS.team], tags: [TAGS.team] };",
    to: "return { paths: [PATHS.team], tags: [] };",
    tests: PUBLIC_PURGE,
  },
];

let bad = 0;
for (const check of checks) {
  const original = readFileSync(check.file, "utf8");
  const occurrences = original.split(check.from).length - 1;
  if (occurrences !== 1) {
    console.log(`FAIL  ${check.name}: pattern found ${occurrences} times in ${check.file}, expected exactly once`);
    bad++;
    continue;
  }
  try {
    writeFileSync(check.file, original.replace(check.from, () => check.to));
    const run = spawnSync("pnpm", ["exec", "vitest", "run", ...check.tests.split(" ")], { encoding: "utf8" });
    const failed = (run.stdout + run.stderr).match(/Tests\s+(\d+) failed/);
    if (run.status !== 0 && failed) console.log(`OK    ${check.name}: ${failed[1]} test(s) failed as they should`);
    else {
      console.log(`FAIL  ${check.name}: tests still pass (exit ${run.status})`);
      bad++;
    }
  } finally {
    writeFileSync(check.file, original);
  }
}
console.log(bad === 0 ? `\nAll ${checks.length} safeguards are covered by tests.` : `\n${bad} of ${checks.length} checks did not behave.`);
process.exit(bad === 0 ? 0 : 1);
