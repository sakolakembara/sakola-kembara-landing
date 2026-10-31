// The SPA's negative checks of the editor frame (SAKEM-116: the shell's top bar as the editor's one bar, the tabs, the blog
// form's three tabs, Card and Switch), in their own file like negative-checks-spa-listtools.mjs: negative-checks-spa.mjs
// imports and spreads `editorSpaChecks`. Same rules: each check breaks ONE safeguard (the patch must stay valid code), runs
// the tests that must notice, expects them to FAIL, and the runner restores the file.
//
//   node scripts/negative-checks-spa.mjs --only "editor: "

const t = (...names) => names.map((name) => `spa/test/${name}`).join(" ");

const FRAME = "editor-frame.test.tsx";
const BLOG = "blog.test.tsx";

const BREADCRUMB = "spa/src/components/Breadcrumb.tsx";
const SHELL = "spa/src/components/Shell.tsx";
const PAGE_BAR = "spa/src/components/crud/PageBar.tsx";
const PAGE_TABS = "spa/src/components/crud/PageTabs.tsx";
const BLOG_FORM = "spa/src/pages/blog/BlogFormPage.tsx";
const SWITCH = "spa/src/components/ui/switch.tsx";

export const editorSpaChecks = [
  // ---------------------------------------------- the one bar
  {
    name: "editor: the breadcrumb forgets the title of the page it is on",
    file: BREADCRUMB,
    from: "const crumbs = leaf ? [...found, { label: leaf }] : found;",
    to: "const crumbs = found;",
    tests: t(FRAME, BLOG),
  },
  {
    name: "editor: the link to the site stays and crowds the page's buttons",
    file: SHELL,
    from: "{!chrome?.hasActions && (",
    to: "{true && (",
    tests: t(FRAME),
  },
  {
    name: "editor: a desktop draws the page's buttons in the page, a second bar under the shell's",
    file: PAGE_BAR,
    from: "const slots = desktop && chrome?.actions ? { leading: chrome.leading, actions: chrome.actions } : null;",
    to: "const slots = desktop && chrome?.actions && false ? { leading: chrome.leading, actions: chrome.actions } : null;",
    tests: t(FRAME),
  },
  {
    name: "editor: a phone puts the page's buttons in the desktop's bar, which it does not show",
    file: PAGE_BAR,
    from: "const slots = desktop && chrome?.actions ? {",
    to: "const slots = chrome?.actions ? {",
    tests: t(FRAME),
  },
  {
    name: "editor: leaving the page leaves its crumb and its buttons' room behind",
    file: PAGE_BAR,
    from: "      setLeaf?.(null);\n      setHasActions?.(false);",
    to: "      void 0;",
    tests: t(FRAME),
  },
  {
    name: "editor: the save button is not tied to the form, so it saves nothing and the browser's checks are skipped",
    file: BLOG_FORM,
    from: '<Button variant="neutral" type="submit" form={formId} disabled={save.pending}>',
    to: '<Button variant="neutral" type="button" disabled={save.pending}>',
    tests: t(FRAME, BLOG),
  },
  {
    name: "editor: a published article is offered 'Terbitkan' beside 'Simpan' as a draft is",
    file: BLOG_FORM,
    from: "{canWrite && item && !published && (",
    to: "{canWrite && item && (",
    tests: t(BLOG),
  },
  {
    name: "editor: a role that cannot write is given tabs it has nothing to do with",
    file: BLOG_FORM,
    from: "const tabbed = canWrite;",
    to: "const tabbed = true;",
    tests: t(BLOG),
  },
  {
    name: "editor: a refused save does not open the tab that holds the first error",
    file: BLOG_FORM,
    from: '    setTab(wanted);\n    if (first === "contentMarkdown") setBodyMode("edit");\n  }, [save.failures]);',
    to: '    if (first === "contentMarkdown") setBodyMode("edit");\n  }, [save.failures]);',
    tests: t(BLOG),
  },
  {
    name: "editor: a link of the error summary does not show the tab its field is on",
    file: BLOG_FORM,
    from: "      flushSync(() => {\n        setTab(wanted);",
    to: "      flushSync(() => {\n        void wanted;",
    tests: t(BLOG),
  },

  // ---------------------------------------------- the tabs
  {
    name: "editor: the arrow keys change the tab but the focus stays behind",
    file: PAGE_TABS,
    from: "    document.getElementById(`tab-${tabs[next].id}`)?.focus();",
    to: "    void 0;",
    tests: t(FRAME),
  },
  {
    name: "editor: every tab is in the tab order, so Tab walks through all of them",
    file: PAGE_TABS,
    from: "tabIndex={selected ? 0 : -1}",
    to: "tabIndex={0}",
    tests: t(FRAME),
  },
  {
    name: "editor: Home goes nowhere",
    file: PAGE_TABS,
    from: 'else if (event.key === "Home") next = 0;',
    to: 'else if (event.key === "Home") next = index;',
    tests: t(FRAME),
  },
  {
    name: "editor: the arrows stop at the ends instead of wrapping",
    file: PAGE_TABS,
    from: 'if (event.key === "ArrowRight") next = (index + 1) % tabs.length;',
    to: 'if (event.key === "ArrowRight") next = Math.min(index + 1, tabs.length - 1);',
    tests: t(FRAME),
  },
  {
    name: "editor: a tab does not name the panel it controls",
    file: PAGE_TABS,
    from: "aria-controls={`panel-${tab.id}`}",
    to: "aria-controls={`tab-${tab.id}`}",
    tests: t(FRAME),
  },

  // ---------------------------------------------- the kit's Switch
  {
    name: "editor: a switch's description is not read with the control",
    file: SWITCH,
    from: "aria-describedby={errorId ?? descriptionId}",
    to: "aria-describedby={undefined}",
    tests: t(FRAME),
  },
  {
    name: "editor: a refused switch is not marked invalid",
    file: SWITCH,
    from: "aria-invalid={error ? true : undefined}",
    to: "aria-invalid={undefined}",
    tests: t(FRAME),
  },
];
