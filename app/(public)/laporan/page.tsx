import { getReportsByYear } from "@/lib/reports";
import { LaporanContent } from "./_laporan-content";

export default async function LaporanPage() {
  const grouped = await getReportsByYear();
  return <LaporanContent grouped={grouped} />;
}
