// The SPA twin of negative-checks.mjs: proves the SPA tests are not vacuous.
// Each check breaks one safeguard in the source, runs the tests that should
// notice, expects them to FAIL, and always restores the file.
//
//   node scripts/negative-checks-spa.mjs
//
// Run it on a clean tree: it rewrites files under spa/src/ for a few seconds.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { crudSpaChecks } from "./negative-checks-spa-crud.mjs";
import { sistemSpaChecks } from "./negative-checks-spa-sistem.mjs";
import { komunikasiSpaChecks } from "./negative-checks-spa-komunikasi.mjs";
import { kontenMiscSpaChecks } from "./negative-checks-spa-konten-misc.mjs";

const t = (...names) => names.map((name) => `spa/test/${name}`).join(" ");

const checks = [
  // The admin CRUD kit (SAKEM-082): scripts/negative-checks-spa-crud.mjs.
  ...crudSpaChecks,

  // Aktivitas and Pengaturan (SAKEM-082): scripts/negative-checks-spa-sistem.mjs.
  ...sistemSpaChecks,

  // The Komunikasi area, Pesan and Pengumuman (SAKEM-082): scripts/negative-checks-spa-komunikasi.mjs.
  ...komunikasiSpaChecks,

  // Laporan, Tim and Shortlink (SAKEM-082): scripts/negative-checks-spa-konten-misc.mjs.
  ...kontenMiscSpaChecks,

  // Who may see and do what
  {
    name: "read-only areas shown as writable",
    file: "spa/src/lib/access.ts",
    from: 'if (me.areas.visible.includes(section)) return "read";',
    to: 'if (me.areas.visible.includes(section)) return "write";',
    tests: t("access.test.ts", "nav.test.ts", "dashboard.test.tsx"),
  },
  {
    name: "areas the server did not list shown anyway",
    file: "spa/src/lib/access.ts",
    from: '  return "none";\n}',
    to: '  return "read";\n}',
    tests: t("access.test.ts", "sidebar.test.tsx"),
  },
  {
    name: "the writable list ignored (everything visible is writable)",
    file: "spa/src/lib/access.ts",
    from: 'if (me.areas.writable.includes(section)) return "write";',
    to: 'if (me.areas.visible.includes(section)) return "write";',
    tests: t("access.test.ts", "nav.test.ts", "dashboard.test.tsx", "announcements.test.tsx"),
  },
  {
    name: "a student believed because their payload lists areas",
    file: "spa/src/lib/access.ts",
    from: "if (!me || !isAdminRole(me.role)) return \"none\";",
    to: "if (!me) return \"none\";",
    tests: t("access.test.ts"),
  },
  {
    name: "an unknown role kept as the server sent it",
    file: "spa/src/lib/me.ts",
    from: 'role: isRole(raw.role) ? raw.role : "student",',
    to: "role: raw.role as Role,",
    tests: t("me.test.ts"),
  },
  {
    name: "shortcuts shown whatever the access",
    file: "spa/src/lib/nav.ts",
    from: 'return QUICK_ACTIONS.filter((action) => accessTo(me, action.section) === "write");',
    to: "return [...QUICK_ACTIONS];",
    tests: t("nav.test.ts", "dashboard.test.tsx"),
  },
  // The dashboard (SAKEM-082): two blocks, drawn from what the server sent
  {
    name: "a tile drawn for an item the server did not send (the message tile is not conditional)",
    file: "spa/src/pages/dashboard/Attention.tsx",
    from: "{unreadMessages && (",
    to: "{true && (",
    tests: t("dashboard.test.tsx"),
  },
  {
    name: "the applicant tile ignores the link the server sent",
    file: "spa/src/pages/dashboard/Attention.tsx",
    from: "to={pendingApplications.to}",
    to: 'to="/applications?status=pending"',
    tests: t("dashboard.test.tsx"),
  },
  {
    name: "a dashboard link is followed without checking it is a path of this app",
    file: "spa/src/lib/dashboard.ts",
    from: 'return typeof value === "string" ? safeFrom(value) : null;',
    to: 'return typeof value === "string" ? value : null;',
    tests: t("dashboard-data.test.ts", "dashboard.test.tsx"),
  },
  {
    name: "a malformed dashboard item is skipped instead of failing the answer",
    file: "spa/src/lib/dashboard.ts",
    from: "if (pending === null || underReview === null || unread === null || batch === null) return null;",
    to: "",
    tests: t("dashboard-data.test.ts", "dashboard.test.tsx"),
  },
  {
    name: "the loading placeholders count a tile too many for Pendaftaran",
    file: "spa/src/lib/dashboard.ts",
    from: '(accessTo(me, "pendaftaran") !== "none" ? 3 : 0)',
    to: '(accessTo(me, "pendaftaran") !== "none" ? 4 : 0)',
    tests: t("dashboard.test.tsx"),
  },
  {
    name: "the closed_empty phase is not known to the SPA (the whole dashboard turns into an error)",
    file: "spa/src/lib/dashboard.ts",
    from: '"ready_to_publish", "closed_empty", "published"];',
    to: '"ready_to_publish", "published"];',
    tests: t("dashboard-data.test.ts", "dashboard.test.tsx"),
  },
  {
    name: "a closed batch nobody applied to is drawn as one that needs a person",
    file: "spa/src/pages/dashboard/Attention.tsx",
    from: 'return { text: "Ditutup, tanpa pendaftar", attention: false };',
    to: 'return { text: "Ditutup, tanpa pendaftar", attention: true };',
    tests: t("dashboard.test.tsx"),
  },
  {
    name: "a dashboard the server does not have is shown as an error with a retry",
    file: "spa/src/lib/use-dashboard.ts",
    from: "} else if (result.status === 404 || result.status === 501) {",
    to: "} else if (false) {",
    tests: t("dashboard.test.tsx"),
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
  // The security check (Turnstile): docs/cloudflare/auth.md#turnstile
  {
    name: "api() drops the Turnstile header",
    file: "spa/src/lib/api.ts",
    from: "if (init.turnstileToken) headers[TURNSTILE_HEADER] = init.turnstileToken;",
    to: "",
    tests: t("api.test.ts", "turnstile.test.tsx"),
  },
  {
    name: "sign-in sends no Turnstile token",
    file: "spa/src/pages/auth/Login.tsx",
    from: "turnstileToken: turnstile.take(),",
    to: "",
    tests: t("turnstile.test.tsx"),
  },
  {
    name: "forgot-password sends no Turnstile token",
    file: "spa/src/pages/auth/ForgotPassword.tsx",
    from: "turnstileToken: turnstile.take(),",
    to: "",
    tests: t("turnstile.test.tsx"),
  },
  {
    name: "the widget is not reset after a request (a spent token would be sent again)",
    file: "spa/src/lib/turnstile.ts",
    from: "    const spent = tokenRef.current;\n    reset();\n    return spent;",
    to: "    return tokenRef.current;",
    tests: t("turnstile.test.tsx"),
  },
  {
    name: "sign-in button does not wait for the token",
    file: "spa/src/pages/auth/Login.tsx",
    from: "disabled={pending || turnstile.blocked}",
    to: "disabled={pending}",
    tests: t("turnstile.test.tsx"),
  },
  {
    name: "forgot-password button does not wait for the token",
    file: "spa/src/pages/auth/ForgotPassword.tsx",
    from: "disabled={pending || turnstile.blocked}",
    to: "disabled={pending}",
    tests: t("turnstile.test.tsx"),
  },
  {
    name: "sign-in goes out without a token when the submit does not come from the button",
    file: "spa/src/pages/auth/Login.tsx",
    from: "if (turnstile.blocked) return;",
    to: "",
    tests: t("turnstile.test.tsx"),
  },
  {
    name: "an expired token is kept and sent",
    file: "spa/src/lib/turnstile.ts",
    from: "      onLost() {\n        setToken(null);\n",
    to: "      onLost() {\n",
    tests: t("turnstile.test.tsx"),
  },
  {
    name: "an expired token does not ask for a fresh challenge",
    file: "spa/src/lib/turnstile.ts",
    from: "      onLost() {\n        setToken(null);\n        const current = handle.current;\n        if (current) current.api.reset(current.id);\n      },",
    to: "      onLost() {\n        setToken(null);\n      },",
    tests: t("turnstile.test.tsx"),
  },
  {
    name: "a widget that cannot run is not announced",
    file: "spa/src/components/TurnstileWidget.tsx",
    from: "{failed && <Alert>{WIDGET_ERROR_MESSAGE}</Alert>}",
    to: "{null}",
    tests: t("turnstile.test.tsx"),
  },
  {
    name: "the form waits for a widget the deployment does not have",
    file: "spa/src/lib/turnstile.ts",
    from: "const blocked = siteKey !== null && token === null;",
    to: "const blocked = token === null;",
    tests: t("turnstile.test.tsx", "login.test.tsx", "password-reset.test.tsx"),
  },
  {
    name: "the mock may load Cloudflare's script",
    file: "spa/src/lib/turnstile.ts",
    from: '  if (import.meta.env.VITE_ADMIN_MOCK === "true") return Promise.reject(new Error("the mock does not load Cloudflare\'s script"));\n',
    to: "",
    tests: t("turnstile.test.tsx"),
  },
  {
    name: "Cloudflare's script is added on every call",
    file: "spa/src/lib/turnstile.ts",
    from: "let script = document.querySelector<HTMLScriptElement>(`script[${SCRIPT_MARK}]`);",
    to: "let script: HTMLScriptElement | null = null;",
    tests: t("turnstile.test.tsx"),
  },
  {
    name: "captcha_failed has no Indonesian line",
    file: "spa/src/lib/auth-errors.ts",
    from: 'if (code === "captcha_failed") return CAPTCHA_FAILED_MESSAGE;',
    to: "",
    tests: t("auth-errors.test.ts", "turnstile.test.tsx"),
  },
  {
    name: "captcha_unavailable has no Indonesian line",
    file: "spa/src/lib/auth-errors.ts",
    from: 'if (code === "captcha_unavailable") return CAPTCHA_UNAVAILABLE_MESSAGE;',
    to: "",
    tests: t("auth-errors.test.ts", "turnstile.test.tsx"),
  },
  {
    name: "email_unavailable has no Indonesian line",
    file: "spa/src/lib/auth-errors.ts",
    from: 'if (failure.code === "email_unavailable") return EMAIL_UNAVAILABLE_MESSAGE;',
    to: "",
    tests: t("auth-errors.test.ts", "turnstile.test.tsx"),
  },
  {
    name: "the site key is read from anything the server sends",
    file: "spa/src/lib/captcha.ts",
    from: 'const key = typeof body.turnstileSiteKey === "string" ? body.turnstileSiteKey.trim() : "";',
    to: 'const key = String(body.turnstileSiteKey ?? "");',
    tests: t("captcha.test.ts", "turnstile.test.tsx"),
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
