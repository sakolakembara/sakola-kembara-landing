// The student portal SPA's negative checks (SAKEM-083, task P2), in their own file so the shared list in
// negative-checks-spa.mjs stays short: it imports and spreads `portalSpaChecks`. Same rules as there: each check breaks
// ONE safeguard in the source, runs the tests that must notice, expects them to FAIL, and the runner restores the file.
//
//   node scripts/negative-checks-spa.mjs --only portal
//
// The portal's tests live in portal-spa/test and run with portal-spa/vitest.config.ts (its `~/` is portal-spa/src), so
// every check here names that config; the runner reads `check.config` and defaults to the admin's.
//
// The shared module the admin also uses (shared/spa) is broken in the admin's own list as well: the checks here that
// patch it name the PORTAL's tests, which is what proves the portal does not depend on the admin's tests to notice.

const CONFIG = "portal-spa/vitest.config.ts";
const t = (...names) => names.map((name) => `portal-spa/test/${name}`).join(" ");

const GUARD = "guard.test.ts";
const ROUTES = "routes.test.tsx";
const LOGIN = "login.test.tsx";
const REGISTER = "register.test.tsx";
const RESET = "password-reset.test.tsx";
const TURNSTILE = "turnstile.test.tsx";
const DRAFTS = "local-drafts.test.ts";
const STATUS_LIB = "status.test.ts";
const STATUS_PAGE = "status.test.tsx";
const OVERVIEW = "overview.test.ts";
const NAV = "nav.test.tsx";
const LAYOUT = "layout.test.tsx";
const PATHS = "paths.test.ts";
const HOME = "home.test.tsx";

export const portalSpaChecks = [
  // ---------------------------------------------- who is let in: students only
  {
    name: "portal: an admin account is let into the portal",
    config: CONFIG,
    file: "portal-spa/src/lib/guard.ts",
    from: "return isStudent(state.me) ? { kind: \"allow\", me: state.me } : { kind: \"not-student\", me: state.me };",
    to: 'return { kind: "allow", me: state.me };',
    tests: t(GUARD, ROUTES),
  },
  {
    name: "portal: a role the portal does not know counts as a student",
    config: CONFIG,
    file: "portal-spa/src/lib/me.ts",
    from: 'return me.role === "student";',
    to: 'return !["viewer", "editor", "super_admin"].includes(me.role);',
    tests: t(GUARD, ROUTES),
  },
  {
    name: "portal: the 'not a student' screen is not shown (the page behind it is)",
    config: CONFIG,
    file: "portal-spa/src/components/RequireStudent.tsx",
    from: "return <NotStudentPage me={decision.me} />;",
    to: "return <Outlet />;",
    tests: t(ROUTES),
  },
  {
    name: "portal: the 'not a student' screen links to an admin address nobody configured",
    config: CONFIG,
    file: "portal-spa/src/pages/NotStudent.tsx",
    from: "{adminUrl && (",
    to: "{true && (",
    tests: t(ROUTES),
  },
  {
    name: "portal: not signed in is sent to the sign-in page without the page asked for",
    config: CONFIG,
    file: "portal-spa/src/lib/guard.ts",
    from: 'to: state.byUser ? "/login" : loginPath(',
    to: 'to: true ? "/login" : loginPath(',
    tests: t(GUARD, ROUTES),
  },
  {
    name: "portal: the sign-up form is accepted as a sign-in destination",
    config: CONFIG,
    file: "portal-spa/src/lib/guard.ts",
    from: 'export const PORTAL_AUTH_PATHS = [...AUTH_PATHS, "/register"];',
    to: "export const PORTAL_AUTH_PATHS = [...AUTH_PATHS];",
    tests: t(GUARD, LOGIN),
  },
  {
    name: "portal: a session that cannot be read (offline, 5xx) is shown as signed out",
    config: CONFIG,
    file: "portal-spa/src/lib/session.tsx",
    from: "} else if (result.status === 401) {\n        setState({ status: \"signed-out\", byUser: false });",
    to: "} else if (true) {\n        setState({ status: \"signed-out\", byUser: false });",
    tests: t(ROUTES),
  },
  {
    name: "portal: a 401 on a data call is shown as an error instead of sending the student to sign in",
    config: CONFIG,
    file: "portal-spa/src/lib/use-api-data.ts",
    from: "} else if (result.status === 401) {\n        expire();",
    to: "} else if (false) {\n        expire();",
    tests: t(ROUTES),
  },
  {
    name: "portal: a page body nobody understands is drawn instead of being an error",
    config: CONFIG,
    file: "portal-spa/src/lib/use-api-data.ts",
    from: 'setState(data === null ? { status: "error", failure: null } : { status: "ready", data });',
    to: 'setState({ status: "ready", data: data as T });',
    tests: t(HOME, STATUS_PAGE),
  },

  // ---------------------------------------------- what the browser keeps of a half-typed application
  {
    name: "portal: sign-out leaves the student's local drafts in the browser",
    config: CONFIG,
    file: "portal-spa/src/lib/session.tsx",
    from: 'wipeLocalDrafts(lastUserId.current);\n        setState({ status: "signed-out", byUser: true });',
    to: 'setState({ status: "signed-out", byUser: true });',
    tests: t(ROUTES),
  },
  {
    name: "portal: a 401 (the session ended elsewhere) leaves the local drafts in the browser",
    config: CONFIG,
    file: "portal-spa/src/lib/session.tsx",
    from: "const expire = useCallback(() => {\n    wipeLocalDrafts(lastUserId.current);\n",
    to: "const expire = useCallback(() => {\n",
    tests: t(ROUTES),
  },
  {
    name: "portal: local drafts older than 30 days are never purged when the portal opens",
    config: CONFIG,
    file: "portal-spa/src/lib/session.tsx",
    from: "    purgeStaleLocalDrafts();\n",
    to: "",
    tests: t(ROUTES),
  },
  {
    name: "portal: the purge keeps a copy older than 30 days",
    config: CONFIG,
    file: "portal-spa/src/lib/local-drafts.ts",
    from: "(savedAt === null || now - savedAt > LOCAL_DRAFT_MAX_AGE_MS)",
    to: "(savedAt === null)",
    tests: t(DRAFTS),
  },
  {
    name: "portal: the purge keeps a copy that cannot say when it was written",
    config: CONFIG,
    file: "portal-spa/src/lib/local-drafts.ts",
    from: "(savedAt === null || now - savedAt > LOCAL_DRAFT_MAX_AGE_MS)",
    to: "(savedAt !== null && now - savedAt > LOCAL_DRAFT_MAX_AGE_MS)",
    tests: t(DRAFTS),
  },
  {
    name: "portal: signing out wipes every student's local drafts, not only this one's",
    config: CONFIG,
    file: "portal-spa/src/lib/local-drafts.ts",
    from: "const own = userId ? `${LOCAL_DRAFT_PREFIX}${userId}:` : LOCAL_DRAFT_PREFIX;",
    to: "const own = LOCAL_DRAFT_PREFIX;",
    tests: t(DRAFTS, ROUTES),
  },
  {
    name: "portal: wiping one student's drafts also takes those of an id that starts the same",
    config: CONFIG,
    file: "portal-spa/src/lib/local-drafts.ts",
    from: "const own = userId ? `${LOCAL_DRAFT_PREFIX}${userId}:` : LOCAL_DRAFT_PREFIX;",
    to: "const own = userId ? `${LOCAL_DRAFT_PREFIX}${userId}` : LOCAL_DRAFT_PREFIX;",
    tests: t(DRAFTS),
  },
  {
    name: "portal: the wipe and the purge reach keys that are not the portal's",
    config: CONFIG,
    file: "portal-spa/src/lib/local-drafts.ts",
    from: "if (key !== null && key.startsWith(LOCAL_DRAFT_PREFIX)) keys.push(key);",
    to: "if (key !== null) keys.push(key);",
    tests: t(DRAFTS),
  },

  // ---------------------------------------------- the privacy promise of the status page
  {
    name: "portal: a verdict the API sent next to 'processing' is read and shown",
    config: CONFIG,
    file: "portal-spa/src/lib/status.ts",
    from: 'if (result.state === "decided" && announcedAt',
    to: 'if (result.state !== "awaiting_decision" && announcedAt',
    tests: t(STATUS_LIB, STATUS_PAGE),
  },
  {
    name: "portal: a decision the API does not have (waitlist, a misspelling) is read as one",
    config: CONFIG,
    file: "portal-spa/src/lib/status.ts",
    from: '(result.decision === "accepted" || result.decision === "rejected")',
    to: '(typeof result.decision === "string")',
    tests: t(STATUS_LIB, STATUS_PAGE),
  },
  {
    name: "portal: a verdict without the announcement time is shown",
    config: CONFIG,
    file: "portal-spa/src/lib/status.ts",
    from: 'if (result.state === "decided" && announcedAt && ',
    to: 'if (result.state === "decided" && ',
    tests: t(STATUS_LIB),
  },
  {
    name: "portal: a status, a review note or a review time the API sends by mistake is kept",
    config: CONFIG,
    file: "portal-spa/src/lib/status.ts",
    from: "items.push({ id: item.id, batch:",
    to: "items.push({ ...item, id: item.id, batch:",
    tests: t(STATUS_LIB, STATUS_PAGE),
  },
  {
    name: "portal: the home page's history carries what the API sent besides the fact that the results are out",
    config: CONFIG,
    file: "portal-spa/src/lib/overview.ts",
    from: "items.push({ id: item.id, batch:",
    to: "items.push({ ...item, id: item.id, batch:",
    tests: t(OVERVIEW, HOME),
  },
  {
    name: "portal: the committee's note is drawn as markup",
    config: CONFIG,
    file: "portal-spa/src/pages/Status.tsx",
    from: "<p className={`whitespace-pre-wrap leading-relaxed ${TONE_BODY[view.tone]}`}>{view.body}</p>",
    to: "<p className={`whitespace-pre-wrap leading-relaxed ${TONE_BODY[view.tone]}`} dangerouslySetInnerHTML={{ __html: view.body }} />",
    tests: t(STATUS_PAGE),
  },
  {
    name: "portal: the days left count from the phone's clock",
    config: CONFIG,
    file: "portal-spa/src/lib/overview.ts",
    from: "(Date.parse(closesAt) - Date.parse(now))",
    to: "(Date.parse(closesAt) - Date.now())",
    tests: t(OVERVIEW),
  },

  // ---------------------------------------------- the auth forms: what is sent, and where the links land
  {
    name: "portal: sign-in sends no verification callback under /portal",
    config: CONFIG,
    file: "portal-spa/src/pages/auth/Login.tsx",
    from: "json: { ...checked.values, callbackURL: VERIFY_CALLBACK },",
    to: "json: { ...checked.values },",
    tests: t(LOGIN),
  },
  {
    name: "portal: registration sends no callback, so the link of the email lands wherever the Worker likes",
    config: CONFIG,
    file: "portal-spa/src/pages/auth/Register.tsx",
    from: "json: { ...checked.values, callbackURL: REGISTER_CALLBACK },",
    to: "json: { ...checked.values },",
    tests: t(REGISTER),
  },
  {
    name: "portal: the link of the registration email loses the /portal prefix (it would land on the public site)",
    config: CONFIG,
    file: "portal-spa/src/lib/paths.ts",
    from: 'export const REGISTER_CALLBACK = serverPath("/login?verified=1");',
    to: 'export const REGISTER_CALLBACK = "/login?verified=1";',
    tests: t(PATHS, REGISTER),
  },
  {
    name: "portal: the link of the reset email loses the /portal prefix",
    config: CONFIG,
    file: "portal-spa/src/lib/paths.ts",
    from: 'export const RESET_PAGE = serverPath("/reset-password");',
    to: 'export const RESET_PAGE = "/reset-password";',
    tests: t(PATHS, RESET),
  },
  {
    name: "portal: Google comes back to a path without the /portal prefix",
    config: CONFIG,
    file: "portal-spa/src/lib/paths.ts",
    from: 'return from ? serverPath(from) : serverPath("/");',
    to: 'return from ?? "/";',
    tests: t(PATHS, LOGIN),
  },
  {
    name: "portal: the API calls lose the /portal prefix (they would reach the public site's Worker)",
    config: CONFIG,
    file: "portal-spa/src/lib/paths.ts",
    from: "export const API = `${BASE}/api`;",
    to: 'export const API = "/api";',
    tests: t(PATHS),
  },
  {
    name: "portal: an address that is not verified is shown a form that would fail again",
    config: CONFIG,
    file: "portal-spa/src/pages/auth/Login.tsx",
    from: 'if (result.code === "EMAIL_NOT_VERIFIED") {',
    to: "if (false) {",
    tests: t(LOGIN),
  },
  {
    name: "portal: a verification link that failed (?verified=1&error=...) says it worked",
    config: CONFIG,
    file: "portal-spa/src/pages/auth/Login.tsx",
    from: 'verifyOutcome({ status: errorParam ? null : "success", error: errorParam })',
    to: 'verifyOutcome({ status: "success", error: null })',
    tests: t(LOGIN),
  },
  {
    name: "portal: Google is offered although the server says it is off",
    config: CONFIG,
    file: "portal-spa/src/pages/auth/Login.tsx",
    from: "{googleEnabled && (",
    to: "{true && (",
    tests: t(LOGIN),
  },
  {
    name: "portal: a bot that filled the registration honeypot gets a real registration",
    config: CONFIG,
    file: "portal-spa/src/pages/auth/Register.tsx",
    from: 'if (String(data.get("website") ?? "") !== "") {',
    to: "if (false) {",
    tests: t(REGISTER),
  },

  // ---------------------------------------------- the security check on the portal's forms
  {
    name: "portal: registration sends no Turnstile token",
    config: CONFIG,
    file: "portal-spa/src/pages/auth/Register.tsx",
    from: "turnstileToken: turnstile.take(),",
    to: "",
    tests: t(REGISTER, TURNSTILE),
  },
  {
    name: "portal: sign-in sends no Turnstile token",
    config: CONFIG,
    file: "portal-spa/src/pages/auth/Login.tsx",
    from: "turnstileToken: turnstile.take(),",
    to: "",
    tests: t(TURNSTILE),
  },
  {
    name: "portal: forgot-password sends no Turnstile token",
    config: CONFIG,
    file: "portal-spa/src/pages/auth/ForgotPassword.tsx",
    from: "turnstileToken: turnstile.take(),",
    to: "",
    tests: t(RESET, TURNSTILE),
  },
  {
    name: "portal: 'Kirim ulang tautan' sends no Turnstile token",
    config: CONFIG,
    file: "portal-spa/src/components/ResendVerification.tsx",
    from: "turnstileToken: turnstile.take(),",
    to: "",
    tests: t(REGISTER, LOGIN, HOME),
  },
  {
    name: "portal: registration waits for no token (its button is not disabled)",
    config: CONFIG,
    file: "portal-spa/src/pages/auth/Register.tsx",
    from: "disabled={pending || turnstile.blocked}",
    to: "disabled={pending}",
    tests: t(TURNSTILE, REGISTER),
  },
  {
    name: "portal: registration goes out without a token when the submit does not come from the button",
    config: CONFIG,
    file: "portal-spa/src/pages/auth/Register.tsx",
    from: "if (turnstile.blocked) return;",
    to: "",
    tests: t(TURNSTILE),
  },
  {
    name: "portal: sign-in goes out without a token when the submit does not come from the button",
    config: CONFIG,
    file: "portal-spa/src/pages/auth/Login.tsx",
    from: "if (turnstile.blocked) return;",
    to: "",
    tests: t(TURNSTILE),
  },
  {
    name: "portal: forgot-password goes out without a token when the submit does not come from the button",
    config: CONFIG,
    file: "portal-spa/src/pages/auth/ForgotPassword.tsx",
    from: "if (turnstile.blocked) return;",
    to: "",
    tests: t(TURNSTILE),
  },
  {
    name: "portal: 'Kirim ulang tautan' goes out without a token when it is not the button that asks",
    config: CONFIG,
    file: "portal-spa/src/components/ResendVerification.tsx",
    from: "if (turnstile.blocked) return;",
    to: "",
    tests: t(TURNSTILE),
  },
  {
    name: "portal: the registration widget is made for another action than `register` (Siteverify would refuse the token)",
    config: CONFIG,
    file: "portal-spa/src/pages/auth/Register.tsx",
    from: 'useTurnstile("register", turnstileSiteKey)',
    to: 'useTurnstile("login", turnstileSiteKey)',
    tests: t(TURNSTILE),
  },
  {
    name: "portal: the portal's mock may load Cloudflare's script",
    config: CONFIG,
    file: "shared/spa/turnstile.ts",
    from: ' || import.meta.env.VITE_PORTAL_MOCK === "true"',
    to: "",
    tests: t(TURNSTILE),
  },
  {
    name: "portal: a double submit (a held Enter) sends the registration twice",
    config: CONFIG,
    file: "shared/spa/hooks.ts",
    from: "if (locked.current) return;",
    to: "",
    tests: t(REGISTER, LOGIN, NAV),
  },

  // ---------------------------------------------- the login layout
  {
    name: "portal: the auth pages are no longer on a plain white page (the shared layout is tinted)",
    config: CONFIG,
    file: "shared/spa/AuthShell.tsx",
    from: '<main className="flex min-h-screen items-center justify-center bg-white">',
    to: '<main className="flex min-h-screen items-center justify-center bg-gray-50">',
    tests: t(LAYOUT),
  },
  {
    name: "portal: the shared layout is no longer a narrow column",
    config: CONFIG,
    file: "shared/spa/AuthShell.tsx",
    from: '<div className="sm:mx-auto sm:w-full sm:max-w-sm">',
    to: '<div className="sm:mx-auto sm:w-full">',
    tests: t(LAYOUT),
  },
  {
    name: "portal: the verification page grows a second heading",
    config: CONFIG,
    file: "portal-spa/src/pages/auth/VerifyEmail.tsx",
    from: '<Alert tone={outcome.ok ? "success" : "danger"}>{outcome.body}</Alert>',
    to: '<h2>Terverifikasi</h2><Alert tone={outcome.ok ? "success" : "danger"}>{outcome.body}</Alert>',
    tests: t(LAYOUT),
  },
  {
    name: "portal: the registration page is back in a card",
    config: CONFIG,
    file: "portal-spa/src/pages/auth/Register.tsx",
    from: '<form ref={form} onSubmit={submit} noValidate aria-busy={pending} className="space-y-4">',
    to: '<form ref={form} onSubmit={submit} noValidate aria-busy={pending} className="space-y-4 rounded-2xl shadow-lg">',
    tests: t(LAYOUT),
  },
  {
    name: "portal: the Google button comes before the registration form",
    config: CONFIG,
    file: "portal-spa/src/pages/auth/Register.tsx",
    from: "      {message && <Alert>{message}</Alert>}\n\n      <form ref={form}",
    to: "      {googleEnabled && (\n        <GoogleButton disabled={pending} onClick={google}>\n          Daftar dengan Google\n        </GoogleButton>\n      )}\n      {message && <Alert>{message}</Alert>}\n\n      <form ref={form}",
    tests: t(LAYOUT, REGISTER),
  },

  // ---------------------------------------------- the nav and the shell
  {
    name: "portal: Beranda is marked as the current page on every page",
    config: CONFIG,
    file: "portal-spa/src/components/PortalNav.tsx",
    from: "end={item.end}",
    to: "end={false}",
    tests: t(NAV),
  },
  {
    name: "portal: 'Keluar' has no name on a phone (the label is gone, only the icon is left)",
    config: CONFIG,
    file: "portal-spa/src/components/PortalNav.tsx",
    from: '<span className="sr-only sm:not-sr-only">Keluar</span>',
    to: "",
    tests: t(NAV, ROUTES),
  },
  {
    name: "portal: focus stays on the link after going to another page",
    config: CONFIG,
    file: "portal-spa/src/components/PortalShell.tsx",
    from: "    main.current?.focus();\n",
    to: "",
    tests: t(NAV),
  },
  {
    name: "portal: the first page steals focus when it opens",
    config: CONFIG,
    file: "portal-spa/src/components/PortalShell.tsx",
    from: "if (first.current) {",
    to: "if (false) {",
    tests: t(NAV),
  },
  {
    name: "portal: the skip link points nowhere",
    config: CONFIG,
    file: "portal-spa/src/components/PortalShell.tsx",
    from: 'href="#isi"',
    to: 'href="#"',
    tests: t(NAV),
  },
  {
    name: "portal: the brand goes to the router's /portal instead of the public site",
    config: CONFIG,
    file: "portal-spa/src/components/PortalNav.tsx",
    from: '<a href="/" className="col-start-1',
    to: '<a href="/portal" className="col-start-1',
    tests: t(NAV),
  },

  // ---------------------------------------------- the home page's gate
  {
    name: "portal: the 'Mulai daftar' button is shown when no batch is open",
    config: CONFIG,
    file: "portal-spa/src/pages/Home.tsx",
    from: "if (!openBatch) return <NoBatchCard />;",
    to: "if (false) return <NoBatchCard />;",
    tests: t(HOME),
  },
  {
    name: "portal: a student who already sent the application is offered the form again",
    config: CONFIG,
    file: "portal-spa/src/pages/Home.tsx",
    from: 'if (current.state === "submitted") return <SubmittedCard batch={openBatch} />;',
    to: "",
    tests: t(HOME),
  },
  {
    name: "portal: the history card names the outcome before the results are out",
    config: CONFIG,
    file: "portal-spa/src/pages/Home.tsx",
    from: 'const published = history.some((item) => item.published);',
    to: "const published = history.length > 0;",
    tests: t(HOME),
  },
];
