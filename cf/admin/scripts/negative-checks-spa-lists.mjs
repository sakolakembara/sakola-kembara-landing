// The SPA's negative checks of the polished lists (SAKEM-115, stage 3: sort buttons, empty states, cards on a phone),
// in their own file like negative-checks-spa-shell.mjs: negative-checks-spa.mjs imports and spreads `listSpaChecks`.
// Same rules: each check breaks ONE safeguard (the patch must stay valid code), runs the tests that must notice,
// expects them to FAIL, and the runner restores the file.
//
//   node scripts/negative-checks-spa.mjs --only "lists: "

const t = (...names) => names.map((name) => `spa/test/${name}`).join(" ");

const TABLE = "crud/table-pieces.test.tsx";
const REPORTS = "reports.test.tsx";
const DATA_TABLE = "spa/src/components/crud/DataTable.tsx";

export const listSpaChecks = [
  // ---------------------------------------------- sort buttons
  {
    name: "lists: a sortable header does not say which way it is sorted (no aria-sort)",
    file: DATA_TABLE,
    from: "aria-sort={sortState(column, sort)}",
    to: "aria-sort={undefined}",
    tests: t(TABLE, REPORTS),
  },
  {
    name: "lists: the first press on a date or an amount sorts oldest or smallest first",
    file: DATA_TABLE,
    from: '(column.sortFirst === "desc" ? descending : ascending)',
    to: "ascending",
    tests: t(TABLE),
  },
  {
    name: "lists: pressing the column in force does not flip its direction",
    file: DATA_TABLE,
    from: 'state === "ascending" ? descending : ascending;',
    to: "ascending;",
    tests: t(TABLE, REPORTS),
  },
  {
    name: "lists: a column with a sort gets a button even when the table has no sort to change",
    file: DATA_TABLE,
    from: "{column.sort && sort ? <SortHeader",
    to: "{column.sort ? <SortHeader",
    tests: t(TABLE),
  },
  {
    name: "lists: ListPage does not hand the sort to its table (the header buttons do nothing)",
    file: "spa/src/components/crud/ListPage.tsx",
    from: "sort={{ value: list.query.sort, onChange: list.setSort }}",
    to: "sort={undefined}",
    tests: t(REPORTS),
  },
  {
    name: "lists: a new sort stays on the page you were on (it can land past the end)",
    file: "spa/src/lib/crud/useList.ts",
    from: "setSort: (sort) => go({ ...query, sort, page: 1 }, true),",
    to: "setSort: (sort) => go({ ...query, sort }, true),",
    tests: t(REPORTS),
  },

  // ---------------------------------------------- empty states
  {
    name: "lists: a list that found nothing offers no way back to everything",
    file: "spa/src/components/crud/ListPage.tsx",
    from: "filtered && (",
    to: "false && (",
    tests: t(REPORTS),
  },
  {
    name: "lists: the empty state is not marked as a search result (the wrong icon)",
    file: DATA_TABLE,
    from: "const EmptyIcon = emptyFiltered ? SearchX : Inbox;",
    to: "const EmptyIcon = Inbox;",
    tests: t(TABLE),
  },

  // ---------------------------------------------- forms (stage 4)
  {
    name: "forms: the bar sticks on a phone too (a third of the screen, for ever)",
    file: "spa/src/components/crud/FormShell.tsx",
    from: "md:sticky md:top-0 md:z-20",
    to: "sticky top-0 z-20",
    tests: t("crud/form-shell.test.tsx"),
  },
  {
    name: "forms: the header blurs its backdrop on a phone (the fixed buttons end up inside it)",
    file: "spa/src/components/crud/FormShell.tsx",
    from: "md:bg-white/95 md:px-10 md:backdrop-blur",
    to: "bg-white/95 md:px-10 backdrop-blur",
    tests: t("crud/form-shell.test.tsx"),
  },
  {
    name: "forms: on a phone Simpan and Batal stay in the bar under the title, out of reach of the thumb",
    file: "spa/src/components/crud/FormShell.tsx",
    from: "max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-30",
    to: "max-md:static",
    tests: t("crud/form-shell.test.tsx"),
  },
  {
    name: "forms: the last field hides under the phone's bottom bar",
    file: "spa/src/components/crud/FormShell.tsx",
    from: "px-6 pb-28 pt-6 md:px-10 md:pb-12",
    to: "px-6 pb-12 pt-6 md:px-10",
    tests: t("crud/form-shell.test.tsx"),
  },

  // ---------------------------------------------- cards on a phone
  {
    name: "lists: the cells of a phone card lose their column's name",
    file: DATA_TABLE,
    from: 'data-label={typeof column.header === "string" ? column.header : undefined}',
    to: "data-label={undefined}",
    tests: t(TABLE),
  },
  {
    name: "lists: the table's roles are not written out (a table drawn as blocks loses its semantics)",
    file: DATA_TABLE,
    from: '<Table className="max-md:block" role="table">',
    to: '<Table className="max-md:block">',
    tests: t(TABLE),
  },
  {
    name: "lists: the header row stays on screen on a phone, over the cards that already name their cells",
    file: DATA_TABLE,
    from: '<THead className="max-md:sr-only" role="rowgroup">',
    to: '<THead role="rowgroup">',
    tests: t(TABLE),
  },
];
