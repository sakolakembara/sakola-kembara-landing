import { getAllReports } from "@/lib/reports";
import { CACHE_CONTENT, publicJson } from "@/lib/public-api/http";
import { toPublicReport } from "@/lib/public-api/serializers";
import type { ReportsResponse } from "@/lib/public-api/types";

// Runtime-only; see the note in ../team/route.ts.
export const dynamic = "force-dynamic";

export async function GET() {
  // Newest year first, then newest upload: the order /laporan groups by.
  const reports = await getAllReports();
  return publicJson<ReportsResponse>(
    { reports: reports.map(toPublicReport) },
    CACHE_CONTENT,
  );
}
