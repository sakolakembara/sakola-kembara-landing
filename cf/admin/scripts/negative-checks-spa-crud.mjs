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
