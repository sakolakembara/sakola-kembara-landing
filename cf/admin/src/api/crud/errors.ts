import type { Context } from "hono";

// The one error shape of the admin API (docs/cloudflare/admin-crud.md#5-errors):
//
//   { error: <code>, message?: <Indonesian, ready to show>, fields?: { <name>: <message> }, ...extra }
//
// Handlers RETURN these helpers; none of them builds a body by hand. The
// messages here are for the codes this file owns; the guards' `unauthenticated`
// and `forbidden` carry none (the SPA has its own line for them).

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 428 | 429;

export interface ErrorBody {
  error: string;
  message?: string;
  fields?: Record<string, string>;
  [extra: string]: unknown;
}

/** A refusal with the shape above. Use the named helpers; this is for a code that has none yet. */
export function fail(c: Context, status: ErrorStatus, error: string, message?: string, extra: Record<string, unknown> = {}) {
  const body: ErrorBody = { error, ...(message ? { message } : {}), ...extra };
  return c.json(body, status);
}

export const MESSAGES = {
  invalid: "Periksa kembali isian formulir.",
  invalidJson: "Isi permintaan bukan JSON yang valid.",
  jsonRequired: "Kirim data sebagai application/json.",
  invalidQuery: "Pencarian atau penyaringan tidak dikenal.",
  notFound: "Data tidak ditemukan. Mungkin sudah dihapus.",
  stale: "Data ini sudah diubah orang lain sejak kamu membukanya. Muat ulang untuk melihat versi terbaru.",
  preconditionRequired: "Versi data tidak disertakan. Muat ulang halaman lalu coba lagi.",
  tooLarge: "Isi permintaan terlalu besar.",
  conflict: "Data bentrok dengan data lain yang sudah ada.",
} as const;

/** 400 `invalid`: the body did not pass its schema. `fields` is `{ name: message }` (see `fieldsOf`); `message` replaces the generic line when a rule is about the whole form. */
export function validationError(c: Context, fields: Record<string, string>, message?: string) {
  return fail(c, 400, "invalid", message ?? MESSAGES.invalid, Object.keys(fields).length > 0 ? { fields } : {});
}

/** 400 `invalid_json`: the content type was right and the body was not JSON. */
export function invalidJson(c: Context) {
  return fail(c, 400, "invalid_json", MESSAGES.invalidJson);
}

/** 415 `json_required`: not `application/json`. A cross-site form post cannot send that type without a preflight. */
export function jsonRequired(c: Context) {
  return fail(c, 415, "json_required", MESSAGES.jsonRequired);
}

/** 400 `invalid_query`: an unknown `sort` or filter value. `name` is the parameter (it is a name from the request, so it is only ever echoed as a key, never in the message). */
export function invalidQuery(c: Context, name: string) {
  return fail(c, 400, "invalid_query", MESSAGES.invalidQuery, { param: name.slice(0, 40) });
}

/** 404 `not_found`. */
export function notFound(c: Context) {
  return fail(c, 404, "not_found", MESSAGES.notFound);
}

/** 409 `stale`: `If-Match` does not match, someone saved first. */
export function stale(c: Context) {
  return fail(c, 409, "stale", MESSAGES.stale);
}

/** 409 `in_use`: something still refers to the row. `usedBy` names the menus (Blog, Tim, ...). */
export function inUse(c: Context, usedBy: readonly string[], message?: string) {
  return fail(c, 409, "in_use", message ?? (usedBy.length > 0 ? `Masih dipakai di: ${usedBy.join(", ")}. Lepaskan dulu dari sana.` : "Masih dipakai di tempat lain."), {
    usedBy: [...usedBy],
  });
}

/** 409 `conflict`: a uniqueness rule. `fields` names the field the person must change. */
export function conflict(c: Context, fields: Record<string, string>, message?: string) {
  return fail(c, 409, "conflict", message ?? MESSAGES.conflict, Object.keys(fields).length > 0 ? { fields } : {});
}

/** 413 `too_large`. */
export function tooLarge(c: Context, maxBytes: number) {
  return fail(c, 413, "too_large", MESSAGES.tooLarge, { maxBytes });
}

/** 428 `precondition_required`: a `PUT` without `If-Match`. */
export function preconditionRequired(c: Context) {
  return fail(c, 428, "precondition_required", MESSAGES.preconditionRequired);
}

/** True when `error`, or anything it wraps (Drizzle wraps D1's error in `cause`), says `text`. */
function mentions(error: unknown, text: string): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 5; depth++) {
    if (current instanceof Error && current.message.includes(text)) return true;
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

/** A unique index refused the row. `target` is `table.column` as SQLite words it ("shortlinks.slug"); several columns are "a.x, a.y". */
export function isUniqueViolation(error: unknown, target: string): boolean {
  return mentions(error, `UNIQUE constraint failed: ${target}`);
}

/** A foreign key refused the delete (a `RESTRICT` that has children) or the insert. */
export function isForeignKeyViolation(error: unknown): boolean {
  return mentions(error, "FOREIGN KEY constraint failed");
}
