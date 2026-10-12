// The negative checks of Aktivitas and Pengaturan (SAKEM-082), in their own file so the shared list in
// negative-checks.mjs stays short: it imports and spreads `sistemChecks`. Same rules as there: each check breaks ONE
// safeguard in the source, runs the tests that must notice, expects them to FAIL, and the runner restores the
// file. A pattern found other than exactly once is reported as FAIL, so a refactor cannot turn a check into a no-op.
//
//   node scripts/negative-checks.mjs --only sistem
//
// The SPA's side (the hidden menu, the label coverage, the last-super_admin surface) is in
// negative-checks-spa-sistem.mjs.

const AUDIT = "test/audit-viewer.test.ts";
const USERS = "test/sistem-users.test.ts";

export const sistemChecks = [
  // ------------------------------------------------------- Aktivitas: who may read
  {
    name: "sistem: the audit log is answered to anyone signed in (the super_admin guard removed)",
    file: "src/api/audit.ts",
    from: 'auditRoutes.get("/", requireArea("sistem", "read"), async (c) => {',
    to: 'auditRoutes.get("/", async (c) => {',
    tests: `${AUDIT} ${USERS}`,
  },
  {
    name: "sistem: the audit log is guarded by the area of another menu (an editor of every area reads it)",
    file: "src/api/audit.ts",
    from: 'auditRoutes.get("/", requireArea("sistem", "read"), async (c) => {',
    to: 'auditRoutes.get("/", requireArea("komunikasi", "read"), async (c) => {',
    tests: AUDIT,
  },

  // ------------------------------------------------------- Aktivitas: the cursor
  {
    name: "sistem: the cursor has no tie-break (a row with the same millisecond as the last shown is lost)",
    file: "src/audit/query.ts",
    from: "parts.push(sql`(${schema.auditLog.createdAt}, ${schema.auditLog.id}) < (${filters.cursor.createdAt}, ${filters.cursor.id})`);",
    to: "parts.push(sql`${schema.auditLog.createdAt} < ${filters.cursor.createdAt}`);",
    tests: AUDIT,
  },
  {
    name: "sistem: the order breaks ties the other way from the cursor (rows of one millisecond come in id order, the cursor expects the reverse, so pages overlap or skip)",
    file: "src/audit/query.ts",
    from: ".orderBy(desc(schema.auditLog.createdAt), desc(schema.auditLog.id))",
    to: ".orderBy(desc(schema.auditLog.createdAt), sql`${schema.auditLog.id} asc`)",
    tests: AUDIT,
  },
  {
    name: "sistem: the cursor condition is written with OR (correct, but SQLite then reads the whole table for every page)",
    file: "src/audit/query.ts",
    from: "parts.push(sql`(${schema.auditLog.createdAt}, ${schema.auditLog.id}) < (${filters.cursor.createdAt}, ${filters.cursor.id})`);",
    to: "parts.push(sql`(${schema.auditLog.createdAt} < ${filters.cursor.createdAt} or (${schema.auditLog.createdAt} = ${filters.cursor.createdAt} and ${schema.auditLog.id} < ${filters.cursor.id}))`);",
    tests: AUDIT,
  },
  {
    name: "sistem: the page size has no ceiling",
    file: "src/api/audit.ts",
    from: "maxPageSize: 100 })",
    to: "maxPageSize: 100000 })",
    tests: AUDIT,
  },

  // ------------------------------------------------------- Aktivitas: filters and days
  {
    name: "sistem: an action that is not declared is accepted as a filter",
    file: "src/audit/query.ts",
    from: 'if (!isDeclaredAction(action)) return { ok: false, param: "action" };',
    to: "",
    tests: AUDIT,
  },
  {
    name: "sistem: a day means a day in UTC, not in WIB",
    file: "src/audit/cursor.ts",
    from: "export const DAY_OFFSET_MS = 7 * 60 * 60 * 1000;",
    to: "export const DAY_OFFSET_MS = 0;",
    tests: AUDIT,
  },
  {
    name: "sistem: the migration's index on the action is missing (the filter is a scan of the table)",
    file: "migrations/0007_audit_viewer_indexes.sql",
    from: "CREATE INDEX `audit_log_action_created_idx` ON `audit_log` (`action`,`created_at`,`id`);",
    to: "CREATE INDEX `audit_log_action_created_idx` ON `audit_log` (`resource_id`);",
    tests: AUDIT,
  },

  // ------------------------------------------------------- Aktivitas: what a row may say
  {
    name: "sistem: every key of the details may leave the Worker, whoever the action is (an email on a message row)",
    file: "src/audit/present.ts",
    from: `  if (action.startsWith("admin.")) return { ...COMMON, ...ADMIN };
  if (action.startsWith("upload.")) return { ...COMMON, ...UPLOAD };
  if (action === "student.register") return { ...COMMON, ...REGISTER };
  return COMMON;`,
    to: "  return { ...COMMON, ...ADMIN, ...UPLOAD, ...REGISTER };",
    tests: AUDIT,
  },
  {
    name: "sistem: the details are the stored metadata as it is (no allow-list)",
    file: "src/audit/present.ts",
    from: "  return Object.keys(out).length === 0 ? null : out;",
    to: "  return Object.keys(source).length === 0 ? null : source;",
    tests: AUDIT,
  },
  {
    name: "sistem: the name of a student or a visitor is joined into the row like an admin's",
    file: "src/audit/query.ts",
    from: ".leftJoin(schema.users, and(eq(schema.users.id, schema.auditLog.actorId), inArray(schema.users.role, adminRoles)))",
    to: ".leftJoin(schema.users, eq(schema.users.id, schema.auditLog.actorId))",
    tests: AUDIT,
  },

  // ------------------------------------------------------- Pengaturan: who may use it
  {
    name: "sistem: one admin is read by anyone signed in",
    file: "src/api/admin-users.ts",
    from: 'adminUserRoutes.get("/:id", requireArea("sistem", "read"), async (c) => {',
    to: 'adminUserRoutes.get("/:id", async (c) => {',
    tests: USERS,
  },
  {
    name: "sistem: the edit form is saved without the super_admin guard",
    file: "src/api/admin-users.ts",
    from: 'adminUserRoutes.put("/:id", requireArea("sistem", "write"), async (c) => {',
    to: 'adminUserRoutes.put("/:id", async (c) => {',
    tests: USERS,
  },

  // ------------------------------------------------------- Pengaturan: the list
  {
    name: "sistem: the admin list shows every account, students too",
    file: "src/api/admin-users.ts",
    from: "const where = and(inArray(schema.users.role, adminRoles), query.where,",
    to: "const where = and(query.where,",
    tests: USERS,
  },
  {
    name: "sistem: the email search is a substring, not the beginning of an address",
    file: "src/api/admin-users.ts",
    from: "range ? and(gte(schema.users.email, range.from), lt(schema.users.email, range.to)) : undefined);",
    to: "range ? sql`${schema.users.email} like ${`%${range.from}%`}` : undefined);",
    tests: USERS,
  },
  {
    name: "sistem: a session that has expired still counts as the last session",
    file: "src/api/admin-users.ts",
    from: "where session.user_id = users.id and session.expires_at > ${now})`;",
    to: "where session.user_id = users.id)`;",
    tests: USERS,
  },

  // ------------------------------------------------------- Pengaturan: the edit form is one guarded save
  {
    name: "sistem: the edit form does not need If-Match",
    file: "src/api/admin-users.ts",
    from: `  if (!precondition.present) return preconditionRequired(c);
  const body = await parseBody(c, formInput, { maxBytes: 8 * 1024 });`,
    to: "  const body = await parseBody(c, formInput, { maxBytes: 8 * 1024 });",
    tests: USERS,
  },
  {
    name: "sistem: the edit form does not compare the version it was given (a save over someone else's wins)",
    file: "src/api/admin-users.ts",
    from: `  if (!matches(precondition, target.updatedAt)) return stale(c);

  const { name, role } = body.data;`,
    to: "  const { name, role } = body.data;",
    tests: USERS,
  },
  {
    name: "sistem: the account's own change does not check the version inside the transaction (two saves of one version both win)",
    file: "src/api/admin-users.ts",
    from: `.where(and(eq(schema.users.id, id), eq(schema.users.updatedAt, target.updatedAt)))
      .returning({ id: schema.users.id }),`,
    to: `.where(eq(schema.users.id, id))
      .returning({ id: schema.users.id }),`,
    tests: USERS,
  },
  {
    name: "sistem: the grants do not wait for the version (a save that lost the race still changes the areas)",
    file: "src/api/admin-users.ts",
    from: "const untouched = sql`exists (select 1 from users where id = ${id} and updated_at = ${target.updatedAt.getTime()})`;",
    to: "const untouched = sql`1 = 1`;",
    tests: USERS,
  },
  {
    name: "sistem: the audit row of the edit form is written whether or not the change took effect",
    file: "src/audit/statement.ts",
    from: "where changes() > 0`);",
    to: "where 1 = 1`);",
    tests: USERS,
  },
  {
    name: "sistem: a change of role leaves the grant rows a viewer had (only the visible ones are replaced)",
    file: "src/api/admin-users.ts",
    from: "const removed = target.storedAreas.filter((area) => !wanted.includes(area));",
    to: "const removed = target.areas.filter((area) => !wanted.includes(area));",
    tests: USERS,
  },

  // ------------------------------------------------------- Pengaturan: the last super_admin, over HTTP
  {
    name: "sistem: the form answers 500 when the database trigger refuses the last super_admin (the error is not mapped)",
    file: "src/api/admin-users.ts",
    from: `      return fail(c, 409, "last_super_admin", LAST_SUPER_ADMIN_DEMOTE, { fields: { role: "Minimal satu super admin harus tersedia" } });
    }
    throw error;`,
    to: "    }\n    throw error;",
    tests: USERS,
  },
  {
    name: "sistem: the last super_admin can step down through the form (the read and the trigger's error both unhandled)",
    edits: [
      {
        file: "src/api/admin-users.ts",
        from: `    return fail(c, 409, "last_super_admin", LAST_SUPER_ADMIN_DEMOTE, { fields: { role: "Minimal satu super admin harus tersedia" } });
  }

  const db = drizzle(c.env.DB, { schema });
  const version = nextVersion(target.updatedAt);`,
        to: "  }\n\n  const db = drizzle(c.env.DB, { schema });\n  const version = nextVersion(target.updatedAt);",
      },
      {
        file: "src/api/admin-users.ts",
        from: `      return fail(c, 409, "last_super_admin", LAST_SUPER_ADMIN_DEMOTE, { fields: { role: "Minimal satu super admin harus tersedia" } });
    }
    throw error;`,
        to: "    }\n    throw error;",
      },
      // The trigger itself, so nothing underneath holds the line either.
      {
        file: "migrations/0006_keep_one_super_admin.sql",
        from: "SELECT RAISE(ABORT, 'last_super_admin');",
        to: "SELECT 1;",
      },
    ],
    tests: USERS,
  },
];
