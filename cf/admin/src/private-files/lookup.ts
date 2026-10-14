// Finding the file a reader asks for, and proving the reader may have it, in ONE statement each. A file that is not the
// reader's, is deleted, or does not exist is the same answer to the caller (null): the routes turn it into a 404 and
// never a 403, so nobody learns whether an id belongs to somebody else.

import { isSlotId, type SlotId } from "../../shared/application-form/slots";
import { isUuid, typeOfContentType } from "./key";
import { keyOfFile } from "./remove";

export interface FoundFile {
  id: string;
  slot: SlotId;
  contentType: string;
  size: number;
  applicationId: string;
  /** The object's key, built from the batch year, the application and the file: never from anything a client sent. */
  key: string;
}

interface Row {
  id: string;
  slot: string;
  content_type: string;
  size: number;
  application_id: string;
  year: number | null;
}

function found(row: Row | null): FoundFile | null {
  if (!row || row.year === null || !isSlotId(row.slot) || !typeOfContentType(row.content_type)) return null;
  const key = keyOfFile(row.year, row.application_id, { id: row.id, contentType: row.content_type });
  return key ? { id: row.id, slot: row.slot, contentType: row.content_type, size: row.size, applicationId: row.application_id, key } : null;
}

// The file's application is the student's own draft or their own submitted application, in any batch (a student reads
// what they uploaded after the batch closed, and after the submit). The two joins are by primary key.
export const OWN_FILE_SQL = `SELECT f.id, f.slot, f.content_type, f.size, f.application_id, COALESCE(db.year, ab.year) AS year
FROM application_files f
LEFT JOIN application_drafts d ON d.id = f.application_id AND d.user_id = ?1
LEFT JOIN admission_batches db ON db.id = d.batch_id
LEFT JOIN student_applications a ON a.id = f.application_id AND a.user_id = ?1
LEFT JOIN admission_batches ab ON ab.id = a.batch_id
WHERE f.id = ?2 AND f.deleted_at IS NULL AND (d.id IS NOT NULL OR a.id IS NOT NULL)`;

/** A live file of this student's own draft or application, or null. */
export async function findOwnFile(db: D1Database, userId: string, fileId: string): Promise<FoundFile | null> {
  if (!isUuid(fileId)) return null;
  return found(await db.prepare(OWN_FILE_SQL).bind(userId, fileId).first<Row>());
}

// An admin opens a file of a SUBMITTED application only: a draft is not in `student_applications`, so a file of
// somebody's draft is never reachable from the admin, whatever ids are sent.
export const APPLICATION_FILE_SQL = `SELECT f.id, f.slot, f.content_type, f.size, f.application_id, b.year AS year
FROM application_files f
JOIN student_applications a ON a.id = f.application_id
JOIN admission_batches b ON b.id = a.batch_id
WHERE f.id = ?1 AND f.application_id = ?2 AND f.deleted_at IS NULL`;

/** A live file of submitted application `applicationId`, or null (any other kind of mismatch is null too). */
export async function findApplicationFile(db: D1Database, applicationId: string, fileId: string): Promise<FoundFile | null> {
  if (!isUuid(fileId) || !isUuid(applicationId)) return null;
  return found(await db.prepare(APPLICATION_FILE_SQL).bind(fileId, applicationId).first<Row>());
}
