import { getReportsByYear } from "@/lib/reports";
import { LaporanContent } from "./_laporan-content";

// Reads the DB, which is only reachable at runtime (on the VPS), not during
// the CI build. Render per-request instead of prerendering.
export const dynamic = "force-dynamic";

export default async function LaporanPage() {
  const grouped = await getReportsByYear();
  return <LaporanContent grouped={grouped} />;
}
