import { and, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { adminRoles } from "../auth/roles";
import type { Db } from "../db/audit";
import * as schema from "../db/schema";
import { dayBound, decodeCursor, type Cursor } from "./cursor";
import { isDeclaredAction, isDeclaredResourceType } from "./declared";

// The query of the Aktivitas list, in two pure halves so the route and the tests share them
// (docs/cloudflare/admin-sistem.md): `parseAuditFilters` turns the query string into filters or names the
// parameter that is wrong, `auditPageQuery` builds the one SELECT. The tests run `EXPLAIN QUERY PLAN` and count
// rows read on exactly this query.

export interface AuditFilters {
  action?: string;
  resource?: string;
  /** An email address, lower case, compared exactly with `audit_log.actor_email`. */
  actor?: string;
  from?: Date;
  to?: Date;
  cursor?: Cursor;
}

export type ParsedFilters = { ok: true; filters: AuditFilters } | { ok: false; param: "action" | "resource" | "actor" | "from" | "to" | "cursor" };

export const MAX_ACTOR_LENGTH = 254;

/** An empty value means "no filter"; anything else must be valid, or the caller is told which parameter was not. */
export function parseAuditFilters(read: (name: string) => string | undefined): ParsedFilters {
  const filters: AuditFilters = {};

  const action = read("action") ?? "";
  if (action !== "") {
    if (!isDeclaredAction(action)) return { ok: false, param: "action" };
    filters.action = action;
  }

  const resource = read("resource") ?? "";
  if (resource !== "") {
    if (!isDeclaredResourceType(resource)) return { ok: false, param: "resource" };
    filters.resource = resource;
  }

  const actor = (read("actor") ?? "").trim().toLowerCase();
  if (actor.length > MAX_ACTOR_LENGTH) return { ok: false, param: "actor" };
  if (actor !== "") filters.actor = actor;

  const from = read("from") ?? "";
  if (from !== "") {
    const start = dayBound(from, false);
    if (!start) return { ok: false, param: "from" };
    filters.from = start;
  }

  const to = read("to") ?? "";
  if (to !== "") {
    const end = dayBound(to, true);
    if (!end) return { ok: false, param: "to" };
    filters.to = end;
  }

  const cursor = read("cursor") ?? "";
  if (cursor !== "") {
    const position = decodeCursor(cursor);
    if (!position) return { ok: false, param: "cursor" };
    filters.cursor = position;
  }

  return { ok: true, filters };
}

/** The `WHERE` of a page, or undefined for the whole log. */
function conditionsOf(filters: AuditFilters): SQL | undefined {
  const parts: SQL[] = [];
  if (filters.action) parts.push(eq(schema.auditLog.action, filters.action));
  if (filters.resource) parts.push(eq(schema.auditLog.resourceType, filters.resource));
  if (filters.actor) parts.push(eq(schema.auditLog.actorEmail, filters.actor));
  if (filters.from) parts.push(gte(schema.auditLog.createdAt, filters.from));
  if (filters.to) parts.push(lte(schema.auditLog.createdAt, filters.to));
  if (filters.cursor) {
    // Everything strictly after the last row shown, in the list's order. The row-value comparison is what lets
    // SQLite seek in the (created_at, id) index: the same condition written with OR reads the whole table.
    parts.push(sql`(${schema.auditLog.createdAt}, ${schema.auditLog.id}) < (${filters.cursor.createdAt}, ${filters.cursor.id})`);
  }
  return parts.length === 0 ? undefined : and(...parts);
}

/**
 * One page: `limit` rows (the caller asks for one more than it shows, to know whether there is a next page),
 * newest first, ties broken by `id` so the order is total. The name of the actor is joined only for an admin:
 * a student's or a visitor's name is never read.
 */
export function auditPageQuery(db: Db, filters: AuditFilters, limit: number) {
  return db
    .select({
      id: schema.auditLog.id,
      createdAt: schema.auditLog.createdAt,
      action: schema.auditLog.action,
      actorEmail: schema.auditLog.actorEmail,
      actorName: schema.users.name,
      resourceType: schema.auditLog.resourceType,
      resourceId: schema.auditLog.resourceId,
      metadata: schema.auditLog.metadata,
    })
    .from(schema.auditLog)
    .leftJoin(schema.users, and(eq(schema.users.id, schema.auditLog.actorId), inArray(schema.users.role, adminRoles)))
    .where(conditionsOf(filters))
    .orderBy(desc(schema.auditLog.createdAt), desc(schema.auditLog.id))
    .limit(limit);
}
