// The list of an application's live files, as the admin's Pendaftar detail shows it
// (docs/cloudflare/portal-api.md, 12.1): metadata only, never a key, a checksum or anything a client named.
// An unexecuted Drizzle query, so the route can put it in the same `db.batch` round trip as the application itself
// and the plan tests can explain it: it is a seek on `application_files_application_slot_idx`, at most 35 rows.

import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/audit";
import { applicationFiles } from "../db/schema";

export const applicationFilesQuery = (db: Db, applicationId: string) =>
  db
    .select({
      id: applicationFiles.id,
      slot: applicationFiles.slot,
      contentType: applicationFiles.contentType,
      size: applicationFiles.size,
      width: applicationFiles.width,
      height: applicationFiles.height,
      createdAt: applicationFiles.createdAt,
    })
    .from(applicationFiles)
    .where(and(eq(applicationFiles.applicationId, applicationId), isNull(applicationFiles.deletedAt)))
    // Oldest first within a slot; the SPA groups by slot in the order of the slot table.
    .orderBy(asc(applicationFiles.slot), asc(applicationFiles.createdAt), asc(applicationFiles.id));

type FileRow = Awaited<ReturnType<typeof applicationFilesQuery>>[number];

/** A file as the API lists it: `{ id, slot, contentType, size, width, height, uploadedAt }`. */
export function presentListedFile(row: FileRow) {
  return {
    id: row.id,
    slot: row.slot,
    contentType: row.contentType,
    size: row.size,
    width: row.width,
    height: row.height,
    uploadedAt: row.createdAt.toISOString(),
  };
}
