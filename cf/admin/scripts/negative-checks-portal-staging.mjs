// The negative checks of the portal's staging environment (SAKEM-098), in their own file so the shared list in
// negative-checks.mjs stays short: it imports and spreads `portalStagingChecks`. Same rules as there: each check breaks ONE
// safeguard (in the portal's wrangler configuration, in the portal's source, or in the SQL of the staging runbook), runs the
// tests that must notice, expects them to FAIL, and the runner restores the file. A pattern found other than exactly once
// is reported as FAIL, so a refactor cannot turn a check into a no-op.
//
//   node scripts/negative-checks.mjs --only "portal staging:"

const CONFIG = "test/portal-staging-config.test.ts";
const FOUNDATION = "test/portal-foundation-config.test.ts";
const SQL = "test/staging-runbook-sql.test.ts";

const PORTAL = "wrangler.portal.jsonc";
const RUNBOOK = "../../docs/cloudflare/staging-runbook.md";

export const portalStagingChecks = [
  // ------------------------------------------------ the staging block names resources of staging, and only those
  {
    name: "portal staging: the staging Worker uses the PRODUCTION database",
    file: PORTAL,
    from: '"database_name": "sakem-staging"',
    to: '"database_name": "sakem-admin"',
    tests: CONFIG,
  },
  {
    name: "portal staging: the private bucket of staging is the PRODUCTION private bucket",
    file: PORTAL,
    from: '"bucket_name": "sakem-private-staging"',
    to: '"bucket_name": "sakem-private"',
    tests: CONFIG,
  },
  {
    name: "portal staging: the admin's PUBLIC bucket is bound to the portal",
    file: PORTAL,
    from: '"r2_buckets": [{ "binding": "PRIVATE_FILES", "bucket_name": "sakem-private-staging" }],',
    to: '"r2_buckets": [{ "binding": "PRIVATE_FILES", "bucket_name": "sakem-private-staging" }, { "binding": "UPLOADS", "bucket_name": "sakem-files-staging" }],',
    tests: CONFIG,
  },
  {
    name: "portal staging: the staging Worker is named like the production one",
    file: PORTAL,
    from: '"name": "sakem-portal-staging",',
    to: '"name": "sakem-portal",',
    tests: CONFIG,
  },

  // ------------------------------------------------ rate limit namespaces: ids are per account, a shared one shares a counter
  {
    name: "portal staging: a limiter of staging shares its namespace with the portal's production one",
    file: PORTAL,
    from: '"namespace_id": "8131"',
    to: '"namespace_id": "8031"',
    tests: `${CONFIG} ${FOUNDATION}`,
  },
  {
    name: "portal staging: a limiter of staging shares its namespace with the admin's staging one",
    file: PORTAL,
    from: '"namespace_id": "8101"',
    to: '"namespace_id": "7901"',
    tests: `${CONFIG} ${FOUNDATION}`,
  },
  {
    name: "portal staging: a limiter of staging has another limit than the top level and the table",
    file: PORTAL,
    from: '{ "name": "RL_PORTAL_SUBMIT", "namespace_id": "8134", "simple": { "limit": 3, "period": 60 } }',
    to: '{ "name": "RL_PORTAL_SUBMIT", "namespace_id": "8134", "simple": { "limit": 30, "period": 60 } }',
    tests: CONFIG,
  },

  // ------------------------------------------------ the environment keeps every fail-closed rule, and nothing is set that belongs to the deploy
  {
    name: "portal staging: the staging environment says development (email, Turnstile and rate limits would fail open)",
    file: PORTAL,
    from: '"ENVIRONMENT": "staging",',
    to: '"ENVIRONMENT": "development",',
    tests: CONFIG,
  },
  {
    name: "portal staging: a per-deploy public variable is left out of the staging block",
    file: PORTAL,
    from: '        "PORTAL_CONTACT_WHATSAPP": "",\n        "PORTAL_WHATSAPP_GROUP_URL": ""',
    to: '        "PORTAL_CONTACT_WHATSAPP": ""',
    tests: CONFIG,
  },
  {
    name: "portal staging: a per-deploy public variable carries a value in git",
    file: PORTAL,
    from: '"SITE_URL": "",',
    to: '"SITE_URL": "https://example.workers.dev",',
    tests: `${CONFIG} ${FOUNDATION}`,
  },
  {
    name: "portal staging: the staging block is not on workers.dev",
    file: PORTAL,
    from: '"workers_dev": true,',
    to: '"workers_dev": false,',
    tests: CONFIG,
  },
  {
    name: "portal staging: the staging block carries a route",
    file: PORTAL,
    from: '"preview_urls": false,',
    to: '"preview_urls": false,\n      "routes": ["example.test/portal/*"],',
    tests: CONFIG,
  },
  {
    name: "portal staging: the portal's code reads a variable the staging block does not declare",
    file: "src/portal/worker.ts",
    from: "adminUrl: publicOrigin(c.env.ADMIN_URL),",
    to: "adminUrl: publicOrigin(c.env.ADMIN_URL ?? c.env.PORTAL_BRAND_URL),",
    tests: CONFIG,
  },

  // ------------------------------------------------ the SQL of the runbook that deletes one invented applicant
  {
    name: "portal staging: the cleanup leaves the invented applicant's account",
    file: RUNBOOK,
    from: "DELETE FROM users WHERE email = '$E' AND role = 'student';\n",
    to: "",
    tests: SQL,
  },
  {
    name: "portal staging: the cleanup deletes any account with that address, an admin's too",
    file: RUNBOOK,
    from: "DELETE FROM users WHERE email = '$E' AND role = 'student';",
    to: "DELETE FROM users WHERE email = '$E';",
    tests: SQL,
  },
  {
    name: "portal staging: the cleanup deletes every applicant's file rows, not the invented one's",
    file: RUNBOOK,
    from: "DELETE FROM application_files WHERE application_id IN (",
    to: "DELETE FROM application_files WHERE 1 = 1 OR application_id IN (",
    tests: SQL,
  },
  {
    name: "portal staging: the cleanup recounts the storage counter with the files it marked deleted",
    file: RUNBOOK,
    from: "SELECT COALESCE(SUM(size), 0) FROM application_files WHERE deleted_at IS NULL)",
    to: "SELECT COALESCE(SUM(size), 0) FROM application_files)",
    tests: SQL,
  },
  {
    name: "portal staging: the precheck counts files already marked deleted as live",
    file: RUNBOOK,
    from: "SELECT count(*) AS live_files FROM application_files WHERE deleted_at IS NULL AND application_id IN (",
    to: "SELECT count(*) AS live_files FROM application_files WHERE application_id IN (",
    tests: SQL,
  },
];
