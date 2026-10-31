// The negative checks of the blog's author rule (SAKEM-116: an article is written under an account that can write), in their own
// file like negative-checks-blog.mjs: negative-checks.mjs imports and spreads `blogAuthorChecks`. Same rules as there: each check
// breaks ONE safeguard in the source, runs the tests that must notice, expects them to FAIL, and the runner restores the file.
//
//   node scripts/negative-checks.mjs --only "blog author"

const API = "test/blog.test.ts test/blog-spa-contract.test.ts";
const FILE = "src/api/blog.ts";

export const blogAuthorChecks = [
  {
    name: "blog author: a new article is saved under any name",
    file: FILE,
    from: "    if (!(await authorNames(db)).includes(form.author)) return validationError(c, { author: AUTHOR_NOT_REGISTERED });\n",
    to: "",
    tests: API,
  },
  {
    name: "blog author: an update looks at no author at all",
    file: FILE,
    from: "if (form.author !== before.author.trim() && !(await authorNames(db)).includes(form.author)) problems.author = AUTHOR_NOT_REGISTERED;",
    to: "if (false && form.author !== before.author.trim() && !(await authorNames(db)).includes(form.author)) problems.author = AUTHOR_NOT_REGISTERED;",
    tests: API,
  },
  {
    name: "blog author: an update refuses the author the article already has (the legacy ones have no account)",
    file: FILE,
    from: "if (form.author !== before.author.trim() && !(await authorNames(db)).includes(form.author)) problems.author = AUTHOR_NOT_REGISTERED;",
    to: "if (!(await authorNames(db)).includes(form.author)) problems.author = AUTHOR_NOT_REGISTERED;",
    tests: API,
  },
  {
    name: "blog author: a viewer is an author (it cannot write)",
    file: FILE,
    from: '          eq(schema.users.role, "super_admin"),',
    to: '          inArray(schema.users.role, ["super_admin", "viewer"]),',
    tests: API,
  },
  {
    name: "blog author: an editor of any area is an author, not only of konten",
    file: FILE,
    from: "and(eq(schema.users.role, \"editor\"), sql`exists (select 1 from admin_area_grants g where g.user_id = ${schema.users.id} and g.area = 'konten')`)",
    to: 'eq(schema.users.role, "editor")',
    tests: API,
  },
  {
    name: "blog author: a deactivated account is an author",
    file: FILE,
    from: "        isNull(schema.users.deactivatedAt),\n",
    to: "        sql`1 = 1`,\n",
    tests: API,
  },
  {
    name: "blog author: an account without a name has no name to write under (the part of its email is not used)",
    file: FILE,
    from: "coalesce(nullif(trim(${schema.users.name}), ''), substr(${schema.users.email}, 1, instr(${schema.users.email}, '@') - 1))",
    to: "trim(${schema.users.name})",
    tests: API,
  },
  {
    name: "blog author: a name that two accounts have is listed twice",
    file: FILE,
    from: '  return [...new Set(rows.map((row) => row.name.trim()).filter((name) => name !== ""))];',
    to: '  return rows.map((row) => row.name.trim()).filter((name) => name !== "");',
    tests: API,
  },
  {
    name: "blog author: the list is not in order",
    file: FILE,
    from: "    .orderBy(asc(authorLabel));\n",
    to: ";\n",
    tests: API,
  },
  {
    name: "blog author: a reader of the blog may ask for the list",
    file: FILE,
    from: 'app.get("/authors", requireArea("konten", "write"),',
    to: 'app.get("/authors", requireArea("konten", "read"),',
    tests: API,
  },
];
