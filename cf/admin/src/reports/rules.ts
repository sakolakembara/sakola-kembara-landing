// The year of a report. Port of isValidReportYear in the legacy lib/report-types.ts.
//
// Reports are sorted by `year` as TEXT, newest first, which is chronological only because the year is always
// four digits ("2025") or two years joined by a slash ("2025/2026"). The table's CHECK (reports_year_check)
// holds that shape; this adds the legacy bounds and the "second year is the next one" rule on top.

/** The earliest year the legacy form accepted. */
export const FIRST_REPORT_YEAR = 2018;

/** How far past the current year a report may be dated (a report for next year's cohort). */
export const YEARS_AHEAD = 2;

/**
 * Either a single year ("2025") or an Indonesian academic year ("2025/2026"). Rejects anything else, a year
 * before 2018 or more than two years ahead, and a range whose second year is not exactly one more than the first
 * (so "2025/2027" fails). `now` is a parameter so the bound is testable; production passes nothing.
 */
export function isValidReportYear(input: string, now: Date = new Date()): boolean {
  const trimmed = input.trim();
  const latest = now.getUTCFullYear() + YEARS_AHEAD;
  if (/^\d{4}$/.test(trimmed)) {
    const year = Number(trimmed);
    return year >= FIRST_REPORT_YEAR && year <= latest;
  }
  const range = trimmed.match(/^(\d{4})\/(\d{4})$/);
  if (!range) return false;
  const start = Number(range[1]);
  const end = Number(range[2]);
  if (start < FIRST_REPORT_YEAR || start > latest) return false;
  return end === start + 1;
}
