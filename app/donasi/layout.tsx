import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "Donasi",
  description:
    "Dukung pendidikan setara untuk anak Indonesia. Donasi via QRIS atau transfer bank ke Sakola Kembara. Setiap kontribusi membuka pintu perguruan tinggi bagi siswa dari keluarga kurang mampu.",
  path: "/donasi",
});

export default function DonasiLayout({ children }: { children: React.ReactNode }) {
  return children;
}
