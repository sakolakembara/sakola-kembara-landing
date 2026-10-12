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
