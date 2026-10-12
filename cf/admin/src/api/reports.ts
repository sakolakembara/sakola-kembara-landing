import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireArea } from "../auth/guard";
import type { AppEnv } from "../context";
import * as schema from "../db/schema";
import { reportCategory } from "../db/schema";
import { isValidReportYear } from "../reports/rules";
import { crudHandlers, enumFilter, uploadPath, type CrudDeps } from "./crud";
import { asSortKey } from "./sort-expression";

// Laporan (area `konten`): the PDF reports of /laporan. Port of app/(admin)/admin/reports/actions.ts, on the
// admin CRUD convention (docs/cloudflare/admin-crud.md); what is ported, and where it differs from the legacy
// admin, is in docs/cloudflare/admin-konten.md.
//
// The legacy rules that carry over:
//   - a report is created WITH its PDF (required, at most 20 MB: that is the upload API's `report` kind) and the
//     form's metadata: title 3 to 200, description up to 1000, category, and the year (2025 or 2025/2026);
//   - editing changes the METADATA only: "File PDF tidak bisa diganti dari sini. Hapus laporan dan buat baru jika
//     perlu mengganti file.", so the update's schema does not even mention the file;
//   - deleting removes the row and then its file (here: `deleteUploadByPath`, which never removes a file another
//     row still uses and never undoes the delete);
//   - the public page lists them newest year first, then newest upload first, and so does this list by default.
//
// Two schemas, one resource: `crudHandlers` is built twice (create takes the file, update does not) and the five
// routes are assembled by hand from the two, which the doc allows ("the same functions crudRoutes is built from").

const MAX_PDF_BYTES = 20_000_000;

const metadata = {
  title: z.string().trim().min(3, "Judul minimal 3 karakter").max(200, "Judul maksimal 200 karakter"),
  description: z
    .string()
    .trim()
    .max(1000, "Deskripsi maksimal 1000 karakter")
    .nullish()
    .transform((value) => value || null),
  category: z.enum(reportCategory, { error: "Kategori tidak dikenal" }),
  year: z
    .string()
    .trim()
    .refine((value) => isValidReportYear(value), { message: "Format tahun tidak valid. Contoh: 2025 atau 2025/2026" }),
};

const FILE_REQUIRED = "File PDF wajib diupload.";

const createInput = z.object({
  ...metadata,
  // The path of a file already uploaded through POST /api/admin/uploads (kind `report`), and the size that answer gave.
  filePath: z.string({ error: FILE_REQUIRED }).pipe(uploadPath(["report"], FILE_REQUIRED)),
  fileSize: z
    .number({ error: FILE_REQUIRED })
    .int("Ukuran file tidak valid.")
    .min(0, "Ukuran file tidak valid.")
    .max(MAX_PDF_BYTES, "Ukuran file maksimal 20 MB."),
});

const updateInput = z.object(metadata);

type ReportRow = typeof schema.reports.$inferSelect;

/** What the API returns: an explicit field list (no `uploadedBy`), dates as ISO strings. */
function present(row: ReportRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    year: row.year,
    filePath: row.filePath,
    fileSize: row.fileSize,
    uploadedAt: row.uploadedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The public page's order as ONE sort key: the year as text (so "2025/2026" is above "2025" when descending), a
 * space (below "/", so a plain year still sorts under a range that starts with it), then the upload time padded to
 * 15 digits. Descending, it is `year desc, uploaded_at desc`, the order of reportsQuery in src/public/queries.ts.
 */
const byYearThenUpload = asSortKey(sql`${schema.reports.year} || ' ' || printf('%015d', ${schema.reports.uploadedAt})`);

/** `deps` is for tests only (spies for the purge hook and the upload cleanup); production uses `reportRoutes` below. */
export function createReportRoutes(deps?: CrudDeps) {
  const shared = {
    area: "konten",
    table: schema.reports,
    version: schema.reports.updatedAt,
    // The title is the public name of the document: a non-personal label for Aktivitas.
    audit: { name: "report", type: "report", label: (row: ReportRow) => row.title },
    present,
    list: {
      search: [schema.reports.title, schema.reports.description, schema.reports.year],
      filters: { category: enumFilter(schema.reports.category, reportCategory) },
      sorts: {
        year: byYearThenUpload,
        title: schema.reports.title,
        category: schema.reports.category,
        uploadedAt: schema.reports.uploadedAt,
        fileSize: schema.reports.fileSize,
      },
      defaultSort: "-year",
    },
    // /laporan.
    purge: { area: "reports" },
    // The PDF goes with the row; an edit never changes it.
    uploads: (row: ReportRow) => [row.filePath],
  } as const;

  const creating = crudHandlers(
    {
      ...shared,
      schema: createInput,
      toRow: (input, { user }) => ({
        title: input.title,
        description: input.description,
        category: input.category,
        year: input.year,
        filePath: input.filePath,
        fileSize: input.fileSize,
        uploadedBy: user.id,
      }),
    },
    deps,
  );
  const editing = crudHandlers(
    {
      ...shared,
      schema: updateInput,
      toRow: (input) => ({ title: input.title, description: input.description, category: input.category, year: input.year }),
    },
    deps,
  );

  const app = new Hono<AppEnv>();
  app.get("/", requireArea("konten", "read"), creating.list);
  app.post("/", requireArea("konten", "write"), creating.create);
  app.get("/:id", requireArea("konten", "read"), creating.get);
  app.put("/:id", requireArea("konten", "write"), editing.update);
  app.delete("/:id", requireArea("konten", "write"), creating.remove);
  return app;
}

export const reportRoutes = createReportRoutes();
