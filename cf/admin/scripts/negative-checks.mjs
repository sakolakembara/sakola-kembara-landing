// Proves the tests are not vacuous: each check breaks one safeguard in the
// source, runs the tests, expects them to FAIL, and always restores the file.
//
//   node scripts/negative-checks.mjs
//
// Run it on a clean tree: it rewrites files under src/ for a few seconds.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const checks = [
  {
    name: "verification requirement removed",
    file: "src/auth/factory.ts",
    from: "requireEmailVerification: true,",
    to: "requireEmailVerification: false,",
    tests: "test/auth.test.ts",
  },
  {
    name: "viewer allowed to write",
    file: "src/auth/roles.ts",
    from: '"admin-write": ["editor", "super_admin"],',
    to: '"admin-write": ["viewer", "editor", "super_admin"],',
    tests: "test/roles.test.ts test/announcements.test.ts",
  },
  {
    name: "route guard disabled for writes",
    file: "src/api/announcements.ts",
    from: 'announcementRoutes.post("/", requireAccess("admin-write"),',
    to: 'announcementRoutes.post("/", requireAccess("admin-read"),',
    tests: "test/announcements.test.ts",
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
];

let bad = 0;
for (const check of checks) {
  const original = readFileSync(check.file, "utf8");
  if (!original.includes(check.from)) {
    console.log(`SKIP  ${check.name}: pattern not found in ${check.file}`);
    bad++;
    continue;
  }
  try {
    writeFileSync(check.file, original.replace(check.from, check.to));
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
process.exit(bad === 0 ? 0 : 1);
