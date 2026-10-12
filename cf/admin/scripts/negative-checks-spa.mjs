// The SPA twin of negative-checks.mjs: proves the SPA tests are not vacuous.
// Each check breaks one safeguard in the source, runs the tests that should
// notice, expects them to FAIL, and always restores the file.
//
//   node scripts/negative-checks-spa.mjs
//
// Run it on a clean tree: it rewrites files under spa/src/ for a few seconds.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const t = (...names) => names.map((name) => `spa/test/${name}`).join(" ");

const checks = [
  // Who may see and do what
  {
    name: "viewer allowed to write",
    file: "spa/src/lib/access.ts",
    from: '      return section === "sistem" ? "none" : "read";',
    to: '      return section === "sistem" ? "none" : "write";',
    tests: t("access.test.ts", "nav.test.ts", "dashboard.test.tsx"),
  },
  {
    name: "viewer shown Sistem",
    file: "spa/src/lib/access.ts",
    from: '      return section === "sistem" ? "none" : "read";',
    to: '      return "read";',
    tests: t("access.test.ts", "sidebar.test.tsx"),
  },
  {
    name: "editor allowed into Sistem",
    file: "spa/src/lib/access.ts",
    from: '      if (section === "sistem") return "none";\n      if (!GRANTABLE',
    to: "      if (!GRANTABLE",
    tests: t("access.test.ts", "routes.test.tsx"),
  },
  {
    name: "editor writes outside the granted areas",
    file: "spa/src/lib/access.ts",
    from: 'return (me.areas as readonly string[]).includes(section) ? "write" : "read";',
    to: 'return "write";',
    tests: t("access.test.ts", "nav.test.ts", "dashboard.test.tsx", "announcements.test.tsx"),
  },
  {
    name: "shortcuts shown whatever the access",
    file: "spa/src/lib/nav.ts",
    from: 'return QUICK_ACTIONS.filter((action) => accessTo(me, action.section) === "write");',
    to: "return [...QUICK_ACTIONS];",
    tests: t("nav.test.ts", "dashboard.test.tsx"),
  },
  // Route guard
  {
    name: "a student let into the admin",
    file: "spa/src/lib/guard.ts",
    from: 'return accessTo(state.me, "umum") === "none"',
    to: "return false",
    tests: t("guard.test.ts", "routes.test.tsx"),
  },
  {
    name: "403 page never shown",
    file: "spa/src/components/RequireAuth.tsx",
    from: 'return accessTo(me, section) === "none" ? <ForbiddenPage /> : <Outlet />;',
    to: "return <Outlet />;",
    tests: t("routes.test.tsx"),
  },
  {
    name: "sign-in redirect forgets the page asked for",
    file: "spa/src/lib/guard.ts",
    from: 'to: state.byUser ? "/login" : loginPath(',
    to: 'to: true ? "/login" : loginPath(',
    tests: t("guard.test.ts", "routes.test.tsx"),
  },
  {
    name: "off-site `from` accepted after sign-in",
    file: "spa/src/lib/guard.ts",
    // Two layers keep it on this site: the pre-checks and the URL origin check.
    from: ['!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\\\")', 'if (url.origin !== "http://admin.invalid") return null;'],
    to: ['!raw.startsWith("/")', ""],
    tests: t("guard.test.ts", "login.test.tsx"),
  },
  {
    name: "error boundary never clears",
    file: "spa/src/components/ErrorBoundary.tsx",
    from: "previous.resetKey !== this.props.resetKey",
    to: "false",
    tests: t("routes.test.tsx"),
  },
  // Drawer
  {
    name: "drawer ignores Escape",
    file: "spa/src/lib/hooks.ts",
    from: 'if (event.key === "Escape") {',
    to: 'if (event.key === "Escape-disabled") {',
    tests: t("drawer.test.tsx"),
  },
  {
    name: "drawer Tab does not wrap forward",
    file: "spa/src/lib/hooks.ts",
    from: "} else if (!event.shiftKey && (!inside || active === last)) {",
    to: "} else if (false) {",
    tests: t("drawer.test.tsx"),
  },
  {
    name: "drawer Shift+Tab does not wrap backward",
    file: "spa/src/lib/hooks.ts",
    from: "if (event.shiftKey && (!inside || active === first)) {",
    to: "if (false) {",
    tests: t("drawer.test.tsx"),
  },
  {
    name: "drawer does not give focus back",
    file: "spa/src/lib/hooks.ts",
    from: "if (focusLost && target?.isConnected) target.focus();",
    to: "",
    tests: t("drawer.test.tsx"),
  },
  {
    name: "drawer gives focus back to whatever was active on open (not the menu button)",
    file: "spa/src/lib/hooks.ts",
    from: "const target = restoreTo?.current ?? opener;",
    to: "const target = opener;",
    tests: t("drawer.test.tsx"),
  },
  // Forms
  {
    name: "double submit allowed",
    file: "spa/src/lib/hooks.ts",
    from: "if (locked.current) return;",
    to: "",
    tests: t("login.test.tsx", "password-reset.test.tsx", "sidebar.test.tsx", "announcements.test.tsx"),
  },
  {
    name: "sign-in sends no verification callback",
    file: "spa/src/pages/auth/Login.tsx",
    from: "json: { ...checked.values, callbackURL: VERIFY_CALLBACK },",
    to: "json: { ...checked.values },",
    tests: t("login.test.tsx"),
  },
  {
    name: "a hand-opened verification page claims success",
    file: "spa/src/lib/auth-errors.ts",
    from: 'if (params.status === "success") {',
    to: "if (true) {",
    tests: t("auth-errors.test.ts", "password-reset.test.tsx"),
  },
  {
    name: "unknown ?error= text is echoed",
    file: "spa/src/lib/auth-errors.ts",
    from: "return Object.hasOwn(QUERY_ERRORS, code) ? (QUERY_ERRORS[code] as string) : GENERIC_SIGN_IN_ERROR;",
    to: "return QUERY_ERRORS[code] ?? code;",
    tests: t("auth-errors.test.ts", "login.test.tsx"),
  },
];

let bad = 0;
for (const check of checks) {
  const original = readFileSync(check.file, "utf8");
  // `from`/`to` may be lists, to break a safeguard that has more than one layer.
  const froms = [check.from].flat();
  const tos = [check.to].flat();
  const missing = froms.find((from) => !original.includes(from));
  if (missing !== undefined) {
    console.log(`SKIP  ${check.name}: pattern not found in ${check.file}`);
    bad++;
    continue;
  }
  try {
    writeFileSync(check.file, froms.reduce((text, from, i) => text.replace(from, tos[i]), original));
    const run = spawnSync("pnpm", ["exec", "vitest", "run", "--config", "spa/vitest.config.ts", ...check.tests.split(" ")], {
      encoding: "utf8",
    });
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
