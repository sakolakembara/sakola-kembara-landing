// The SPA's negative checks of the load sequence (SAKEM-115: the frame from the first byte, the skeleton while the session is
// asked for, the dashboard asked with it), in their own file like negative-checks-spa-listtools.mjs:
// negative-checks-spa.mjs imports and spreads `bootSpaChecks`. Same rules: each check breaks ONE safeguard (the patch must
// stay valid code), runs the tests that must notice, expects them to FAIL, and the runner restores the file.
//
//   node scripts/negative-checks-spa.mjs --only "boot: "

const t = (...names) => names.map((name) => `spa/test/${name}`).join(" ");

const BOOT = "boot.test.tsx";
const INDEX = "spa/index.html";
const SKELETON = "spa/src/components/ShellSkeleton.tsx";
const DASHBOARD = "spa/src/lib/use-dashboard.ts";

export const bootSpaChecks = [
  // ---------------------------------------------- the frame in index.html
  {
    name: "boot: the frame before any script is not as wide as the sidebar that replaces it (a jump when the page starts)",
    file: INDEX,
    from: "#boot .boot-aside { flex: none; width: 248px;",
    to: "#boot .boot-aside { flex: none; width: 240px;",
    tests: t(BOOT),
  },
  {
    name: "boot: the frame is not as tall as the top bar that replaces it",
    file: INDEX,
    from: "height: 56px;",
    to: "height: 60px;",
    tests: t(BOOT),
  },
  {
    name: "boot: the sign-in pages keep a sidebar-shaped frame (a forgotten route among the open ones)",
    file: INDEX,
    from: "login|forgot-password|reset-password",
    to: "login|reset-password",
    tests: t(BOOT),
  },
  {
    name: "boot: a kept icon rail starts as the wide sidebar and jumps to 72 px when the page starts",
    file: INDEX,
    from: '=== "collapsed") boot.querySelector(".boot-aside").style.width = "72px";',
    to: '=== "collapsed") boot.querySelector(".boot-aside").style.width = "80px";',
    tests: t(BOOT),
  },
  {
    name: "boot: storage that throws stops the page's script (and with it the removal of the frame on the next line of defence)",
    file: INDEX,
    from: "} catch (e) {}",
    to: "} finally {}",
    tests: t(BOOT),
  },

  // ---------------------------------------------- the skeleton
  {
    name: "boot: the skeleton's sidebar is read out to screen readers as if it were the menu",
    file: SKELETON,
    from: '<aside aria-hidden="true"',
    to: "<aside",
    tests: t(BOOT),
  },
  {
    name: "boot: the skeleton has a main landmark of its own, announced again when the shell's replaces it",
    file: SKELETON,
    from: '<div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto">',
    to: '<div role="main" className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto">',
    tests: t(BOOT, "routes.test.tsx"),
  },
  {
    name: "boot: the skeleton forgets the icon rail a person kept",
    file: SKELETON,
    from: "const collapsed = readSidebarCollapsed();",
    to: "const collapsed = false;",
    tests: t(BOOT),
  },
  {
    name: "boot: the grey screen with a spinner is back while the session loads",
    file: "spa/src/components/RequireAuth.tsx",
    from: "return <ShellSkeleton />;",
    to: 'return <p role="status">Memuat…</p>;',
    tests: t(BOOT),
  },
  {
    name: "boot: the skeleton's frame and the shell's are no longer the same classes (the sidebar's width)",
    file: "spa/src/components/shell-parts.tsx",
    from: 'collapsed ? "md:w-[72px]" : "md:w-[248px]"',
    to: 'collapsed ? "md:w-[72px]" : "md:w-[256px]"',
    tests: t(BOOT),
  },
  {
    name: "boot: the rail's brand shows its name in 72 px (the skeleton and the sidebar disagree)",
    file: "spa/src/components/Sidebar.tsx",
    from: '<div className={cn("min-w-0 flex-1", collapsed && "sr-only")}>',
    to: '<div className={cn("min-w-0 flex-1")}>',
    tests: t(BOOT, "shell.test.tsx"),
  },

  // ---------------------------------------------- the dashboard with the session
  {
    name: "boot: the dashboard is asked for only when the shell has mounted, after the session (the waterfall is back)",
    file: "spa/src/components/RequireAuth.tsx",
    from: "    prefetchDashboard();\n  }, []);",
    to: "    void prefetchDashboard;\n  }, []);",
    tests: t(BOOT),
  },
  {
    name: "boot: a shell that mounts while the dashboard is on its way asks again instead of joining",
    file: DASHBOARD,
    from: "if (!inFlight || inFlight.version !== readCacheVersion()) {",
    to: "if (true) {",
    tests: t(BOOT),
  },
  {
    name: "boot: a request that left before a write is joined, and its outdated answer is shown",
    file: DASHBOARD,
    from: "if (!inFlight || inFlight.version !== readCacheVersion()) {",
    to: "if (!inFlight) {",
    tests: t(BOOT),
  },
  {
    name: "boot: a shell that mounts just after the answer came asks again (two dashboard requests per page load)",
    file: DASHBOARD,
    from: "Date.now() - prefetched.at < FRESH_MS ? prefetched.state : undefined",
    to: "false ? prefetched.state : undefined",
    tests: t(BOOT),
  },
  {
    name: "boot: only an answer with data is adopted, so a server without the dashboard is asked twice",
    file: DASHBOARD,
    from: "prefetched = { state: settle(result, version), at: Date.now(), version };",
    to: "if (result.ok) prefetched = { state: settle(result, version), at: Date.now(), version };",
    tests: t(BOOT),
  },
  {
    name: "boot: the prefetch's answer stays for every later shell (an answer shown from memory is stamped as news)",
    file: DASHBOARD,
    from: "if (adopted) prefetched = null;",
    to: "void adopted;",
    tests: t("dashboard.test.tsx"),
  },
];
