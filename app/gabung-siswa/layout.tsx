import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "Daftar Siswa",
  description:
    "Daftarkan diri sebagai siswa Sakola Kembara. Program bimbingan belajar gratis untuk persiapan UTBK dan masuk perguruan tinggi negeri bagi siswa dari keluarga kurang mampu di daerah terpencil.",
  path: "/gabung-siswa",
});

export default function GabungSiswaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
