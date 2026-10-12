/** "30 detik", "1 menit", "2 jam": how long to wait, from a Retry-After in seconds. */
export function formatWait(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))} detik`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} menit`;
  return `${Math.ceil(seconds / 3600)} jam`;
}

const DATE_SHORT: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
const DATE_TIME: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };

/** "12 Okt" */
export function formatDayMonth(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", DATE_SHORT);
}

/** "12 Okt 2026, 14.30" */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", DATE_TIME);
}

/** "12 Okt 2026" */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", { dateStyle: "medium" });
}
