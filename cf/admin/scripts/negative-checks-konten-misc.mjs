// The negative checks of Laporan, Tim and Shortlink and of the shortlink redirect's API half (SAKEM-082), in their
// own file so the shared list in negative-checks.mjs stays short: it imports and spreads `kontenMiscChecks`. Same rules
// as there: each check breaks ONE safeguard in the source, runs the tests that must notice, expects them to FAIL, and
// the runner restores the file. A pattern found other than exactly once is reported as FAIL, so a refactor cannot
// turn a check into a no-op.
//
//   node scripts/negative-checks.mjs --only konten:
//
// The SPA's side is scripts/negative-checks-spa-konten-misc.mjs. The redirect's other half (cf/web) is tested in
// cf/web; its safeguards (the unsafe-target check, the 404-only-for-the-contract's-404 rule) are broken by hand, see
// docs/cloudflare/admin-konten.md ("Negative checks").

const REPORTS = "test/reports.test.ts";
const TEAM = "test/team.test.ts";
const SHORTLINKS = "test/shortlinks.test.ts";
const RULES = "test/shortlinks-rules.test.ts";
const REDIRECT = "test/shortlinks-redirect.test.ts";
const FACE = "test/public-face.test.ts";

export const kontenMiscChecks = [
  // ------------------------------------------------------------ who may do what (the area check)
  {
    name: "konten: a viewer may delete a report (the write guard of the delete route is a read guard)",
    file: "src/api/reports.ts",
    from: 'app.delete("/:id", requireArea("konten", "write"), creating.remove);',
    to: 'app.delete("/:id", requireArea("konten", "read"), creating.remove);',
    tests: REPORTS,
  },
  {
    name: "konten: a viewer may create a report (the write guard of the create route is a read guard)",
    file: "src/api/reports.ts",
    from: 'app.post("/", requireArea("konten", "write"), creating.create);',
    to: 'app.post("/", requireArea("konten", "read"), creating.create);',
    tests: REPORTS,
  },
  {
    name: "konten: the team routes check another area than konten",
    file: "src/api/team.ts",
    from: 'area: "konten",',
    to: 'area: "komunikasi",',
    tests: TEAM,
  },
  {
    name: "konten: the shortlink routes check another area than konten",
    file: "src/api/shortlinks.ts",
    from: 'area: "konten",',
    to: 'area: "pendaftaran",',
    tests: SHORTLINKS,
  },

  // ------------------------------------------------------------ lost updates (the stale check)
  {
    name: "konten: a stale update is applied (the version comparison of the update route removed)",
    file: "src/api/crud/resource.ts",
    from: "if (!matches(precondition, current)) return stale(c);",
    to: "",
    tests: `${REPORTS} ${TEAM} ${SHORTLINKS}`,
  },
  {
    name: "konten: the reports have no version (no PUT can carry If-Match)",
    file: "src/api/reports.ts",
    from: "    version: schema.reports.updatedAt,\n",
    to: "",
    tests: REPORTS,
  },
  {
    name: "konten: the shortlinks have no version (no PUT at all)",
    file: "src/api/shortlinks.ts",
    from: "  version: schema.shortlinks.updatedAt,\n",
    to: "",
    tests: SHORTLINKS,
  },

  // ------------------------------------------------------------ the rules of a report and of a member
  {
    name: "konten: the second year of an academic year can be anything (2025/2027 passes)",
    file: "src/reports/rules.ts",
    from: "return end === start + 1;",
    to: "return true;",
    tests: REPORTS,
  },
  {
    name: "konten: a report's file can be replaced by an update (the update's columns include the file)",
    file: "src/api/reports.ts",
    from: "      toRow: (input) => ({ title: input.title, description: input.description, category: input.category, year: input.year }),",
    to: "      toRow: (input) => ({ title: input.title, description: input.description, category: input.category, year: input.year, filePath: \"/uploads/report/2026/00000000-0000-4000-8000-000000000000-diganti.pdf\" }),",
    tests: REPORTS,
  },
  {
    name: "konten: the display order of a member has no upper bound",
    file: "src/api/team.ts",
    from: '.min(0, "Tidak boleh negatif").max(9999, "Maksimal 9999")',
    to: '.min(0, "Tidak boleh negatif")',
    tests: TEAM,
  },
  {
    name: "konten: a member's education history has no limit of 20 entries",
    file: "src/api/team.ts",
    from: 'z.array(educationEntry, { error: "Riwayat pendidikan tidak valid" }).max(20, "Maksimal 20 entri")',
    to: 'z.array(educationEntry, { error: "Riwayat pendidikan tidak valid" })',
    tests: TEAM,
  },
  {
    name: "konten: a member's photo can be a file of another kind",
    file: "src/api/team.ts",
    from: 'uploadPath(["team-photo"]).optional()',
    to: 'uploadPath(["team-photo", "report", "blog-image"]).optional()',
    tests: TEAM,
  },
  {
    name: "konten: the team list is not in the public page's order",
    file: "src/api/team.ts",
    from: "sql`${schema.teamMembers.category} || printf('%04d%015d', ${schema.teamMembers.displayOrder}, ${schema.teamMembers.createdAt})`",
    to: "sql`${schema.teamMembers.name}`",
    tests: TEAM,
  },
  {
    name: "konten: the report list is not in the public page's order (the upload time is not the tie-break)",
    file: "src/api/reports.ts",
    from: "sql`${schema.reports.year} || ' ' || printf('%015d', ${schema.reports.uploadedAt})`",
    to: "sql`${schema.reports.year}`",
    tests: REPORTS,
  },

  // ------------------------------------------------------------ the public side is told, and files are cleaned up
  {
    name: "konten: a report change does not ask for a purge of the reports feed",
    file: "src/api/reports.ts",
    from: '    purge: { area: "reports" },\n',
    to: "",
    tests: REPORTS,
  },
  {
    name: "konten: a team change does not ask for a purge of the team",
    file: "src/api/team.ts",
    from: '      purge: { area: "team" },\n',
    to: "",
    tests: TEAM,
  },
  {
    name: "konten: deleting a report leaves its PDF in the bucket",
    file: "src/api/reports.ts",
    from: "uploads: (row: ReportRow) => [row.filePath],",
    to: "uploads: () => [],",
    tests: REPORTS,
  },
  {
    name: "konten: replacing or removing a team photo leaves the old file in the bucket",
    file: "src/api/team.ts",
    from: "uploads: (row) => [row.image],",
    to: "uploads: () => [],",
    tests: TEAM,
  },

  // ------------------------------------------------------------ the target of a shortlink (no open redirect)
  {
    name: "konten: a shortlink target may use any scheme (javascript: is followed)",
    file: "src/shortlinks/rules.ts",
    from: 'if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false, message: MESSAGES.scheme };',
    to: "",
    tests: `${RULES} ${SHORTLINKS}`,
  },
  {
    name: "konten: a target that starts with // is a path (it leaves the site)",
    file: "src/shortlinks/rules.ts",
    from: "if (url.startsWith(\"//\")) return { ok: false, message: MESSAGES.external };",
    to: "",
    tests: `${RULES} ${SHORTLINKS}`,
  },
  {
    name: "konten: a backslash or a tab in a target is allowed (/\\evil.example is //evil.example to a browser)",
    file: "src/shortlinks/rules.ts",
    from: "const CONTROL_OR_BACKSLASH = /[\\u0000-\\u001f\\u007f\\\\]/;",
    to: "const CONTROL_OR_BACKSLASH = /(?!)/;",
    tests: `${RULES} ${SHORTLINKS} ${REDIRECT}`,
  },
  {
    name: "konten: a link may point at itself through a query, another case or a trailing slash",
    file: "src/shortlinks/rules.ts",
    from: "return target.split(/[?#]/, 1)[0]!.replace(/\\/+$/, \"\").toLowerCase();",
    to: "return target;",
    tests: RULES,
  },
  {
    name: "konten: the redirect follows any stored target (the check on the way out removed)",
    file: "src/api/public/shortlink.ts",
    from: "if (!row || !isSafeTarget(row.targetUrl)) return notFound(c);",
    to: "if (!row) return notFound(c);",
    tests: REDIRECT,
  },

  // ------------------------------------------------------------ reserved slugs
  {
    name: "konten: a slug of a page of the legacy list is no longer reserved (donasi)",
    file: "src/shortlinks/reserved.ts",
    from: '  "donasi",\n',
    to: "",
    tests: `${RULES} ${SHORTLINKS}`,
  },
  {
    name: "konten: a redirect source of the new site is no longer reserved (tentang-kami)",
    file: "src/shortlinks/reserved.ts",
    from: '  "tentang-kami",\n',
    to: "",
    tests: `${RULES} ${SHORTLINKS}`,
  },
  {
    name: "konten: a WordPress path the site forwards to its origin is no longer reserved (wp-admin)",
    file: "src/shortlinks/reserved.ts",
    from: '  "wp-admin",\n',
    to: "",
    tests: `${RULES} ${SHORTLINKS}`,
  },
  {
    name: "konten: the registration link's name is reserved again (daftar): the Daftar Sekarang buttons could not be created",
    file: "src/shortlinks/reserved.ts",
    from: '  "tentang-kami",\n',
    to: '  "tentang-kami",\n  "daftar",\n',
    tests: `${RULES} ${SHORTLINKS}`,
  },
  {
    name: "konten: the volunteer link's name is reserved again (apply): the Bergabung Menjadi Relawan button could not get its shortlink",
    file: "src/shortlinks/reserved.ts",
    from: '  "tentang-kami",\n',
    to: '  "tentang-kami",\n  "apply",\n',
    tests: `${RULES} ${SHORTLINKS}`,
  },
  {
    name: "konten: reserved slugs are not checked at all",
    file: "src/shortlinks/rules.ts",
    from: "  if (RESERVED_SLUGS.has(slug)) {",
    to: "  if (false) {",
    tests: `${RULES} ${SHORTLINKS}`,
  },

  // ------------------------------------------------------------ the click: after the answer, never in its way
  {
    name: "konten: the answer waits for the click's write (not in waitUntil)",
    edits: [
      { file: "src/api/public/shortlink.ts", from: "  waitUntilOf(c)(\n    recordClick(c.env.DB, row.id).catch(() => {", to: "  await Promise.all([\n    recordClick(c.env.DB, row.id).catch(() => {" },
      { file: "src/api/public/shortlink.ts", from: "    }),\n  );\n  return c.json({ shortlink: { targetUrl", to: "    }),\n  ]);\n  return c.json({ shortlink: { targetUrl" },
    ],
    tests: REDIRECT,
  },
  {
    name: "konten: a failed write of the click fails the answer (its error is not caught)",
    file: "src/api/public/shortlink.ts",
    from: "    recordClick(c.env.DB, row.id).catch(() => {\n      // Fixed text: no id, no slug, no error message.\n      console.error(\"[shortlinks] could not count a click\");\n    }),",
    to: "    recordClick(c.env.DB, row.id),",
    tests: REDIRECT,
  },
  {
    name: "konten: the click is never counted",
    file: "src/api/public/shortlink.ts",
    from: "  waitUntilOf(c)(\n    recordClick(c.env.DB, row.id).catch(() => {",
    to: "  waitUntilOf(c)(\n    Promise.resolve().catch(() => {",
    tests: REDIRECT,
  },
  {
    name: "konten: a visit sets the count to one instead of adding one",
    file: "src/public/shortlink.ts",
    from: 'export const CLICK_SQL = "UPDATE shortlinks SET click_count = click_count + 1, last_clicked_at = ? WHERE id = ?";',
    to: 'export const CLICK_SQL = "UPDATE shortlinks SET click_count = 1, last_clicked_at = ? WHERE id = ?";',
    tests: REDIRECT,
  },
  {
    name: "konten: a click bumps updated_at (an admin's open form turns stale)",
    file: "src/public/shortlink.ts",
    from: 'export const CLICK_SQL = "UPDATE shortlinks SET click_count = click_count + 1, last_clicked_at = ? WHERE id = ?";',
    to: 'export const CLICK_SQL = "UPDATE shortlinks SET click_count = click_count + 1, last_clicked_at = ?, updated_at = updated_at + 1 WHERE id = ?";',
    tests: `${REDIRECT} ${SHORTLINKS}`,
  },
  {
    name: "konten: an inactive link still redirects",
    file: "src/public/shortlink.ts",
    from: "    .where(and(eq(shortlinks.slug, slug), eq(shortlinks.active, true)))",
    to: "    .where(eq(shortlinks.slug, slug))",
    tests: REDIRECT,
  },
  {
    name: "konten: a path that cannot be a slug reaches D1",
    file: "src/api/public/shortlink.ts",
    from: "if (!isShortlinkSlug(slug)) return notFound(c);",
    to: "",
    tests: REDIRECT,
  },
  {
    name: "konten: the redirect lookup is served on the Worker's public face too (any visitor can read it)",
    file: "src/api/public/index.ts",
    from: "  const app = new Hono<{ Bindings: Bindings }>();\n  return app;\n}",
    to: "  const app = new Hono<{ Bindings: Bindings }>();\n  app.route(PUBLIC_BASE_PATH, publicShortlinkRoutes);\n  return app;\n}",
    tests: `${REDIRECT} ${FACE}`,
  },
  {
    name: "konten: the redirect lookup is cached by whoever sits in front (it is told it may be)",
    file: "src/api/public/shortlink.ts",
    from: 'return c.json({ shortlink: { targetUrl: row.targetUrl } }, 200, { "Cache-Control": CACHE_NONE });',
    to: 'return c.json({ shortlink: { targetUrl: row.targetUrl } }, 200, { "Cache-Control": "public, s-maxage=60" });',
    tests: REDIRECT,
  },
];
