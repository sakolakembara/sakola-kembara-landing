import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "Kontak",
  description:
    "Hubungi tim Sakola Kembara untuk pertanyaan, kerjasama, atau peluang relawan. Berbasis di Bandung, melayani siswa di seluruh Indonesia.",
  path: "/kontak",
});

export default function KontakLayout({ children }: { children: React.ReactNode }) {
  return children;
}
