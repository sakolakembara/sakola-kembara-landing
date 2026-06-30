import type { CSSProperties } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { getCurrentAnnouncement } from "@/lib/announcements";

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const announcement = await getCurrentAnnouncement();
  // Hero sections read --hero-top for their top padding so they always clear
  // the fixed navbar regardless of whether the announcement strip is present.
  const heroTop = announcement ? "11rem" : "8rem";
  const style = { "--hero-top": heroTop } as CSSProperties;
  return (
    <div style={style}>
      <Navbar announcement={announcement} />
      {children}
      <Footer />
    </div>
  );
}
