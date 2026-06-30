import "server-only";
import { desc } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { reports, type Report } from "@/lib/db/schema";

export {
  formatBytes,
  REPORT_CATEGORY_LABEL,
  REPORT_CATEGORY_PILL,
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

export async function getAllReports(): Promise<Report[]> {
  return getCachedReports();
}

/**
 * Group reports by year (descending). Preserves the inner sort order from
 * the DB query, so the newest-uploaded report appears first within each year.
 */
export async function getReportsByYear(): Promise<
  { year: number; reports: Report[] }[]
> {
  const all = await getCachedReports();
  const byYear = new Map<number, Report[]>();
  for (const r of all) {
    if (!byYear.has(r.year)) byYear.set(r.year, []);
    byYear.get(r.year)!.push(r);
  }
  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, list]) => ({ year, reports: list }));
}

