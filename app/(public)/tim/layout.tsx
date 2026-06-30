import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "Tim Kami",
  description:
    "Pahlawan di balik Sakola Kembara — pengurus dan relawan dari berbagai universitas terbaik Indonesia yang berkomitmen membuka akses pendidikan tinggi bagi siswa kurang mampu.",
  path: "/tim",
});

export default function TimLayout({ children }: { children: React.ReactNode }) {
  return children;
}
