// Reports for /laporan: the payload of GET ${CONTENT_API_URL}/api/public/reports (shape and
// order: docs/cloudflare/content-api.md), the display helpers ported from the root
// lib/report-types.ts, and the grouping of the root lib/reports.ts (getReportsByYear).

import { fileHref, isRecord, listOf, loadContent, str, type ContentCallOptions, type ContentSource } from './content-api';
import type { TagTone } from './ui';

export const REPORT_CATEGORIES = ['yearly', 'financial', 'impact', 'donation'] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const REPORT_CATEGORY_LABEL: Record<ReportCategory, string> = {
  yearly: 'Laporan Tahunan',
  financial: 'Laporan Keuangan',
  impact: 'Laporan Dampak',
  donation: 'Laporan Donasi',
};

export const REPORT_CATEGORY_TONE: Record<ReportCategory, TagTone> = {
  yearly: 'blue',
  financial: 'green',
  impact: 'purple',
  donation: 'amber',
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Prefix an academic-year string with "Tahun Ajaran"; a single year with "Tahun". */
export function formatAcademicYear(year: string): string {
  return year.includes('/') ? `Tahun Ajaran ${year}` : `Tahun ${year}`;
}

/** One report as the API returns it (no uploader, no upload time: the site shows neither). */
export interface Report {
  id: string;
  title: string;
  description: string | null;
  category: ReportCategory;
  /** "2025" or "2025/2026". */
  year: string;
  /** Root-relative path (or an absolute http(s) URL), used as the link target as it is. */
  filePath: string;
  /** Bytes. */
  fileSize: number;
}

export const REPORTS_PATH = '/api/public/reports';

/**
 * Turn an API payload into reports. Tolerant by design: a malformed entry (no id, title, known
 * category, year, usable file path or size) is dropped rather than failing the page, because
 * this input crosses a network. Null when the payload is not a list at all (an API failure).
 */
export function parseReportsPayload(payload: unknown): Report[] | null {
  const list = listOf(payload, 'reports');
  if (!list) return null;

  const reports: Report[] = [];
  for (const raw of list) {
    if (!isRecord(raw)) continue;
    const id = str(raw.id);
    const title = str(raw.title);
    const year = str(raw.year);
    const filePath = fileHref(raw.filePath);
    const category = (REPORT_CATEGORIES as readonly string[]).includes(String(raw.category))
      ? (raw.category as ReportCategory)
      : null;
    const size = raw.fileSize;
    if (!id || !title || !year || !filePath || !category) continue;
    if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) continue;
    reports.push({ id, title, description: str(raw.description), category, year, filePath, fileSize: size });
  }
  return reports;
}

/**
 * Group reports by year, newest year first. The order inside a year is the payload's (newest
 * upload first, as the API sorts it). Years are compared as strings, which is chronological
 * for "YYYY" and "YYYY/YYYY" (same rule and same comparison as the root getReportsByYear).
 */
export function groupReportsByYear(reports: Report[]): { year: string; reports: Report[] }[] {
  const byYear = new Map<string, Report[]>();
  for (const r of reports) {
    if (!byYear.has(r.year)) byYear.set(r.year, []);
    byYear.get(r.year)!.push(r);
  }
  return [...byYear.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([year, list]) => ({ year, reports: list }));
}

export interface ReportsResult {
  /** Null: the API is down and nothing is cached (the page shows its degraded state). */
  reports: Report[] | null;
  source: ContentSource;
}

export async function loadReports(opts: ContentCallOptions<Report[]>): Promise<ReportsResult> {
  const { data, source } = await loadContent<Report[]>({ ...opts, path: REPORTS_PATH, parse: parseReportsPayload });
  return { reports: data, source };
}
