// The R2 object key of an applicant's file, and the shapes of the ids that reach it.
//
//   key   applications/<batch year>/<application id>/<file id>.<ext>
//
// Nothing in a key is chosen by the client or says anything about a person: the year comes from the batch row, both ids
// are UUIDs made by this Worker (the application's id is the draft's, and stays the same after the submit), and the
// extension comes from the type found in the BYTES (src/uploads/sniff.ts), never from a file name. No client file name
// is stored or logged anywhere in this folder. docs/cloudflare/portal-architecture.md, 8.1.

import { FILE_TYPES, type FileType } from "../uploads/sniff";

/** The types an applicant's file can have: `FileType` of the sniffer without GIF (no slot takes one). */
export type StoredFileType = Exclude<FileType, "gif">;

/** The sniffer's table for the four stored types: the content type (what `application_files.content_type` holds) and the extension. */
export const STORED_TYPES = {
  png: FILE_TYPES.png,
  jpeg: FILE_TYPES.jpeg,
  webp: FILE_TYPES.webp,
  pdf: FILE_TYPES.pdf,
} as const satisfies Record<StoredFileType, (typeof FILE_TYPES)[FileType]>;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_PATTERN = new RegExp(`^${UUID}$`);

/** A UUID as `crypto.randomUUID()` writes it. Anything else in a path or a query is not an id of ours, and is a 404. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** The only shape `buildKey` can produce. Anything else is not ours: never looked up, never deleted. */
export const KEY_PATTERN = new RegExp(`^applications/\\d{4}/${UUID}/${UUID}\\.(png|jpg|webp|pdf)$`);

export interface KeyParts {
  /** `admission_batches.year`. */
  year: number;
  applicationId: string;
  fileId: string;
  type: StoredFileType;
}

export function buildKey({ year, applicationId, fileId, type }: KeyParts): string {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) throw new Error("buildKey: not a year");
  if (!isUuid(applicationId) || !isUuid(fileId)) throw new Error("buildKey: not an id");
  return `applications/${year}/${applicationId}/${fileId}.${STORED_TYPES[type].ext}`;
}

/**
 * THE key of a file row, the one implementation (the student's routes, the admin's, the cleanup and the application API's
 * removal of the `dtks` files, src/portal/rules.ts, all use this): from the batch's year, the two ids and the stored
 * content type of the row. Null for anything it could not build a safe key from (a content type the table does not allow,
 * an id that is not a UUID, a year that is not four digits): never an exception, never a key with a part of a person in it.
 */
export function applicationFileKey(file: { year: number; applicationId: string; fileId: string; contentType: string }): string | null {
  const type = typeOfContentType(file.contentType);
  if (!type || !isUuid(file.applicationId) || !isUuid(file.fileId) || !Number.isInteger(file.year) || file.year < 1000 || file.year > 9999) return null;
  return buildKey({ year: file.year, applicationId: file.applicationId, fileId: file.fileId, type });
}

/** The stored type of a `content_type` column value, or null for anything the table does not allow. */
export function typeOfContentType(contentType: string): StoredFileType | null {
  for (const type of Object.keys(STORED_TYPES) as StoredFileType[]) if (STORED_TYPES[type].contentType === contentType) return type;
  return null;
}

/** The extension of a stored content type (`pdf`, `jpg`, ...); `bin` for one the table does not allow, which no row can hold. */
export function extensionOf(contentType: string): string {
  const type = typeOfContentType(contentType);
  return type ? STORED_TYPES[type].ext : "bin";
}

/** Whether a content type is shown inline (an image) or only offered as a download (a PDF). */
export function isInlineContentType(contentType: string): boolean {
  return contentType.startsWith("image/");
}
