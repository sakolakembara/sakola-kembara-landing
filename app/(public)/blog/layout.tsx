import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "Blog & Cerita",
  description:
    "Cerita dan inspirasi dari Sakola Kembara — kisah alumni, kegiatan, dan update tentang gerakan pemerataan akses pendidikan tinggi di Indonesia.",
  path: "/blog",
});

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return children;
}
