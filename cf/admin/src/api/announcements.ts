import { z } from "zod";
import * as schema from "../db/schema";
import { announcementSeverity } from "../db/schema";
import { booleanFilter, crudRoutes, enumFilter, type CrudDeps } from "./crud";

// Pengumuman (area `komunikasi`), the reference implementation of the admin CRUD
// convention (docs/cloudflare/admin-crud.md): five routes under
// /api/admin/announcements built by `crudRoutes`, with the form's rules below.
//
// Port of app/(admin)/admin/announcements/actions.ts: same fields and the same
// messages; the legacy form posts "on" for the checkbox and strings for dates,
// this JSON API takes a boolean and ISO or datetime-local strings.
//
// OWNERSHIP: this file converts what existed. It belongs to the Komunikasi
// worker, who finishes it (the "one current announcement" rule, publish
// windows against now, the CTA URL rules): see section 19 of the doc.

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

/** `deps` is for tests only (a spy for the purge hook); production uses `announcementRoutes` below. */
export function createAnnouncementRoutes(deps?: CrudDeps) {
  return crudRoutes(
    {
      area: "komunikasi",
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
      list: {
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
      },
      // The strip on every public page.
      purge: { area: "announcement" },
    },
    deps,
  );
}

export const announcementRoutes = createAnnouncementRoutes();
