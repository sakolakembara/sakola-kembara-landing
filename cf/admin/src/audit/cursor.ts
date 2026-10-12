// The cursor of the Aktivitas list (docs/cloudflare/admin-sistem.md#cursor-design) and the day filters.
//
// The list is ordered `created_at desc, id desc` and a page ends at the last row it showed. The cursor is that
// row's position, `(created_at, id)`, and the next page is "everything strictly before it" in the same order:
//
//   where (created_at, id) < (:createdAt, :id) order by created_at desc, id desc limit :n
//
// Nothing is counted and no row is skipped, so the cost of a page does not grow with the table, and a row
// written meanwhile (always newer) can neither shift a page nor repeat one. Two rows with the same
// millisecond are told apart by `id`, which is why `id` is part of the order and of the cursor.
//
// The cursor is opaque to the client and NOT a secret: it holds a timestamp and a row id the caller could
// already read. It is checked strictly anyway, so a made-up one is a `400 invalid_query` and never reaches SQL
// as anything but two bound values.

export interface Cursor {
  /** Epoch milliseconds, the row's `created_at`. */
  createdAt: number;
  /** The row's `id`. */
  id: string;
}

export const MAX_CURSOR_LENGTH = 200;
const MAX_ID_LENGTH = 64;
/** The largest instant a JavaScript Date can hold. */
const MAX_INSTANT = 8.64e15;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function encodeCursor(cursor: Cursor): string {
  return toBase64Url(encoder.encode(JSON.stringify([cursor.createdAt, cursor.id])));
}

/** The position inside `raw`, or null when it is not a cursor this API made (wrong length, characters, shape or values). */
export function decodeCursor(raw: string): Cursor | null {
  if (raw.length === 0 || raw.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const value: unknown = JSON.parse(decoder.decode(fromBase64Url(raw)));
    if (!Array.isArray(value) || value.length !== 2) return null;
    const [createdAt, id] = value as [unknown, unknown];
    if (typeof createdAt !== "number" || !Number.isSafeInteger(createdAt) || createdAt < 0 || createdAt > MAX_INSTANT) return null;
    if (typeof id !== "string" || id.length === 0 || id.length > MAX_ID_LENGTH) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ day filters

/**
 * `from` and `to` are calendar days, `YYYY-MM-DD`, and mean the whole day in Jakarta time (UTC+7, which has no
 * daylight saving): `from` from 00:00:00.000, `to` until 23:59:59.999. The legacy page took the server's own
 * clock, which was never written down; every admin of this school reads the page in WIB, and the Worker runs
 * in UTC, so the offset is stated here instead of left to chance.
 */
export const DAY_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The first (`end` false) or last (`end` true) instant of that day in WIB, or null when it is not a real date from 2000 to 2100. */
export function dayBound(value: string, end: boolean): Date | null {
  const match = DAY.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 2000 || year > 2100) return null;
  const start = Date.UTC(year, month - 1, day);
  const check = new Date(start);
  // 2026-02-30 rolls over to March: not a date.
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return new Date(start - DAY_OFFSET_MS + (end ? 24 * 60 * 60 * 1000 - 1 : 0));
}
