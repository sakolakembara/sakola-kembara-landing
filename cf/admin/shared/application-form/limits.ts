// The size limits of an application and its files (docs/cloudflare/portal-architecture.md, sections 8.3 and 13,
// open decision 8; docs/cloudflare/portal-api.md, section 11). One constant each, so a number that Dzul changes
// later is changed here and nowhere else: the Worker, the portal SPA's file field and the admin's detail page all
// import this file. No dependency, no framework.
//
// Bytes are decimal (10 MB = 10,000,000), like the admin's upload kinds (src/uploads/kinds.ts).
//
// The file limits are also written into the CHECK of `application_files.size` (migration 0012). Changing
// MAX_FILE_BYTES therefore needs a new migration, and `pnpm db:drift` fails until there is one: that is the
// intended reminder, not a bug.

/** The largest single file, in bytes. A phone photo is 2 to 6 MB; the largest legitimate file is a PDF of three months of bills. */
export const MAX_FILE_BYTES = 10_000_000;

/** Live (not deleted) files of one application, all slots together. The sixteen slots hold at most 35. */
export const MAX_FILES_PER_APPLICATION = 40;

/** Live bytes of one application. */
export const MAX_BYTES_PER_APPLICATION = 100_000_000;

/** A JSON request body of the student API, in bytes (413 `body_too_large` above it). */
export const JSON_BODY_MAX_BYTES = 16 * 1024;

/** `PUT .../steps/:step` takes more: an interview of six 2,000-character answers can pass 16 KiB in multi-byte text. */
export const STEP_BODY_MAX_BYTES = 32 * 1024;

/** `application_drafts.form_data` (all seven buckets together), in characters: the CHECK of the column. */
export const DRAFT_FORM_DATA_MAX_LENGTH = 98_304;

/** The browser re-encodes an image to JPEG before it is sent (a service to the data plan and the storage budget; it also drops EXIF and GPS data). Not enforceable on the server. */
export const IMAGE_MAX_LONG_SIDE_PX = 2_000;
export const IMAGE_JPEG_QUALITY = 0.85;
