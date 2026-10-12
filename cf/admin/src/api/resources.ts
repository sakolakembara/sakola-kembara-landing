import { asc, count, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";
import { requireArea } from "../auth/guard";
import type { AppEnv } from "../context";
import * as schema from "../db/schema";
import { resourceCategory, resourceContentType, siteResources } from "../db/schema";
import { crudHandlers, enumFilter, isAllowedFilePath, pageOf, parseListQuery, type CrudDeps } from "./crud";

// Pusat Dokumen (area `pendaftaran`; the legacy menu was "Berkas Pendaftaran"): the files, links and copy-able
// texts of the public page /gabung-siswa/docs. A port of app/(admin)/admin/resources/*.
//
//   GET    /api/admin/resources        list, in the page's own order: category, then order, then creation
//   POST   /api/admin/resources        create
//   GET    /api/admin/resources/:id    one
//   PUT    /api/admin/resources/:id    edit (If-Match)
//   DELETE /api/admin/resources/:id    delete
//
// A row is exactly one of three shapes, chosen by `contentType` (the table's CHECK enforces it, this schema
// makes the form say so first): a `file` (an upload of kind `resource`, or a legacy static path), a `url` (a link)
// or a `text` (a snippet with the copy button on the public page). Every change tells the public side
// (`purge: resources`), and a file that is replaced, dropped by switching the type, or deleted with its row is
// removed from R2 after the save (`uploads`), never while another row still uses it.

/** The legacy limit of a resource file, and what `UploadField` checks before sending (src/uploads/kinds.ts says the same). */
export const MAX_FILE_BYTES = 25_000_000;

/** The kinds of upload a row may point at: the Pusat Dokumen's own, and its sibling (same rules, same folder family). */
const FILE_KINDS = ["resource", "registration-document"] as const;

const optionalText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .nullish()
    .transform((value) => value || null);

/** A link a visitor will click: http or https, nothing else (a `javascript:` URL would run in the public page). */
function isWebUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** The form of a resource. The messages are the legacy server action's; the ones it left to zod's English are written here. */
export const resourceInput = z
  .object({
    title: z.string().trim().min(2, "Judul minimal 2 karakter").max(200, "Judul maksimal 200 karakter"),
    description: optionalText(1000, "Deskripsi maksimal 1000 karakter"),
    category: z.enum(resourceCategory, { error: "Kategori tidak dikenal" }),
    displayOrder: z.coerce
      .number({ error: "Wajib diisi" })
      .int("Harus bilangan bulat")
      .min(0, "Tidak boleh negatif")
      .max(9999, "Maksimal 9999"),
    contentType: z.enum(resourceContentType, { error: "Tipe konten tidak dikenal" }),
    /** The path an upload answered with (`/uploads/resource/...`), or a legacy `/resources/...` path. Only for `file`. */
    filePath: optionalText(500, "Berkas tidak valid. Unggah ulang berkasnya."),
    /** The size the upload answered with. Only for `file`. */
    fileSize: z
      .number({ error: "Ukuran file tidak valid" })
      .int("Ukuran file tidak valid")
      .min(0, "Ukuran file tidak valid")
      .max(MAX_FILE_BYTES, "Ukuran file maksimal 25 MB.")
      .nullish()
      .transform((value) => value ?? null),
    externalUrl: optionalText(500, "URL maksimal 500 karakter"),
    bodyText: optionalText(10_000, "Teks maksimal 10.000 karakter"),
    notes: optionalText(500, "Catatan maksimal 500 karakter"),
  })
  .superRefine((data, ctx) => {
    if (data.contentType === "file") {
      if (!data.filePath || data.fileSize === null) {
        ctx.addIssue({ code: "custom", message: "File wajib diupload.", path: ["filePath"] });
      } else if (!isAllowedFilePath(data.filePath, FILE_KINDS)) {
        ctx.addIssue({ code: "custom", message: "Berkas tidak valid. Unggah ulang berkasnya.", path: ["filePath"] });
      }
    }
    if (data.contentType === "url") {
      if (!data.externalUrl) ctx.addIssue({ code: "custom", message: "URL wajib diisi untuk tipe Link Eksternal.", path: ["externalUrl"] });
      else if (!isWebUrl(data.externalUrl)) ctx.addIssue({ code: "custom", message: "Format URL tidak valid", path: ["externalUrl"] });
    }
    if (data.contentType === "text" && !data.bodyText) {
      ctx.addIssue({ code: "custom", message: "Isi teks yang bisa disalin.", path: ["bodyText"] });
    }
  });

type ResourceRow = typeof siteResources.$inferSelect;

/** What the API returns: an explicit field list (no `updatedBy`), dates as ISO strings. `notes` is admin-only and never reaches the public API. */
export function presentResource(row: ResourceRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    displayOrder: row.displayOrder,
    contentType: row.contentType,
    filePath: row.filePath,
    fileSize: row.fileSize,
    externalUrl: row.externalUrl,
    bodyText: row.bodyText,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** `case category when 'panduan' then 0 ...`: the public page's order of the categories, not the alphabet (the enum is in page order). */
function categoryRank() {
  const whens = resourceCategory.map((value, index) => `when '${value}' then ${index}`).join(" ");
  return sql`case ${siteResources.category} ${sql.raw(whens)} else ${sql.raw(String(resourceCategory.length))} end`;
}

/** `deps` is for tests only (spies for the purge and the upload cleanup); production uses `resourceRoutes` below. */
export function createResourceRoutes(deps?: CrudDeps) {
  const spec = {
    // A contains-search over the title and the description: the table is a few dozen rows.
    search: [siteResources.title, siteResources.description],
    filters: {
      category: enumFilter(siteResources.category, resourceCategory),
      contentType: enumFilter(siteResources.contentType, resourceContentType),
    },
    // `category` is the page's order (below); the others are plain.
    sorts: { category: siteResources.category, title: siteResources.title, displayOrder: siteResources.displayOrder, updatedAt: siteResources.updatedAt },
    defaultSort: "category",
    // The whole catalog fits one page; the list is grouped by category on screen.
    defaultPageSize: 100,
    maxPageSize: 100,
  } as const;

  const handlers = crudHandlers(
    {
      area: "pendaftaran",
      table: siteResources,
      version: siteResources.updatedAt,
      // The title of a document ("Panduan Pendaftaran") is not personal data.
      audit: { name: "resource", type: "site_resource", label: (row) => row.title },
      schema: resourceInput,
      toRow: (input, { user }) => ({
        title: input.title,
        description: input.description,
        category: input.category,
        displayOrder: input.displayOrder,
        contentType: input.contentType,
        // Exactly one shape per row: what belongs to another type is dropped (the legacy action did the same).
        filePath: input.contentType === "file" ? input.filePath : null,
        fileSize: input.contentType === "file" ? input.fileSize : null,
        externalUrl: input.contentType === "url" ? input.externalUrl : null,
        bodyText: input.contentType === "text" ? input.bodyText : null,
        notes: input.notes,
        updatedBy: user.id,
      }),
      present: presentResource,
      list: spec,
      // The public /gabung-siswa/docs page.
      purge: { area: "resources" },
      uploads: (row) => [row.filePath],
      maxBodyBytes: 64 * 1024,
    },
    deps,
  );

  const app = new Hono<AppEnv>();
  const read = requireArea("pendaftaran", "read");
  const write = requireArea("pendaftaran", "write");

  // The list is the public page's own order (category, the admin's manual order, creation), unless a sort is asked for.
  app.get("/", read, async (c) => {
    const parsed = parseListQuery(c, { ...spec, id: siteResources.id });
    if (!parsed.ok) return parsed.response;
    const { query } = parsed;
    const order = query.sort === "category" ? [categoryRank(), asc(siteResources.displayOrder), asc(siteResources.createdAt), asc(siteResources.id)] : query.order;
    const db = drizzle(c.env.DB, { schema });
    const [rows, totals] = await db.batch([
      db.select().from(siteResources).where(query.where).orderBy(...order).limit(query.pageSize).offset(query.offset),
      db.select({ total: count() }).from(siteResources).where(query.where),
    ]);
    return c.json(pageOf(rows.map(presentResource), query, totals[0]?.total ?? 0));
  });

  app.post("/", write, handlers.create);
  app.get("/:id", read, handlers.get);
  app.put("/:id", write, handlers.update);
  app.delete("/:id", write, handlers.remove);
  return app;
}

export const resourceRoutes = createResourceRoutes();
