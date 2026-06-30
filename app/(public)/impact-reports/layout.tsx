import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "Impact & Reports",
  description:
    "Laporan tahunan, keuangan, dampak, dan donasi Sakola Kembara. Komitmen kami untuk transparansi dan akuntabilitas kepada donor, mitra, dan publik.",
  path: "/impact-reports",
});

export default function ImpactReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
