// Client-safe report display helpers. Constants + pure functions only; the
// fs/db reader stays in lib/reports.ts (server-only) so importing these from
// a "use client" component doesn't drag drizzle into the browser bundle.

export const REPORT_CATEGORY_LABEL = {
  yearly: "Laporan Tahunan",
  financial: "Laporan Keuangan",
  impact: "Laporan Dampak",
  donation: "Laporan Donasi",
} as const;

export const REPORT_CATEGORY_PILL = {
  yearly: "bg-blue-50 text-blue-700 border-blue-200",
  financial: "bg-emerald-50 text-emerald-700 border-emerald-200",
  impact: "bg-purple-50 text-purple-700 border-purple-200",
  donation: "bg-amber-50 text-amber-700 border-amber-200",
} as const;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Accepts either a single civic year ("2025") or an Indonesian academic year
 * ("2025/2026"). Rejects malformed input; also enforces that the second year
 * in a range is exactly one more than the first (so "2025/2027" fails).
 */
export function isValidReportYear(input: string): boolean {
  const trimmed = input.trim();
  if (/^\d{4}$/.test(trimmed)) {
    const y = Number(trimmed);
    return y >= 2018 && y <= new Date().getUTCFullYear() + 2;
  }
  const range = trimmed.match(/^(\d{4})\/(\d{4})$/);
  if (!range) return false;
  const start = Number(range[1]);
  const end = Number(range[2]);
  if (start < 2018 || start > new Date().getUTCFullYear() + 2) return false;
  return end === start + 1;
}

/** Prefix an academic-year string with "Tahun Ajaran"; single year with "Tahun". */
export function formatAcademicYear(year: string): string {
  return year.includes("/") ? `Tahun Ajaran ${year}` : `Tahun ${year}`;
}
