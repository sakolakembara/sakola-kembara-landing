// The SPA's negative checks of the list tools (SAKEM-115, stage 6: rows per page, ticking rows and the bar, the row's
// menu, "Kolom", the phone's sort select, the sticky header, the chips), in their own file like negative-checks-spa-lists.mjs:
// negative-checks-spa.mjs imports and spreads `listToolsSpaChecks`. Same rules: each check breaks ONE safeguard
// (the patch must stay valid code), runs the tests that must notice, expects them to FAIL, and the runner restores the file.
//
//   node scripts/negative-checks-spa.mjs --only "tools: "

const t = (...names) => names.map((name) => `spa/test/${name}`).join(" ");

const TOOLS = "crud/list-tools.test.tsx";
const TABLE = "crud/table-pieces.test.tsx";
const QUERY = "crud/query.test.ts";
const USE_LIST = "crud/use-list.test.tsx";

const DATA_TABLE = "spa/src/components/crud/DataTable.tsx";
const LIST_PAGE = "spa/src/components/crud/ListPage.tsx";
const BULK = "spa/src/lib/crud/bulk.ts";
const OPERATIONS = "spa/src/lib/crud/useRowOperations.tsx";
const SELECTION = "spa/src/lib/crud/useSelection.ts";
const COLUMN_CHOICE = "spa/src/lib/crud/useColumnChoice.ts";
const DISCLOSURE = "spa/src/lib/use-disclosure.ts";

export const listToolsSpaChecks = [
  // ---------------------------------------------- rows per page
  {
    name: "tools: a page size nobody offers is believed when it is in the address",
    file: "spa/src/lib/crud/query.ts",
    from: "pageSize: pageSizeChoices(spec).includes(askedSize) ? askedSize : defaultPageSize(spec),",
    to: "pageSize: askedSize,",
    tests: t(QUERY),
  },
  {
    name: "tools: the address always says the page size, even the screen's own",
    file: "spa/src/lib/crud/query.ts",
    from: "if (query.pageSize !== defaultPageSize(spec)) params.set",
    to: "if (true) params.set",
    tests: t(QUERY),
  },
  {
    name: "tools: the API is asked for the screen's size, not the one chosen",
    file: "spa/src/lib/crud/query.ts",
    from: 'params.set("page", String(query.page));\n  params.set("pageSize", String(query.pageSize));',
    to: 'params.set("page", String(query.page));\n  params.set("pageSize", String(spec.pageSize ?? DEFAULT_PAGE_SIZE));',
    tests: t(QUERY),
  },
  {
    name: "tools: a new page size stays on the page you were on (it can land past the end)",
    file: "spa/src/lib/crud/useList.ts",
    from: "setPageSize: (size) => go({ ...query, pageSize: size, page: 1 }, true),",
    to: "setPageSize: (size) => go({ ...query, pageSize: size }, true),",
    tests: t(USE_LIST),
  },
  {
    name: "tools: 'Baris per halaman' is offered for a list that fits the smallest size",
    file: "spa/src/components/crud/Pagination.tsx",
    from: "{perPage && total > Math.min(...perPage.choices) && (",
    to: "{perPage && (",
    tests: t(TABLE),
  },
  {
    name: "tools: the select shows the size of the answer on screen, not the one just chosen",
    file: LIST_PAGE,
    from: "perPage={{ value: list.query.pageSize,",
    to: "perPage={{ value: list.pageSize,",
    tests: t(TOOLS),
  },

  // ---------------------------------------------- ticking rows
  {
    name: "tools: ticks carry over to another page, search, filter or sort",
    file: SELECTION,
    from: "useEffect(() => setTicked(new Set()), [resetKey]);",
    to: "useEffect(() => setTicked(new Set()), []);",
    tests: t(TOOLS),
  },
  {
    name: "tools: the box of the page unticks the page when only some of it is ticked",
    file: SELECTION,
    from: "page.length > 0 && page.every((id) => current.has(id))",
    to: "page.length > 0 && page.some((id) => current.has(id))",
    tests: t(TOOLS),
  },
  {
    name: "tools: rows an action went through for stay ticked",
    file: LIST_PAGE,
    from: "selection.drop(done.map(idOf));",
    to: "void done;",
    tests: t(TOOLS),
  },
  {
    name: "tools: after a run that lost a row, every tick goes, so the row to try again is no longer ticked",
    file: LIST_PAGE,
    from: "selection.drop(done.map(idOf));",
    to: "selection.clear();",
    tests: t(TOOLS),
  },
  {
    name: "tools: the checkboxes have no names, so a screen reader hears a row of unnamed boxes",
    file: DATA_TABLE,
    from: "aria-label={label}",
    to: "aria-label={undefined}",
    tests: t(TABLE, TOOLS),
  },
  {
    name: "tools: the box of the page does not show that only some rows are ticked",
    file: DATA_TABLE,
    from: "if (input.current) input.current.indeterminate = indeterminate;",
    to: "if (input.current) input.current.indeterminate = false;",
    tests: t(TABLE, TOOLS),
  },
  {
    name: "tools: an empty table's one row stops short of the checkbox column",
    file: DATA_TABLE,
    from: "(selection ? 1 : 0)",
    to: "0",
    tests: t(TABLE),
  },
  {
    name: "tools: the count of ticked rows is announced as a second status, which hides the notice from a screen reader",
    file: "spa/src/components/crud/BulkBar.tsx",
    from: '<p aria-live="polite" aria-atomic="true" className="sr-only">',
    to: '<p role="status" className="sr-only">',
    tests: t("shortlinks.test.tsx", TOOLS),
  },
  {
    name: "tools: the bar goes to the top of the page again, in front of the table (every row moves when one is ticked)",
    file: "spa/src/components/crud/BulkBar.tsx",
    from: "sticky bottom-4 z-30 mx-auto mt-4",
    to: "sticky top-0 z-30 mx-auto mb-4",
    tests: t(TOOLS),
  },
  {
    name: "tools: the bar offers an operation that no ticked row can take",
    file: LIST_PAGE,
    from: ".filter((operation) => selection.rows.some((row) => operation.applies?.(row) ?? true))",
    to: ".filter(() => true)",
    tests: t(TOOLS),
  },

  // ---------------------------------------------- what the bar does
  {
    name: "tools: a delete of several rows is done without asking",
    file: OPERATIONS,
    from: "open: asked !== null,",
    to: "open: false,",
    tests: t(TOOLS),
  },
  {
    name: "tools: a delete of several rows sends no version, so it overwrites what someone else changed",
    file: OPERATIONS,
    from: "ifMatch: row.updatedAt ? ifMatch(row.updatedAt) : undefined",
    to: "ifMatch: undefined",
    tests: t(TOOLS),
  },
  {
    name: "tools: a row someone else already deleted counts as a failure",
    file: OPERATIONS,
    from: "{ goneIsDone: true, onProgress: setFinished }",
    to: "{ goneIsDone: false, onProgress: setFinished }",
    tests: t(TOOLS),
  },
  {
    name: "tools: an operation runs on the rows it does not apply to (a published article published again)",
    file: OPERATIONS,
    from: "const targets = operation.applies ? rows.filter(operation.applies) : [...rows];",
    to: "const targets = [...rows];",
    tests: t(TOOLS),
  },
  {
    name: "tools: a failure that would hit every row (no permission, offline, rate limited) does not stop the run",
    file: BULK,
    from: "if (stopsTheRun(outcome)) {",
    to: "if (false && stopsTheRun(outcome)) {",
    tests: t(TOOLS),
  },
  {
    name: "tools: one row's own failure (edited by someone else) stops the run",
    file: BULK,
    from: "return failure.status === 0 || failure.status === 401",
    to: "return true || failure.status === 0 || failure.status === 401",
    tests: t(TOOLS),
  },
  {
    name: "tools: a run that lost a row is reported as a success",
    file: BULK,
    from: "if (result.failed.length === 0 && result.skipped.length === 0) return",
    to: "if (result.done.length > 0) return",
    tests: t(TOOLS),
  },
  {
    name: "tools: a stale row's failure is the long sentence about a form, not the short one about the list",
    file: BULK,
    from: 'return described.stale ? "sudah diubah orang lain, muat ulang daftar" : described.message;',
    to: "return described.message;",
    tests: t(TOOLS),
  },

  // ---------------------------------------------- the row's menu and the disclosure it stands on
  {
    name: "tools: the row's menu sits inside the table's box, where the card clips it",
    file: "spa/src/components/crud/RowMenu.tsx",
    from: 'className="fixed z-50 min-w-44',
    to: 'className="absolute z-50 min-w-44',
    tests: t(TOOLS),
  },
  {
    name: "tools: Escape closes a menu but leaves the focus nowhere",
    file: DISCLOSURE,
    from: "trigger.current?.focus();",
    to: "void trigger;",
    tests: t(TOOLS),
  },
  {
    name: "tools: a press outside a menu leaves it open",
    file: DISCLOSURE,
    from: "if (!root.current?.contains(event.target as Node)) setOpen(false);",
    to: "void event;",
    tests: t(TOOLS),
  },

  {
    name: "tools: why a menu item is off is left out (the reason was only a tooltip, which a keyboard never sees)",
    file: "spa/src/components/crud/RowMenu.tsx",
    from: "{item.hint ? (",
    to: "{false ? (",
    tests: t("settings.test.tsx"),
  },

  // ---------------------------------------------- Kolom
  {
    name: "tools: the first column, the one that names the row, is offered to be hidden",
    file: COLUMN_CHOICE,
    from: "columns.slice(1).flatMap(",
    to: "columns.flatMap(",
    tests: t(TOOLS),
  },
  {
    name: "tools: a stored choice can hide the first column",
    file: COLUMN_CHOICE,
    from: "columns.filter((column, index) => index === 0 || !offered.has(column.key) || !hidden.has(column.key))",
    to: "columns.filter((column) => !hidden.has(column.key))",
    tests: t(TOOLS),
  },
  {
    name: "tools: the choice of columns is not kept for the next visit",
    file: COLUMN_CHOICE,
    from: "else window.localStorage.setItem(KEY + id, JSON.stringify([...hidden]));",
    to: "else void KEY;",
    tests: t(TOOLS),
  },
  {
    name: "tools: storage that throws takes the list down with it",
    file: COLUMN_CHOICE,
    from: "  } catch {\n    return new Set();\n  }",
    to: "  } catch (error) {\n    throw error;\n  }",
    tests: t(TOOLS),
  },

  // ---------------------------------------------- the phone's sort select
  {
    name: "tools: a phone has no way to sort",
    file: DATA_TABLE,
    from: "{(choices.length > 0 || selection) && showRows && (",
    to: "{false && showRows && (",
    tests: t(TABLE, TOOLS),
  },
  {
    name: "tools: the sort select offers a column one way only",
    file: DATA_TABLE,
    from: 'return column.sortFirst === "desc" ? [down, up] : [up, down];',
    to: "return [up];",
    tests: t(TABLE, TOOLS),
  },
  {
    name: "tools: the sort select does not show the sort in force",
    file: DATA_TABLE,
    from: 'className="w-auto" value={sort.value} onChange={(event) => sort.onChange(event.target.value)}>',
    to: 'className="w-auto" defaultValue="" onChange={(event) => sort.onChange(event.target.value)}>',
    tests: t(TABLE, TOOLS),
  },

  // ---------------------------------------------- the sticky header
  {
    name: "tools: the header cells do not stick to the top of the page",
    file: DATA_TABLE,
    from: 'const STICKY = "md:sticky md:top-0',
    to: 'const STICKY = "md:top-0',
    tests: t(TABLE),
  },
  {
    name: "tools: the card is a box that hides overflow, which a sticky header cannot escape",
    file: DATA_TABLE,
    from: '<TableCard className="md:overflow-clip">',
    to: "<TableCard>",
    tests: t(TABLE),
  },
  {
    name: "tools: a table wider than its card is clipped, hiding its last columns, instead of scrolled",
    file: DATA_TABLE,
    from: 'wrapperClassName={fits ? "md:overflow-x-clip" : undefined}',
    to: 'wrapperClassName="md:overflow-x-clip"',
    tests: t(TABLE),
  },

  // ---------------------------------------------- the chips
  {
    name: "tools: a chip clears every filter, not just its own",
    file: "spa/src/components/crud/FilterBar.tsx",
    from: 'clear: () => choose(filter.name, "") });',
    to: "clear: () => list.reset() });",
    tests: t(TOOLS),
  },
  {
    name: "tools: a chip shows the raw value of its filter (draft) instead of its label (Draf)",
    file: "spa/src/components/crud/FilterBar.tsx",
    from: "filter.options.find((option) => option.value === value)?.label ?? value,",
    to: "value,",
    tests: t(TABLE, TOOLS),
  },
  {
    name: "tools: a bar with only two controls grows chips",
    file: "spa/src/components/crud/FilterBar.tsx",
    from: "const CHIPS_FROM = 3;",
    to: "const CHIPS_FROM = 1;",
    tests: t(TABLE),
  },
];
