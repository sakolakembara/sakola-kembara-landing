import { count, eq, getTableColumns, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { announcementIsLive, announcementNewestFirst } from "../public/queries";
import { ctaUrlProblem, statusOf } from "../announcements/rules";
import { requireArea } from "../auth/guard";
import type { AppEnv } from "../context";
import * as schema from "../db/schema";
import { announcementSeverity } from "../db/schema";
import { booleanFilter, crudHandlers, enumFilter, pageOf, parseListQuery, type CrudDeps } from "./crud";

// Pengumuman (area `komunikasi`), the first screen built on the admin CRUD convention
// (docs/cloudflare/admin-crud.md) and the reference for the others. Behaviour, rules and endpoints:
// docs/cloudflare/admin-komunikasi.md.
//
//   GET    /api/admin/announcements       list, each row with the `status` the public strip implies
//   POST   /api/admin/announcements       create (201)
//   GET    /api/admin/announcements/:id   one
//   PUT    /api/admin/announcements/:id   replace (If-Match, 409 stale)
//   DELETE /api/admin/announcements/:id   delete
//
// Written from the kit's own functions (`crudHandlers`) rather than `crudRoutes` because the list is not the
// kit's: it says, for each row, whether the public strip is showing it, and that needs the clock and one more
// statement. The other four routes are the kit's, unchanged: the audit row in the same transaction as the change,
// `If-Match`, and the purge of the public announcement after every create, update and delete.
//
// Port of app/(admin)/admin/announcements/actions.ts: same fields and the same messages; the legacy form posts
// "on" for the checkbox and strings for dates, this JSON API takes a boolean and ISO or datetime-local strings.

const AREA = "komunikasi" as const;

const optionalDate = z
  .string()
  .nullish()
  .transform((value) => (value ? new Date(value) : null))
  .refine((value) => value === null || !Number.isNaN(value.getTime()), {
    message: "Format tanggal tidak valid",
  });

const optionalText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .nullish()
    .transform((value) => value || null);

const announcementInput = z
  .object({
    title: z.string().trim().min(3, "Judul minimal 3 karakter").max(200, "Judul maksimal 200 karakter"),
    body: z.string().trim().min(5, "Isi minimal 5 karakter").max(500, "Isi maksimal 500 karakter"),
    severity: z.enum(announcementSeverity, { error: "Tingkat tidak dikenal" }),
    ctaLabel: optionalText(60, "Label CTA maksimal 60 karakter"),
    ctaUrl: optionalText(500, "URL CTA maksimal 500 karakter"),
    active: z.boolean().default(false),
    startsAt: optionalDate,
    endsAt: optionalDate,
  })
  .refine((v) => (v.ctaLabel === null) === (v.ctaUrl === null), {
    message: "Label dan URL CTA harus diisi keduanya",
    path: ["ctaLabel"],
  })
  .refine((v) => !v.startsAt || !v.endsAt || v.endsAt.getTime() >= v.startsAt.getTime(), {
    message: "Tanggal selesai harus setelah tanggal mulai",
    path: ["endsAt"],
  })
  // New in D1 (the legacy form took any text): a path of this site or an http(s) URL, so the strip's link cannot run script.
  .superRefine((v, ctx) => {
    const problem = v.ctaUrl === null ? null : ctaUrlProblem(v.ctaUrl);
    if (problem) ctx.addIssue({ code: "custom", message: problem, path: ["ctaUrl"] });
  });

type AnnouncementRow = typeof schema.announcements.$inferSelect;

/** What the API returns: an explicit field list (no `createdBy`), dates as ISO strings. */
function present(row: AnnouncementRow) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    severity: row.severity,
    ctaLabel: row.ctaLabel,
    ctaUrl: row.ctaUrl,
    active: row.active,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const listSpec = {
  search: [schema.announcements.title, schema.announcements.body],
  filters: {
    severity: enumFilter(schema.announcements.severity, announcementSeverity),
    active: booleanFilter(schema.announcements.active),
  },
  sorts: {
    createdAt: schema.announcements.createdAt,
    updatedAt: schema.announcements.updatedAt,
    title: schema.announcements.title,
    startsAt: schema.announcements.startsAt,
  },
  defaultSort: "-createdAt",
} as const;

/**
 * Per row: is it switched on and inside its window (`live`), switched on but outside it, or switched off. The
 * window test is `announcementIsLive`, the predicate of the public strip itself, evaluated at `now` in the same
 * statement as the page, so the list and the strip cannot disagree about a row.
 */
const phase = (now: Date) =>
  sql<"live" | "outside_window" | "inactive">`case when ${announcementIsLive(now)!} then 'live' when ${eq(schema.announcements.active, true)} then 'outside_window' else 'inactive' end`;

/** The list: the kit's envelope, and for each row the `status` ("Tampil sekarang", ...). One round trip of three statements. */
function listHandler(clock: () => Date) {
  return async (c: Context<AppEnv>) => {
    const parsed = parseListQuery(c, { ...listSpec, id: schema.announcements.id });
    if (!parsed.ok) return parsed.response;
    const { query } = parsed;
    const now = clock();
    const db = drizzle(c.env.DB, { schema });
    const [rows, totals, shown] = await db.batch([
      db
        .select({ ...getTableColumns(schema.announcements), phase: phase(now) })
        .from(schema.announcements)
        .where(query.where)
        .orderBy(...query.order)
        .limit(query.pageSize)
        .offset(query.offset),
      db.select({ total: count() }).from(schema.announcements).where(query.where),
      // The one the strip shows: the predicate and the order of `currentAnnouncementQuery` (src/public/queries.ts).
      db.select({ id: schema.announcements.id }).from(schema.announcements).where(announcementIsLive(now)).orderBy(...announcementNewestFirst).limit(1),
    ]);
    const currentId = shown[0]?.id ?? null;
    const items = rows.map(({ phase: rowPhase, ...row }) => ({ ...present(row), status: statusOf(rowPhase, row.id, currentId) }));
    return c.json(pageOf(items, query, totals[0]?.total ?? 0));
  };
}

/**
 * `deps` (a spy for the purge hook) and `options.now` (a fixed clock, to test the edges of a window) are for tests
 * only; production uses `announcementRoutes` below.
 */
export function createAnnouncementRoutes(deps?: CrudDeps, options: { now?: () => Date } = {}) {
  const handlers = crudHandlers(
    {
      area: AREA,
      table: schema.announcements,
      version: schema.announcements.updatedAt,
      audit: { name: "announcement", type: "announcement", label: (row) => row.title },
      schema: announcementInput,
      toRow: (input, { user, mode }) => ({
        title: input.title,
        body: input.body,
        severity: input.severity,
        ctaLabel: input.ctaLabel,
        ctaUrl: input.ctaUrl,
        active: input.active,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        ...(mode === "create" ? { createdBy: user.id } : {}),
      }),
      present,
      list: listSpec,
      // The strip on every public page: told after every create, update and delete.
      purge: { area: "announcement" },
    },
    deps,
  );
  const app = new Hono<AppEnv>();
  app.get("/", requireArea(AREA, "read"), listHandler(options.now ?? (() => new Date())));
  app.post("/", requireArea(AREA, "write"), handlers.create);
  app.get("/:id", requireArea(AREA, "read"), handlers.get);
  app.put("/:id", requireArea(AREA, "write"), handlers.update);
  app.delete("/:id", requireArea(AREA, "write"), handlers.remove);
  return app;
}

export const announcementRoutes = createAnnouncementRoutes();
