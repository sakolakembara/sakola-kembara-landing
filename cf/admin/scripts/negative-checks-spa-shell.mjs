// The SPA's negative checks of the admin shell (SAKEM-115, stage 2: sidebar, icon rail, user menu, top bar), in their
// own file like negative-checks-spa-crud.mjs: negative-checks-spa.mjs imports and spreads `shellSpaChecks`. Same rules:
// each check breaks ONE safeguard in the source (the patch must stay valid code), runs the tests that must notice,
// expects them to FAIL, and the runner restores the file.
//
//   node scripts/negative-checks-spa.mjs
//   node scripts/negative-checks-spa.mjs --only "shell: "

const t = (...names) => names.map((name) => `spa/test/${name}`).join(" ");

const SHELL = "shell.test.tsx";
const DRAWER = "drawer.test.tsx";
const SIDEBAR = "sidebar.test.tsx";

const PROVIDER = "spa/src/lib/dashboard-provider.tsx";
const STATE = "spa/src/lib/sidebar-state.ts";
// The behaviour of the user menu's panel (opening, Escape, a press outside, Tab out) is the shared disclosure's.
const DISCLOSURE = "spa/src/lib/use-disclosure.ts";
const SIDE = "spa/src/components/Sidebar.tsx";

export const shellSpaChecks = [
  // ---------------------------------------------- the counts in the sidebar
  {
    name: "shell: a count of zero still gets a badge",
    file: "spa/src/lib/dashboard.ts",
    from: 'if (pending && pending.count > 0) counts["/applications"]',
    to: 'if (pending) counts["/applications"]',
    tests: t(SHELL),
  },
  {
    name: "shell: the badge's words are left out (a screen reader hears a bare number)",
    file: SIDE,
    from: ", {count} {what}",
    to: '{""}',
    tests: t(SHELL),
  },
  {
    name: "shell: above 99 the badge shows the whole number and breaks the pill",
    file: SIDE,
    from: '{count > 99 ? "99+" : count}',
    to: "{count}",
    tests: t(SHELL),
  },
  {
    name: "shell: the old counts are dropped while a new answer is on its way (the badge blinks)",
    file: PROVIDER,
    from: 'if (state.status !== "ready") return;\n    setSeen(state.data);',
    to: 'setSeen(state.status === "ready" ? state.data : null);\n    if (state.status !== "ready") return;',
    tests: t(SHELL),
  },
  {
    name: "shell: a write does not refresh the counts (a message read stays counted)",
    file: PROVIDER,
    from: "useEffect(() => onWrite(reload), [reload]);",
    to: "useEffect(() => void onWrite, [reload]);",
    tests: t(SHELL),
  },
  {
    name: "shell: every page change asks the dashboard again (a request per click)",
    file: PROVIDER,
    from: 'if (pathname === "/") reload();',
    to: "reload();",
    tests: t(SHELL),
  },
  {
    name: "shell: coming back to the dashboard shows the old answer without asking again",
    file: PROVIDER,
    from: 'if (pathname === "/") reload();',
    to: 'if (pathname === "/nowhere") reload();',
    tests: t(SHELL),
  },

  // ---------------------------------------------- the icon rail
  {
    name: "shell: the collapsed choice is not kept in the browser",
    file: STATE,
    from: "useEffect(() => writeCollapsed(collapsed), [collapsed]);",
    to: "useEffect(() => void writeCollapsed, [collapsed]);",
    tests: t(SHELL),
  },
  {
    name: "shell: a browser that refuses storage breaks the shell",
    file: STATE,
    from: '    return window.localStorage.getItem(KEY) === "collapsed";\n  } catch {\n    return false;\n  }',
    to: '    return window.localStorage.getItem(KEY) === "collapsed";\n  } finally {\n    void 0;\n  }',
    tests: t(SHELL),
  },
  {
    name: "shell: Ctrl+B is taken from a text field (bold in an editor stops working)",
    file: STATE,
    from: "if (isTyping(event.target)) return;",
    to: "void isTyping;",
    tests: t(SHELL),
  },
  {
    name: "shell: Shift+Ctrl+B and Alt+Ctrl+B also toggle the sidebar",
    file: STATE,
    from: "event.altKey || event.shiftKey || event.key.toLowerCase()",
    to: "event.key.toLowerCase()",
    tests: t(SHELL),
  },
  {
    name: "shell: ⌘B does nothing on a Mac",
    file: STATE,
    from: "(event.ctrlKey || event.metaKey)",
    to: "event.ctrlKey",
    tests: t(SHELL),
  },
  {
    name: "shell: on the rail an entry has no text of its own (only a tooltip names it)",
    file: SIDE,
    from: '<span className={collapsed ? "sr-only" : "truncate"}>{item.label}</span>',
    to: '{collapsed ? null : <span className="truncate">{item.label}</span>}',
    tests: t(SHELL),
  },

  // ---------------------------------------------- the user menu
  {
    name: "shell: the user menu starts open",
    file: DISCLOSURE,
    from: "const [open, setOpen] = useState(false);",
    to: "const [open, setOpen] = useState(true);",
    tests: t(SHELL, DRAWER, SIDEBAR),
  },
  {
    name: "shell: a press outside the user menu leaves it open",
    file: DISCLOSURE,
    from: "if (!root.current?.contains(event.target as Node)) setOpen(false);",
    to: "void event;",
    tests: t(SHELL),
  },
  {
    name: "shell: Escape closes the user menu but focus is lost to the page",
    file: DISCLOSURE,
    from: "trigger.current?.focus();",
    to: "void trigger;",
    tests: t(SHELL),
  },
  {
    name: "shell: Tab out of the user menu leaves it open over the page",
    file: DISCLOSURE,
    from: "if (event.relatedTarget && !root.current?.contains(event.relatedTarget as Node)) setOpen(false);",
    to: "void event;",
    tests: t(SHELL),
  },

  // ---------------------------------------------- the frame
  {
    name: "shell: <main> is not a positioned box (a sr-only element deep in a page makes the window scroll)",
    file: "spa/src/components/Shell.tsx",
    from: 'className="relative min-h-0 flex-1 overflow-auto outline-none"',
    to: 'className="min-h-0 flex-1 overflow-auto outline-none"',
    tests: t(SHELL),
  },
  {
    name: "shell: the frame is not a positioned box (the same, for what sticks out of the sidebar side)",
    file: "spa/src/components/shell-parts.tsx",
    from: '"relative flex h-dvh flex-col overflow-hidden bg-background md:flex-row"',
    to: '"flex h-dvh flex-col overflow-hidden bg-background md:flex-row"',
    tests: t(SHELL),
  },

  // ---------------------------------------------- the top bar
  {
    name: "shell: the breadcrumb does not mark the page you are on",
    file: "spa/src/components/Breadcrumb.tsx",
    from: 'aria-current={index === crumbs.length - 1 ? "page" : undefined}',
    to: "aria-current={undefined}",
    tests: t(SHELL),
  },
  {
    name: "shell: Lihat situs replaces the admin tab instead of opening a new one",
    file: "spa/src/components/Shell.tsx",
    from: 'target="_blank"',
    to: 'target="_self"',
    tests: t(SHELL),
  },
  {
    name: "shell: Lihat situs lets the site reach back into the admin tab (no noopener)",
    file: "spa/src/components/Shell.tsx",
    from: 'rel="noopener noreferrer"',
    to: 'rel=""',
    tests: t(SHELL),
  },
];
