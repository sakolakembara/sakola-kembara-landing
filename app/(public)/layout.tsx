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
  // the fixed navbar. The class carries breakpoint-specific values (see
  // globals.css) because the announcement strip is much taller on phones.
  return (
    <div
      className={
        announcement ? "nav-clearance-announced" : "nav-clearance"
      }
    >
      <a
        href="#konten-utama"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:px-4 focus:py-2 focus:bg-primary-blue focus:text-white focus:rounded-lg focus:font-semibold focus:shadow-lg"
      >
        Lewat ke konten utama
      </a>
      <Navbar announcement={announcement} />
      <div id="konten-utama">{children}</div>
      <Footer />
    </div>
  );
}
