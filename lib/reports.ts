import "server-only";
import { desc } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { reports, type Report } from "@/lib/db/schema";

export {
  formatBytes,
  REPORT_CATEGORY_LABEL,
  REPORT_CATEGORY_PILL,
  formatAcademicYear,
} from "@/lib/report-types";

// Report reader — used by the public /laporan page + the admin list.
// The actual PDFs live under public/reports/<year>/<category>/<slug>.pdf;
// this module only deals with the row metadata.

async function readAllReports(): Promise<Report[]> {
  return db
    .select()
    .from(reports)
    .orderBy(desc(reports.year), desc(reports.uploadedAt));
}

const getCachedReports = unstable_cache(
  () => readAllReports(),
  ["reports-all"],
  { tags: ["reports"] },
);

// unstable_cache JSON-serializes the value, which turns Date columns into ISO
// strings. Re-hydrate so callers can safely call .toLocaleDateString() etc.
function hydrateReport(row: Report): Report {
  return {
    ...row,
    uploadedAt: new Date(row.uploadedAt),
  };
}

export async function getAllReports(): Promise<Report[]> {
  const rows = await getCachedReports();
  return rows.map(hydrateReport);
}

/**
 * Group reports by year (descending). Preserves the inner sort order from
 * the DB query, so the newest-uploaded report appears first within each year.
 */
export async function getReportsByYear(): Promise<
  { year: string; reports: Report[] }[]
> {
  const all = await getAllReports();
  const byYear = new Map<string, Report[]>();
  for (const r of all) {
    if (!byYear.has(r.year)) byYear.set(r.year, []);
    byYear.get(r.year)!.push(r);
  }
  // Sort descending as strings — works because we require years to be
  // 4-digit ("2025") or "YYYY/YYYY" ("2025/2026"), so lexicographic order
  // matches chronological order.
  return [...byYear.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([year, list]) => ({ year, reports: list }));
}

