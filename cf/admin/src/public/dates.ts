// Public dates are derived from stored instants in Asia/Jakarta (UTC+7, no
// daylight saving), per docs/cloudflare/d1-schema.md. Plain arithmetic instead
// of Intl: it costs no CPU and cannot differ between runtimes. An imported
// date-only article is stored as 00:00 WIB, so it reads back as the same day.

const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const MONTHS_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"] as const;

/** The instant shifted so that the UTC getters read Jakarta wall-clock time. */
function jakarta(ms: number): Date {
  return new Date(ms + JAKARTA_OFFSET_MS);
}

/** "2026-05-21": the Jakarta calendar day of an instant (`dateISO`, `modifiedISO`). */
export function isoDayJakarta(ms: number): string {
  const d = jakarta(ms);
  const y = String(d.getUTCFullYear()).padStart(4, "0");
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** "21 Mei 2026": the Indonesian long date shown on the site (`date`). */
export function longDateJakarta(ms: number): string {
  const d = jakarta(ms);
  return `${d.getUTCDate()} ${MONTHS_ID[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Whole days since 1970-01-01 of the Jakarta calendar day of an instant. */
export function dayNumberJakarta(ms: number): number {
  return Math.floor((ms + JAKARTA_OFFSET_MS) / DAY_MS);
}

/** The instant of 00:00 Jakarta on a day number (see `dayNumberJakarta`). */
export function startOfDayJakarta(dayNumber: number): number {
  return dayNumber * DAY_MS - JAKARTA_OFFSET_MS;
}
