// The SPA's negative checks of the admin CRUD kit (SAKEM-082), in their own file so the shared list in
// negative-checks-spa.mjs stays short: it imports and spreads `crudSpaChecks`. Same rules as there: each check breaks
// ONE safeguard in the source, runs the tests that must notice, expects them to FAIL, and the runner restores the file.
//
//   node scripts/negative-checks-spa.mjs
//
// The Worker's side (area checks on writes, the stale check, validation, the audit transaction) is in
// negative-checks-crud.mjs.

const t = (...names) => names.map((name) => `spa/test/${name}`).join(" ");

const ANNOUNCEMENTS = "announcements.test.tsx";
const FORM_SHELL = "crud/form-shell.test.tsx";
const DIALOG = "crud/confirm-dialog.test.tsx";
const TABLE = "crud/table-pieces.test.tsx";
const UPLOAD = "crud/upload.test.tsx";
const HOOKS = "crud/hooks.test.tsx";
const LIST = "crud/use-list.test.tsx";
const KINDS = "crud/upload-kinds.test.ts";
const MOCK = "crud/mock-resources.test.ts";
const API = "api.test.ts";
const DASHBOARD = "dashboard.test.tsx";
const PROGRESS = "progress-bar.test.tsx";
const UIKIT = "ui-kit.test.tsx";

export const crudSpaChecks = [
  // ---------------------------------------------- write affordances follow the role
  {
    name: "crud: a read-only role is offered the create button, Edit and Hapus",
    file: "spa/src/components/crud/ListPage.tsx",
    from: 'const canWrite = access === "write";',
    to: "const canWrite = true;",
    tests: t(ANNOUNCEMENTS),
  },
  {
    name: "crud: the Hapus button is shown to a role that cannot write",
    file: "spa/src/components/crud/ListPage.tsx",
    from: "{canWrite && (",
    to: "{true && (",
    tests: t(ANNOUNCEMENTS),
  },
  {
    name: "crud: a read-only role gets a writable form",
    file: "spa/src/pages/announcements/AnnouncementFormPage.tsx",
    from: "readOnly={!canWrite}",
    to: "readOnly={false}",
    tests: t(ANNOUNCEMENTS),
  },
  {
    name: "crud: the fields of a read-only form are not disabled",
    file: "spa/src/components/crud/FormShell.tsx",
    from: "<fieldset disabled={readOnly}",
    to: "<fieldset disabled={false}",
    tests: t(FORM_SHELL, ANNOUNCEMENTS),
  },
  {
    name: "crud: a read-only form still submits",
    file: "spa/src/components/crud/FormShell.tsx",
    from: "if (readOnly) return;\n    onSubmit();",
    to: "onSubmit();",
    tests: t(FORM_SHELL),
  },
  {
    name: "crud: a read-only upload field keeps its buttons",
    file: "spa/src/components/crud/UploadField.tsx",
    from: "{!disabled && (",
    to: "{true && (",
    tests: t(UPLOAD),
  },

  // -------------------------------------------------------------- unsaved changes
  {
    name: "crud: the unsaved-changes guard is off",
    file: "spa/src/components/crud/FormShell.tsx",
    from: "const guarded = dirty && !readOnly;",
    to: "const guarded = false;",
    tests: t(FORM_SHELL, ANNOUNCEMENTS),
  },
  {
    name: "crud: the guard also stops the navigation that follows a successful save",
    file: "spa/src/components/crud/FormShell.tsx",
    from: "if (!block || mutation.succeededRef.current) return false;",
    to: "if (!block) return false;",
    tests: t(FORM_SHELL, ANNOUNCEMENTS),
  },
  {
    name: "crud: closing the tab with unsaved changes is not warned about",
    file: "spa/src/components/crud/FormShell.tsx",
    from: 'window.addEventListener("beforeunload", warn);',
    to: "",
    tests: t(FORM_SHELL),
  },
  {
    name: "crud: a form is never dirty (typing changes nothing)",
    file: "spa/src/lib/crud/useFormValues.ts",
    from: "baseline.current[key] !== values[key]",
    to: "false",
    tests: t(HOOKS, FORM_SHELL, ANNOUNCEMENTS),
  },

  // ---------------------------------------------------------------------- saving
  {
    name: "crud: a second submit while one is in flight goes through (no submit lock)",
    file: "spa/src/lib/crud/useMutation.ts",
    from: "if (locked.current) return null;",
    to: "",
    tests: t(HOOKS, FORM_SHELL, ANNOUNCEMENTS),
  },
  {
    name: "crud: the field errors of the Worker are not mapped onto the form",
    file: "spa/src/lib/crud/useMutation.ts",
    from: "setFields(described.fields);",
    to: "setFields({});",
    tests: t(HOOKS, FORM_SHELL, ANNOUNCEMENTS),
  },
  {
    name: "crud: a stale save is not flagged",
    file: "spa/src/lib/crud/useMutation.ts",
    from: "setStale(described.stale);",
    to: "setStale(false);",
    tests: t(HOOKS, FORM_SHELL, ANNOUNCEMENTS),
  },
  {
    name: "crud: the stale alert has no 'Muat ulang'",
    file: "spa/src/components/crud/FormShell.tsx",
    from: "{onReload && (",
    to: "{false && (",
    tests: t(FORM_SHELL, ANNOUNCEMENTS),
  },
  {
    name: "crud: the error summary never takes the focus",
    file: "spa/src/components/crud/FormShell.tsx",
    from: "if (save.failures > 0) summary.current?.focus();",
    to: "",
    tests: t(FORM_SHELL),
  },
  {
    name: "crud: a save never sends the version it loaded (no If-Match)",
    file: "shared/spa/api.ts",
    from: 'if (init.ifMatch) headers["If-Match"] = init.ifMatch;',
    to: "",
    tests: t("crud/api-extension.test.ts", ANNOUNCEMENTS),
  },
  {
    name: "crud: a delete never sends the version of the row (no If-Match)",
    file: "spa/src/lib/crud/useDeleteAction.tsx",
    from: "ifMatch: target.updatedAt ? ifMatch(target.updatedAt) : undefined,",
    to: "ifMatch: undefined,",
    tests: t(ANNOUNCEMENTS),
  },
  {
    name: "crud: a notice that came with a navigation stays in the history entry (a reload shows it again)",
    file: "spa/src/lib/crud/flash.ts",
    from: "navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, { replace: true, state: null });",
    to: "",
    tests: t(TABLE),
  },

  // ------------------------------------------------------------------- the dialog
  {
    name: "crud: Escape cancels a delete that is in flight",
    file: "spa/src/components/crud/ConfirmDialog.tsx",
    from: "if (!pending) onCancel();\n      }}\n      // A click",
    to: "onCancel();\n      }}\n      // A click",
    tests: t(DIALOG),
  },
  {
    name: "crud: Escape is left to the browser, which closes the dialog behind the parent's back",
    file: "spa/src/components/crud/ConfirmDialog.tsx",
    from: "event.preventDefault();\n        if (!pending) onCancel();",
    to: "if (!pending) onCancel();",
    tests: t(DIALOG),
  },
  {
    name: "crud: the focus starts on the destructive button",
    file: "spa/src/components/crud/ConfirmDialog.tsx",
    from: 'element.querySelector<HTMLElement>("[data-cancel]")?.focus();',
    to: "",
    tests: t(DIALOG, ANNOUNCEMENTS),
  },
  {
    name: "crud: the focus is not given back when the dialog closes",
    file: "spa/src/components/crud/ConfirmDialog.tsx",
    from: "if (target?.isConnected) target.focus();\n      else focusMain();",
    to: "",
    tests: t(DIALOG),
  },
  {
    name: "crud: a click on the backdrop does nothing",
    file: "spa/src/components/crud/ConfirmDialog.tsx",
    from: "if (event.target === event.currentTarget && !pending) onCancel();",
    to: "",
    tests: t(DIALOG),
  },

  // ---------------------------------------------------------------- tables, lists
  {
    name: "crud: the current page is not marked aria-current",
    file: "spa/src/components/crud/Pagination.tsx",
    from: 'aria-current="page" aria-label',
    to: 'data-current="page" aria-label',
    tests: t(TABLE),
  },
  {
    name: "crud: a failed list shows no error row",
    file: "spa/src/components/crud/DataTable.tsx",
    from: '{state === "error" && (',
    to: "{false && (",
    tests: t(TABLE, ANNOUNCEMENTS),
  },
  {
    name: "crud: a request is not aborted when the list's query changes or the page goes away",
    file: "spa/src/lib/crud/useList.ts",
    from: "return () => controller.abort();",
    to: "return () => undefined;",
    tests: t(LIST),
  },
  {
    name: "crud: a late answer of a replaced request is used",
    file: "spa/src/lib/crud/useList.ts",
    from: "if (controller.signal.aborted) return;",
    to: "",
    tests: t(LIST),
  },
  {
    name: "crud: a page past the end is left empty (the last row of the last page was deleted)",
    file: "spa/src/lib/crud/useList.ts",
    from: "loaded.data.total > 0 && query.page > 1",
    to: "false",
    tests: t(LIST),
  },

  // ------------------------------------------- the lists' memory and the filters that apply by themselves
  {
    name: "crud: a write no longer empties the lists' memory (a list shows the row that was just deleted)",
    file: "spa/src/lib/crud/readCache.ts",
    from: "onWrite(clearReadCache);",
    to: "",
    tests: t(LIST),
  },
  {
    name: "crud: an answer that was on its way when a write happened is kept anyway",
    file: "spa/src/lib/crud/readCache.ts",
    from: "if (since === version) answers.set(key, payload);",
    to: "answers.set(key, payload);",
    tests: t(LIST),
  },
  {
    name: "crud: api() tells nobody about a write",
    file: "shared/spa/api.ts",
    from: "for (const listener of writeListeners) listener();",
    to: "void writeListeners;",
    tests: t(API, LIST),
  },
  {
    name: "crud: going back to a query asked before shows the rows of the query just left until the Worker answers",
    file: "spa/src/lib/crud/useList.ts",
    from: 'kept ? { status: "ready", data: kept, failure: null } : { ...previous, status: previous.data ? "ready" : "loading", failure: null },',
    to: '({ ...previous, status: previous.data ? "ready" : "loading", failure: null }),',
    tests: t(LIST),
  },
  {
    name: "crud: a list opened before paints the loading row first, then its last answer",
    file: "spa/src/lib/crud/useList.ts",
    from: "return kept ? { status: \"ready\", data: kept, failure: null } : { status: \"loading\", data: null, failure: null };",
    to: "return { status: \"loading\", data: null, failure: null };",
    tests: t(LIST),
  },
  {
    name: "crud: choosing a filter does not apply it (it waits for a button that no longer exists)",
    file: "spa/src/components/crud/FilterBar.tsx",
    from: 'list.apply({ q: search ? searchText.take() : "", filters: next });',
    to: "",
    tests: t(TABLE, ANNOUNCEMENTS),
  },
  {
    name: "crud: the search is asked for at every key instead of after a pause",
    file: "spa/src/components/crud/FilterBar.tsx",
    from: "delay: SEARCH_DELAY_MS,",
    to: "delay: 0,",
    tests: t(TABLE),
  },
  {
    name: "crud: the address bar echoing the search overwrites what was typed since",
    file: "spa/src/lib/crud/useDraftText.ts",
    from: "if (committed === sent.current) return;",
    to: "",
    tests: t(TABLE),
  },

  // ------------------------------------------- loading feedback: the top bar, the grey rows, the dashboard
  {
    name: "loading: a finished call is never taken off the count (the top bar slides for ever)",
    file: "shared/spa/api.ts",
    from: "moveInFlight(-1);",
    to: "",
    tests: t(API, PROGRESS),
  },
  {
    name: "loading: the top bar shows at once instead of after a moment (an answer that comes at once flashes it)",
    file: "spa/src/components/ProgressBar.tsx",
    from: 'busy ? "opacity-100 delay-200" : "opacity-0"',
    to: 'busy ? "opacity-100" : "opacity-0"',
    tests: t(PROGRESS),
  },
  {
    name: "loading: the table has no grey rows while it loads",
    file: "spa/src/components/crud/DataTable.tsx",
    from: "const SKELETON_ROWS = 5;",
    to: "const SKELETON_ROWS = 0;",
    tests: t(TABLE),
  },
  {
    name: "loading: the table's loading words are not a status any more (screen readers hear nothing)",
    file: "spa/src/components/crud/DataTable.tsx",
    from: '<p role="status" className="sr-only">',
    to: '<p className="sr-only">',
    tests: t(TABLE),
  },
  {
    name: "loading: rows shown again dim at once, so a list confirmed in a moment flashes",
    file: "spa/src/components/crud/DataTable.tsx",
    from: '"opacity-60 transition-opacity delay-300"',
    to: '"opacity-60 transition-opacity"',
    tests: t(TABLE),
  },
  {
    name: "loading: a role with no tile to come gets no grey block (the dashboard looks stuck)",
    file: "spa/src/pages/dashboard/DashboardPage.tsx",
    from: "Math.max(tiles, 1)",
    to: "tiles",
    tests: t(DASHBOARD),
  },
  {
    name: "loading: the dashboard forgets its last answer (grey blocks at every visit)",
    file: "spa/src/lib/use-dashboard.ts",
    from: 'return data ? { status: "ready", data } : { status: "loading" };',
    to: 'return { status: "loading" };',
    tests: t(DASHBOARD),
  },

  // ------------------------------------------- the admin's UI kit (spa/src/components/ui, cf/admin/DESIGN.md)
  {
    name: "kit: an alert has no icon, so only its color says what it is",
    file: "spa/src/components/ui/alert.tsx",
    from: '<Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />',
    to: "",
    tests: t(UIKIT),
  },
  {
    name: "kit: an error banner is not announced at once",
    file: "spa/src/components/ui/alert.tsx",
    from: 'role={kind === "danger" ? "alert" : "status"}',
    to: 'role="status"',
    tests: t(UIKIT, ANNOUNCEMENTS),
  },
  {
    name: "kit: a small button is as short on a phone as on a desktop (a touch target under 44 px)",
    file: "spa/src/components/ui/button.tsx",
    from: 'sm: "min-h-10 px-3 text-sm md:min-h-[34px]",',
    to: 'sm: "min-h-[34px] px-3 text-sm",',
    tests: t(UIKIT),
  },
  {
    name: "kit: an outside link opens in the same tab and without noopener",
    file: "spa/src/components/ui/button.tsx",
    from: 'target="_blank" rel="noopener noreferrer" ',
    to: "",
    tests: t(UIKIT),
  },
  {
    name: "kit: text is 14 px on a phone (iOS zooms in on focus under 16 px)",
    file: "spa/src/components/ui/field.tsx",
    from: "bg-card text-base text-foreground leading-6",
    to: "bg-card text-foreground leading-6",
    tests: t(UIKIT),
  },
  {
    name: "kit: a select loses its own arrow",
    file: "spa/src/components/ui/field.tsx",
    from: "style={{ backgroundImage: CHEVRON, ...style }}",
    to: "style={style}",
    tests: t(UIKIT),
  },

  // ---------------------------------------------------------------------- uploads
  {
    name: "crud: the browser no longer checks the size of a file before sending it",
    file: "spa/src/lib/crud/upload-kinds.ts",
    from: "if (file.size > rule.maxBytes) return UPLOAD_MESSAGES.tooBig(rule.maxBytes);",
    to: "",
    tests: t(KINDS, UPLOAD),
  },
  {
    name: "crud: the browser no longer checks the type of a file before sending it",
    file: "spa/src/lib/crud/upload-kinds.ts",
    from: "return accepted ? null : UPLOAD_MESSAGES.type(rule.types);",
    to: "return null;",
    tests: t(KINDS, UPLOAD),
  },
  {
    name: "crud: an empty file is sent",
    file: "spa/src/lib/crud/upload-kinds.ts",
    from: "if (file.size === 0) return UPLOAD_MESSAGES.empty;",
    to: "",
    tests: t(KINDS, UPLOAD),
  },
  {
    name: "crud: the upload field sends a file whatever the checks say",
    file: "spa/src/components/crud/UploadField.tsx",
    from: "if (problem) {",
    to: "if (false) {",
    tests: t(UPLOAD),
  },
  {
    name: "crud: a file replaced in the same form is left in R2",
    file: "spa/src/components/crud/UploadField.tsx",
    from: "discardUpload(mine.id);",
    to: "",
    tests: t(UPLOAD),
  },
  {
    name: "crud: the upload progress is not a progressbar",
    file: "spa/src/components/crud/UploadField.tsx",
    from: 'role="progressbar"\n            aria-label=',
    to: 'role="presentation"\n            aria-label=',
    tests: t(UPLOAD),
  },
  {
    name: "crud: the hidden file input is in the tab order",
    file: "spa/src/components/crud/UploadField.tsx",
    from: 'tabIndex={-1} aria-hidden="true" accept=',
    to: "accept=",
    tests: t(UPLOAD),
  },
  // The request itself moved to the XMLHttpRequest both SPAs share (SAKEM-083, P4); the admin's uploader is a thin caller of
  // it, and its test (upload.test.tsx) still drives the whole path, so both checks break the shared file.
  {
    name: "crud: the upload progress is not reported",
    file: "shared/spa/xhr.ts",
    from: "if (event.lengthComputable && event.total > 0) onProgress?.(Math.min(1, event.loaded / event.total));",
    to: "",
    tests: t(UPLOAD),
  },
  {
    name: "crud: an abort signal does not stop the upload",
    file: "shared/spa/xhr.ts",
    from: 'signal.addEventListener("abort", () => xhr.abort(), { once: true });',
    to: "",
    tests: t(UPLOAD),
  },

  // ------------------------------------------------------------------------- the mock
  {
    name: "crud: the mock lets a read-only persona write",
    file: "spa/src/mock/resources.ts",
    from: 'if (access === "none" || (writes && access !== "write")) return error(403, "forbidden");',
    to: 'if (access === "none") return error(403, "forbidden");',
    tests: t(MOCK),
  },
  {
    name: "crud: the mock saves a stale version",
    file: "spa/src/mock/resources.ts",
    from: "if (precondition !== ifMatch(row.updatedAt)) return error(409",
    to: "if (false) return error(409",
    tests: t(MOCK, ANNOUNCEMENTS),
  },
];
