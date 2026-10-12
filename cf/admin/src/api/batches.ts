import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { batchQuery, batchRecentApplicantsQuery, batchStatusCountsQuery, batchesPageQuery, batchesTotalQuery } from "../admission/queries";
import { requireArea } from "../auth/guard";
import type { AppEnv } from "../context";
import { batchPhase, type BatchPhase } from "../dashboard/payload";
import { undecidedApplicationsQuery } from "../dashboard/queries";
import * as schema from "../db/schema";
import { admissionBatches, type ApplicationStatus } from "../db/schema";
import { crudHandlers, fail, notFound, pageOf, parseListQuery, withAudit, type CrudDeps } from "./crud";

// Batch (area `pendaftaran`): the yearly admission batches. A port of app/(admin)/admin/batches/*.
//
//   GET    /api/admin/batches                list (page, total, and the phase and undecided counts of each)
//   POST   /api/admin/batches                create
//   GET    /api/admin/batches/:id            the batch, its counts per status, its 5 newest applicants
//   PUT    /api/admin/batches/:id            edit (If-Match)
//   DELETE /api/admin/batches/:id            delete; 409 in_use while applications exist (the foreign key)
//   POST   /api/admin/batches/:id/publish    publish the results (the legacy preconditions, checked atomically)
//   POST   /api/admin/batches/:id/unpublish  cancel the publication
//
// Create, edit and delete are `crudHandlers` (docs/cloudflare/admin-crud.md); the list and the detail carry more
// than a row, so they are written here from the same functions, and publish and unpublish are verb routes.
// Nothing here touches the public site's caches: the public API serves no batch (it is the portal that reads
// `results_published_at`, a later milestone), so there is no purge to declare.
//
// The legacy rules, unchanged: the year is unique and between 2024 and 2100, the window closes after it opens,
// results can be published only once every applicant is decided, and there is at least one. What is new: a batch
// with no applications can be deleted (the legacy admin had no delete; the foreign key refuses it otherwise),
// and the legacy "anyone signed in may do this" is now the `pendaftaran` write right.

const requiredDate = (missing: string) =>
  z
    .string({ error: missing })
    .min(1, missing)
    .transform((value) => new Date(value))
    .refine((date) => !Number.isNaN(date.getTime()), { message: "Format tanggal tidak valid" });

/** The form of a batch. The messages are the legacy server action's; the ones it left to zod's English are written here. */
export const batchInput = z
  .object({
    year: z.coerce
      .number({ error: "Tahun harus berupa angka" })
      .int("Tahun harus bilangan bulat")
      .gte(2024, "Tahun terlalu jauh ke belakang")
      .lte(2100, "Tahun terlalu jauh ke depan"),
    name: z.string().trim().min(3, "Nama minimal 3 karakter").max(120, "Nama maksimal 120 karakter"),
    description: z
      .string()
      .trim()
      .max(1000, "Deskripsi maksimal 1000 karakter")
      .nullish()
      .transform((value) => value || null),
    opensAt: requiredDate("Tanggal buka wajib diisi"),
    closesAt: requiredDate("Tanggal tutup wajib diisi"),
  })
  .refine(
    (value) => {
      // When a date is missing or unreadable its own message is already there; the comparison would only add a wrong one.
      // (A date that failed an earlier check reaches this rule as the text it was sent as.)
      const { opensAt, closesAt } = value;
      if (!(opensAt instanceof Date) || !(closesAt instanceof Date) || Number.isNaN(opensAt.getTime()) || Number.isNaN(closesAt.getTime())) return true;
      return closesAt.getTime() > opensAt.getTime();
    },
    { message: "Tanggal tutup harus setelah tanggal buka", path: ["closesAt"] },
  );

type BatchRow = typeof admissionBatches.$inferSelect;

/** What the API returns for a batch: an explicit field list (no `createdBy`), dates as ISO strings. */
export function presentBatch(row: Pick<BatchRow, "id" | "year" | "name" | "description" | "opensAt" | "closesAt" | "resultsPublishedAt" | "createdAt" | "updatedAt">) {
  return {
    id: row.id,
    year: row.year,
    name: row.name,
    description: row.description,
    opensAt: row.opensAt.toISOString(),
    closesAt: row.closesAt.toISOString(),
    resultsPublishedAt: row.resultsPublishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const MESSAGES = {
  notFound: "Batch tidak ditemukan",
  alreadyPublished: "Hasil sudah dipublikasikan",
  noApplicants: "Belum ada pendaftar di batch ini",
  undecided: (n: number) => `Masih ada ${n} pendaftar yang belum diputuskan`,
  changedMeanwhile: "Data batch berubah saat diproses. Muat ulang lalu coba lagi.",
  inUse: "Batch ini masih punya pendaftar, jadi tidak bisa dihapus.",
} as const;

/** How many of the newest applicants the detail shows (the full list is the Pendaftar page, filtered to the batch). */
export const RECENT_APPLICANTS = 5;

type Counts = Record<ApplicationStatus, number> & { total: number };

/** The detail of a batch: the batch, where it stands, how its applicants are decided, and the newest few. */
export interface BatchDetail extends ReturnType<typeof presentBatch> {
  phase: BatchPhase;
  counts: Counts;
  /** Not published, at least one applicant, none undecided: the one rule of the "Publikasikan Hasil" button (the server checks it again). */
  canPublish: boolean;
  recent: { id: string; fullName: string; email: string; schoolName: string; status: ApplicationStatus; submittedAt: string }[];
}

async function loadDetail(c: Context<AppEnv>, id: string, now = new Date()): Promise<BatchDetail | null> {
  const db = drizzle(c.env.DB, { schema });
  // One round trip: the batch, its counts per status, its newest applicants.
  const [rows, grouped, recent] = await db.batch([batchQuery(db, id), batchStatusCountsQuery(db, id), batchRecentApplicantsQuery(db, id, RECENT_APPLICANTS)]);
  const row = rows[0];
  if (!row) return null;
  const counts: Counts = { pending: 0, under_review: 0, accepted: 0, rejected: 0, total: 0 };
  for (const entry of grouped) {
    counts[entry.status] = entry.n;
    counts.total += entry.n;
  }
  const undecided = counts.pending + counts.under_review;
  return {
    ...presentBatch(row),
    phase: batchPhase({ ...row, hasApplications: counts.total > 0 }, undecided, now),
    counts,
    canPublish: !row.resultsPublishedAt && counts.total > 0 && undecided === 0,
    recent: recent.map((entry) => ({ ...entry, submittedAt: entry.submittedAt.toISOString() })),
  };
}

const MAX_ID_LENGTH = 128;
const validId = (id: string) => id.length > 0 && id.length <= MAX_ID_LENGTH;

/** `deps` is for tests only (a spy that proves nothing is purged); production uses `batchRoutes` below. */
export function createBatchRoutes(deps?: CrudDeps) {
  const handlers = crudHandlers(
    {
      area: "pendaftaran",
      table: admissionBatches,
      version: admissionBatches.updatedAt,
      // The name of a batch ("Gen 6 - 2026/2027") is not personal data.
      audit: { name: "batch", type: "batch", label: (row) => row.name },
      schema: batchInput,
      toRow: (input, { user, mode }) => ({
        year: input.year,
        name: input.name,
        description: input.description,
        opensAt: input.opensAt,
        closesAt: input.closesAt,
        ...(mode === "create" ? { createdBy: user.id } : {}),
      }),
      present: presentBatch,
      list: {
        search: [admissionBatches.name],
        sorts: { year: admissionBatches.year, opensAt: admissionBatches.opensAt, name: admissionBatches.name },
        defaultSort: "-year",
      },
      // The unique index on the year is the final arbiter when two admins create the same year at once.
      unique: { "admission_batches.year": { field: "year", message: "Tahun sudah dipakai batch lain" } },
      inUse: { usedBy: ["Pendaftar"], message: MESSAGES.inUse },
      maxBodyBytes: 16 * 1024,
    },
    deps,
  );

  const app = new Hono<AppEnv>();
  const read = requireArea("pendaftaran", "read");
  const write = requireArea("pendaftaran", "write");

  // The list: the page, the total and the applicants still undecided per batch, in one round trip. The phase is
  // worked out here with the dashboard's own function (src/dashboard/payload.ts), never in the browser.
  app.get("/", read, async (c) => {
    const parsed = parseListQuery(c, {
      search: [admissionBatches.name],
      sorts: { year: admissionBatches.year, opensAt: admissionBatches.opensAt, name: admissionBatches.name },
      defaultSort: "-year",
      id: admissionBatches.id,
    });
    if (!parsed.ok) return parsed.response;
    const { query } = parsed;
    const db = drizzle(c.env.DB, { schema });
    const [rows, totals, waiting] = await db.batch([batchesPageQuery(db, query), batchesTotalQuery(db, query), undecidedApplicationsQuery(db)]);
    const byBatch = new Map<string, { pending: number; underReview: number }>();
    for (const entry of waiting) {
      const known = byBatch.get(entry.batchId) ?? { pending: 0, underReview: 0 };
      if (entry.status === "pending") known.pending += entry.n;
      else known.underReview += entry.n;
      byBatch.set(entry.batchId, known);
    }
    const now = new Date();
    const items = rows.map((row) => {
      const { pending, underReview } = byBatch.get(row.id) ?? { pending: 0, underReview: 0 };
      return { ...presentBatch(row), phase: batchPhase(row, pending + underReview, now), pending, underReview };
    });
    return c.json(pageOf(items, query, totals[0]?.total ?? 0));
  });

  app.post("/", write, handlers.create);

  app.get("/:id", read, async (c) => {
    const id = c.req.param("id");
    if (!validId(id)) return notFound(c);
    const detail = await loadDetail(c, id);
    if (!detail) return notFound(c);
    c.header("ETag", `"${detail.updatedAt}"`);
    return c.json({ item: detail });
  });

  app.put("/:id", write, handlers.update);
  app.delete("/:id", write, handlers.remove);

  // ---------------------------------------------------------------- publish

  app.post("/:id/publish", write, async (c) => {
    const id = c.req.param("id");
    if (!validId(id)) return fail(c, 404, "not_found", MESSAGES.notFound);
    const detail = await loadDetail(c, id);
    if (!detail) return fail(c, 404, "not_found", MESSAGES.notFound);

    // The legacy preconditions, in the legacy order.
    const refusal = publishRefusal(detail);
    if (refusal) return fail(c, 409, refusal.code, refusal.message, refusal.extra);

    const user = c.get("user");
    const db = drizzle(c.env.DB, { schema });
    const now = new Date();
    // The same rules are in the WHERE, so an applicant moved back to "pending" a moment ago, or a second publish,
    // cannot slip through the check above: the write matches no row and nothing is written, audit row included.
    const [published] = await withAudit(
      db,
      user,
      { action: "batch.publish_results", resourceType: "batch", resourceId: id, fields: ["resultsPublishedAt"], label: detail.name },
      [
        db
          .update(admissionBatches)
          .set({ resultsPublishedAt: now, updatedAt: sql`max(${now.getTime()}, ${admissionBatches.updatedAt} + 1)` })
          .where(
            and(
              eq(admissionBatches.id, id),
              isNull(admissionBatches.resultsPublishedAt),
              sql`exists (select 1 from student_applications where student_applications.batch_id = ${id})`,
              sql`not exists (select 1 from student_applications where student_applications.batch_id = ${id} and student_applications.status in ('pending', 'under_review'))`,
            ),
          )
          .returning(),
      ],
    );
    const row = (published as BatchRow[])[0];
    if (!row) {
      // Lost to a change made in between: say what is true now.
      const now2 = await loadDetail(c, id);
      if (!now2) return fail(c, 404, "not_found", MESSAGES.notFound);
      const again = publishRefusal(now2);
      return again ? fail(c, 409, again.code, again.message, again.extra) : fail(c, 409, "stale", MESSAGES.changedMeanwhile);
    }
    c.header("ETag", `"${row.updatedAt.toISOString()}"`);
    return c.json({ item: { ...detail, ...presentBatch(row), phase: batchPhase({ ...row, hasApplications: true }, 0, now), canPublish: false } });
  });

  // -------------------------------------------------------------- unpublish

  app.post("/:id/unpublish", write, async (c) => {
    const id = c.req.param("id");
    if (!validId(id)) return fail(c, 404, "not_found", MESSAGES.notFound);
    const detail = await loadDetail(c, id);
    if (!detail) return fail(c, 404, "not_found", MESSAGES.notFound);
    // Nothing is published: nothing to cancel, so no write and no audit row (the legacy action wrote one anyway).
    if (!detail.resultsPublishedAt) {
      c.header("ETag", `"${detail.updatedAt}"`);
      return c.json({ item: detail });
    }

    const user = c.get("user");
    const db = drizzle(c.env.DB, { schema });
    const [unpublished] = await withAudit(
      db,
      user,
      { action: "batch.unpublish_results", resourceType: "batch", resourceId: id, fields: ["resultsPublishedAt"], label: detail.name },
      [
        db
          .update(admissionBatches)
          .set({ resultsPublishedAt: null, updatedAt: sql`max(${Date.now()}, ${admissionBatches.updatedAt} + 1)` })
          .where(and(eq(admissionBatches.id, id), isNotNull(admissionBatches.resultsPublishedAt)))
          .returning(),
      ],
    );
    const row = (unpublished as BatchRow[])[0];
    // Cancelled by someone else a moment ago: the batch is as the person wanted it.
    const fresh = row ? await loadDetail(c, id) : detail;
    if (!fresh) return fail(c, 404, "not_found", MESSAGES.notFound);
    c.header("ETag", `"${fresh.updatedAt}"`);
    return c.json({ item: fresh });
  });

  return app;
}

/** Why the results of this batch cannot be published now, in the legacy order of the checks; null when they can. */
export function publishRefusal(detail: Pick<BatchDetail, "resultsPublishedAt" | "counts">): { code: string; message: string; extra: Record<string, unknown> } | null {
  if (detail.resultsPublishedAt) return { code: "already_published", message: MESSAGES.alreadyPublished, extra: {} };
  if (detail.counts.total === 0) return { code: "no_applicants", message: MESSAGES.noApplicants, extra: {} };
  const undecided = detail.counts.pending + detail.counts.under_review;
  if (undecided > 0) return { code: "undecided", message: MESSAGES.undecided(undecided), extra: { undecided } };
  return null;
}

export const batchRoutes = createBatchRoutes();
