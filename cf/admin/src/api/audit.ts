import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { encodeCursor } from "../audit/cursor";
import { projectDetails } from "../audit/present";
import { auditPageQuery, parseAuditFilters } from "../audit/query";
import { requireArea } from "../auth/guard";
import type { AppEnv } from "../context";
import * as schema from "../db/schema";
import { invalidQuery, parsePage, reader } from "./crud";

// Aktivitas (area `sistem`, super_admin only): the audit log, read-only
// (docs/cloudflare/admin-sistem.md). Port of app/(admin)/admin/audit/page.tsx.
//
// One route, `GET /api/admin/audit`, newest first, with a CURSOR instead of pages: the table grows by a few
// rows per admin action for as long as the retention allows (365 days), and an offset or a `count(*)` would
// read every row it skips or counts. The cursor design is in src/audit/cursor.ts, the query in
// src/audit/query.ts.
//
//   pageSize   1 to 100, default 50 (the legacy page size)
//   cursor     what `nextCursor` of the previous answer said
//   action     one of the declared actions, exactly (src/audit/declared.ts)
//   resource   one of the declared resource types, exactly
//   actor      an email address, exactly (stored lower case, so any case is accepted)
//   from, to   a day, YYYY-MM-DD, the whole day in WIB (src/audit/cursor.ts)
//
// An unknown `action` or `resource`, a malformed `cursor`, `from`, `to` or an `actor` over 254 characters is
// `400 invalid_query`: a filter that is silently ignored would show the wrong list (admin-crud.md#3).
//
// What a row shows: when, the declared action, who (the email in the row and, for an admin, their name), what
// it was about (type and id) and `details`: the part of `metadata` that src/audit/present.ts allows, which is
// column names, a non-personal label and, for the admin and upload rows, the few keys listed there. Nothing is
// ever written from here: there is no POST, PUT or DELETE.

export const auditRoutes = new Hono<AppEnv>();

export const DEFAULT_AUDIT_PAGE_SIZE = 50;

auditRoutes.get("/", requireArea("sistem", "read"), async (c) => {
  const read = reader(c);
  const { pageSize } = parsePage(read, { defaultPageSize: DEFAULT_AUDIT_PAGE_SIZE, maxPageSize: 100 });
  const parsed = parseAuditFilters(read);
  if (!parsed.ok) return invalidQuery(c, parsed.param);

  // One more than a page: whether there is a next page, without counting anything.
  const rows = await auditPageQuery(drizzle(c.env.DB, { schema }), parsed.filters, pageSize + 1);

  const page = rows.slice(0, pageSize);
  const last = page.at(-1);
  return c.json({
    items: page.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      action: row.action,
      actorEmail: row.actorEmail,
      actorName: row.actorName,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      details: projectDetails(row.action, row.metadata),
    })),
    pageSize,
    nextCursor: rows.length > pageSize && last ? encodeCursor({ createdAt: last.createdAt.getTime(), id: last.id }) : null,
  });
});
