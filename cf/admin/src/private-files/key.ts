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
