import { and, count, eq, getTableColumns } from "drizzle-orm";
import type { AnySQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { Hono, type Context } from "hono";
import type { z } from "zod";
import { requireArea } from "../../auth/guard";
import type { AdminArea } from "../../auth/permissions";
import type { AppEnv, AuthUser } from "../../context";
import type { AuditResourceType, CrudAction, CrudName } from "../../db/audit";
import { notifyContentChanged, type ContentChange } from "../../public/purge";
import { deleteUploadByPath } from "../../uploads/store";
import { changedFields, withAudit } from "./audit";
import { etagOf, matches, nextVersion, readIfMatch } from "./concurrency";
import { conflict, inUse, isForeignKeyViolation, isUniqueViolation, notFound, preconditionRequired, stale } from "./errors";
import { pageOf, parseListQuery, type ListSpec } from "./pagination";
import { parseBody } from "./validation";
import { getDb } from "../../db/client";

// One resource as five routes (docs/cloudflare/admin-crud.md#14-the-worker-kit).
//
//   GET    /            list     { items, page, pageSize, total }
//   POST   /            create   201 { item }
//   GET    /:id         one      { item }, ETag
//   PUT    /:id         replace  { item }, needs If-Match, 409 stale
//   DELETE /:id         delete   204
//
// `crudRoutes(config)` mounts them behind `requireArea`; `crudHandlers(config)`
// gives the five handlers alone, for a router that adds its own routes next to
// them. Both are built from the same few steps (parse the query, parse the
// body, read the row, change it with its audit row in one batch, tell the
// public side), which is also the order in which each route answers:
//
//   create   415/413/400 body -> insert + audit
//   update   428 If-Match -> body -> 404 -> 409 stale -> update + audit (409 if it lost a race)
//   delete   404 -> 409 stale (when If-Match is sent) -> delete + audit
//
// A bad form is therefore answered before any D1 read.

type Row = Record<string, unknown>;
type RowOf<T extends SQLiteTable> = T["$inferSelect"];
type Table = SQLiteTable & { id: AnySQLiteColumn };

export interface ResourceConfig<TTable extends Table, TInput, TItem> {
  /** Reads need `read` access to this area, writes need `write` (`requireArea`). */
  area: AdminArea;
  table: TTable;
  /** The `updated_at` column: the version `If-Match` compares. Without it the resource has no `PUT` and no ETag. */
  version?: AnySQLiteColumn;
  audit: {
    /** The legacy short name: the action is `<name>.create|update|delete`. */
    name: CrudName;
    type: AuditResourceType;
    /** A short NON-personal name for the audit row. It sees the row as it will be after the change (before it, for a delete). Leave it out for resources about people. */
    label?: (row: RowOf<TTable>) => string | null | undefined;
  };
  /** The form, for create and for update. Messages in Indonesian. */
  schema: z.ZodType<TInput>;
  /** Parsed input -> the columns to write. On `update` return only what a form may change (not `createdBy`). */
  toRow: (input: TInput, context: { user: AuthUser; mode: "create" | "update" }) => Partial<TTable["$inferInsert"]>;
  /** Row -> what the API returns. An explicit field list, never the row as it is. */
  present: (row: RowOf<TTable>) => TItem;
  list: Omit<ListSpec, "id"> & {
    /** A lighter shape for the list (no long columns), when `present` is heavy. */
    present?: (row: RowOf<TTable>) => unknown;
  };
  /** What to purge from the public caches after a change. A function sees the row that was written (or deleted). */
  purge?: ContentChange | ((row: RowOf<TTable>) => ContentChange | readonly ContentChange[]);
  /** The upload paths a row holds; a path in the old row and not in the new one is deleted after the save. */
  uploads?: (row: RowOf<TTable>) => readonly (string | null | undefined)[];
  /** A unique index -> the field to blame: `{ "shortlinks.slug": { field: "slug", message: "Slug sudah dipakai" } }`. */
  unique?: Record<string, { field: string; message: string }>;
  /** What to say when a foreign key refuses the delete (a batch that still has applications). */
  inUse?: { usedBy: readonly string[]; message?: string };
  routes?: { create?: boolean; update?: boolean; delete?: boolean };
  /** Largest JSON body, in bytes. Default 512 KiB. */
  maxBodyBytes?: number;
}

/** What a test may replace. Production never passes it. */
export interface CrudDeps {
  notify: (change: ContentChange, waitUntil: (promise: Promise<unknown>) => void) => unknown;
  deleteUpload: typeof deleteUploadByPath;
}

const defaultDeps: CrudDeps = { notify: notifyContentChanged, deleteUpload: deleteUploadByPath };

const MAX_ID_LENGTH = 128;

function waitUntilOf(c: Context): (promise: Promise<unknown>) => void {
  try {
    const ctx = c.executionCtx;
    return (promise) => ctx.waitUntil(promise);
  } catch {
    // No execution context (a plain call in a unit test): let it run, ignore its result.
    return (promise) => void promise.catch(() => undefined);
  }
}

function propertyOf(table: SQLiteTable, column: AnySQLiteColumn): string {
  const found = Object.entries(getTableColumns(table)).find(([, candidate]) => candidate === column);
  if (!found) throw new Error("crud: `version` is not a column of `table`");
  return found[0];
}

export function crudHandlers<TTable extends Table, TInput, TItem>(config: ResourceConfig<TTable, TInput, TItem>, deps: CrudDeps = defaultDeps) {
  const table = config.table as SQLiteTable;
  const idColumn = config.table.id;
  const versionColumn = config.version;
  const versionKey = versionColumn ? propertyOf(table, versionColumn) : null;
  const present = config.present as (row: Row) => unknown;
  const presentInList = (config.list.present ?? config.present) as (row: Row) => unknown;
  const labelOf = (row: Row) => config.audit.label?.(row as RowOf<TTable>) ?? null;
  const action = (verb: "create" | "update" | "delete") => `${config.audit.name}.${verb}` as CrudAction;

  const versionOf = (row: Row): Date | null => (versionKey ? ((row[versionKey] as Date | undefined) ?? null) : null);
  const withEtag = (c: Context, row: Row) => {
    const version = versionOf(row);
    if (version) c.header("ETag", etagOf(version));
  };

  async function findRow(c: Context<AppEnv>, id: string): Promise<Row | null> {
    const db = getDb(c.env.DB);
    const rows = (await db.select().from(table).where(eq(idColumn, id)).limit(1)) as Row[];
    return rows[0] ?? null;
  }

  function afterCommit(c: Context<AppEnv>, user: AuthUser, before: Row | null, after: Row | null) {
    const waitUntil = waitUntilOf(c);

    if (config.purge) {
      // An update names the old row too: a changed slug leaves a stale page under the old one.
      const subjects = [after, before].filter((row): row is Row => row !== null);
      const seen = new Set<string>();
      for (const row of subjects) {
        const changes = typeof config.purge === "function" ? config.purge(row as RowOf<TTable>) : config.purge;
        for (const change of Array.isArray(changes) ? changes : [changes as ContentChange]) {
          const key = JSON.stringify(change);
          if (seen.has(key)) continue;
          seen.add(key);
          deps.notify(change, waitUntil);
        }
      }
    }

    if (config.uploads && before) {
      const kept = new Set(after ? config.uploads(after as RowOf<TTable>) : []);
      const removed = [...new Set(config.uploads(before as RowOf<TTable>))].filter((path): path is string => typeof path === "string" && path !== "" && !kept.has(path));
      if (removed.length > 0) {
        waitUntil(
          Promise.all(removed.map((path) => deps.deleteUpload(c.env, user, path))).catch(() => {
            // Message only: a path can hold a file name.
            console.error("[crud] upload cleanup failed");
          }),
        );
      }
    }
  }

  /** A unique index refused the row: the 409 for it, or null when the error is not one of the declared ones. */
  function conflictFor(c: Context, error: unknown): Response | null {
    for (const [target, { field, message }] of Object.entries(config.unique ?? {})) {
      if (isUniqueViolation(error, target)) return conflict(c, { [field]: message });
    }
    return null;
  }

  const validId = (id: string) => id.length > 0 && id.length <= MAX_ID_LENGTH;

  return {
    async list(c: Context<AppEnv>) {
      const parsed = parseListQuery(c, { ...config.list, id: idColumn });
      if (!parsed.ok) return parsed.response;
      const { query } = parsed;
      const db = getDb(c.env.DB);
      // One round trip: the page and the total over the same WHERE.
      const [rows, totals] = await db.batch([
        db.select().from(table).where(query.where).orderBy(...query.order).limit(query.pageSize).offset(query.offset),
        db.select({ total: count() }).from(table).where(query.where),
      ]);
      return c.json(pageOf((rows as Row[]).map(presentInList), query, totals[0]?.total ?? 0));
    },

    async get(c: Context<AppEnv>) {
      const id = c.req.param("id") ?? "";
      if (!validId(id)) return notFound(c);
      const row = await findRow(c, id);
      if (!row) return notFound(c);
      withEtag(c, row);
      return c.json({ item: present(row) });
    },

    async create(c: Context<AppEnv>) {
      const body = await parseBody(c, config.schema, { maxBytes: config.maxBodyBytes });
      if (!body.ok) return body.response;
      const user = c.get("user");
      const values = { ...(config.toRow(body.data, { user, mode: "create" }) as Row), id: crypto.randomUUID() };
      const db = getDb(c.env.DB);
      let created: Row | undefined;
      try {
        const [rows] = await withAudit(
          db,
          user,
          { action: action("create"), resourceType: config.audit.type, resourceId: values.id, fields: Object.keys(values).filter((key) => key !== "id" && key !== "createdBy"), label: labelOf(values) },
          [db.insert(table).values(values as never).returning()],
        );
        created = (rows as Row[])[0];
      } catch (error) {
        const refused = conflictFor(c, error);
        if (refused) return refused;
        throw error;
      }
      if (!created) throw new Error("crud: insert returned no row");
      afterCommit(c, user, null, created);
      withEtag(c, created);
      return c.json({ item: present(created) }, 201);
    },

    async update(c: Context<AppEnv>) {
      if (!versionColumn || !versionKey) throw new Error("crud: update needs `version`");
      const id = c.req.param("id") ?? "";
      const precondition = readIfMatch(c);
      if (!precondition.present) return preconditionRequired(c);
      const body = await parseBody(c, config.schema, { maxBytes: config.maxBodyBytes });
      if (!body.ok) return body.response;
      if (!validId(id)) return notFound(c);

      const before = await findRow(c, id);
      if (!before) return notFound(c);
      const current = versionOf(before)!;
      if (!matches(precondition, current)) return stale(c);

      const user = c.get("user");
      const values = config.toRow(body.data, { user, mode: "update" }) as Row;
      const fields = changedFields(before, values);
      if (fields.length === 0) {
        // Nothing to save: no write, no audit row, the version stays.
        withEtag(c, before);
        return c.json({ item: present(before) });
      }

      const db = getDb(c.env.DB);
      let updated: Row | undefined;
      try {
        // The version is in the WHERE too: two saves that read the same version cannot both win.
        const [rows] = await withAudit(
          db,
          user,
          { action: action("update"), resourceType: config.audit.type, resourceId: id, fields, label: labelOf({ ...before, ...values }) },
          [
            db
              .update(table)
              .set({ ...values, [versionKey]: nextVersion(current) } as never)
              .where(and(eq(idColumn, id), eq(versionColumn, current)))
              .returning(),
          ],
        );
        updated = (rows as Row[])[0];
      } catch (error) {
        const refused = conflictFor(c, error);
        if (refused) return refused;
        throw error;
      }
      if (!updated) return stale(c); // lost the race: nothing was written, no audit row either
      afterCommit(c, user, before, updated);
      withEtag(c, updated);
      return c.json({ item: present(updated) });
    },

    async remove(c: Context<AppEnv>) {
      const id = c.req.param("id") ?? "";
      if (!validId(id)) return notFound(c);
      const precondition = readIfMatch(c);
      const before = await findRow(c, id);
      if (!before) return notFound(c);
      const current = versionOf(before);
      if (precondition.present && (!current || !matches(precondition, current))) return stale(c);

      const user = c.get("user");
      const db = getDb(c.env.DB);
      const where = precondition.present && versionColumn && current ? and(eq(idColumn, id), eq(versionColumn, current)) : eq(idColumn, id);
      let removed: unknown[];
      try {
        const [rows] = await withAudit(db, user, { action: action("delete"), resourceType: config.audit.type, resourceId: id, label: labelOf(before) }, [
          db.delete(table).where(where).returning({ id: idColumn }),
        ]);
        removed = rows as unknown[];
      } catch (error) {
        if (config.inUse && isForeignKeyViolation(error)) return inUse(c, config.inUse.usedBy, config.inUse.message);
        throw error;
      }
      // Nothing deleted although the row was just read: someone else deleted or changed it in between.
      if (removed.length === 0) return precondition.present ? stale(c) : notFound(c);
      afterCommit(c, user, before, null);
      return c.body(null, 204);
    },
  };
}

/** The five routes of a resource behind `requireArea`: mount with `app.route("/api/admin/<resource>", crudRoutes(config))`. */
export function crudRoutes<TTable extends Table, TInput, TItem>(config: ResourceConfig<TTable, TInput, TItem>, deps?: CrudDeps) {
  const handlers = crudHandlers(config, deps);
  const routes = config.routes ?? {};
  const app = new Hono<AppEnv>();
  app.get("/", requireArea(config.area, "read"), handlers.list);
  if (routes.create !== false) app.post("/", requireArea(config.area, "write"), handlers.create);
  app.get("/:id", requireArea(config.area, "read"), handlers.get);
  if (routes.update !== false && config.version) app.put("/:id", requireArea(config.area, "write"), handlers.update);
  if (routes.delete !== false) app.delete("/:id", requireArea(config.area, "write"), handlers.remove);
  return app;
}
