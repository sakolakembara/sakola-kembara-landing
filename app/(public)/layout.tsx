import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Hero sections read --hero-top for their top padding so they clear the fixed
  // navbar (values live in globals.css). The announcement strip is fetched
  // client-side (DB is server-only), so we default to the no-strip clearance
  // and Navbar flags <html data-announced> if a strip loads.
  return (
    <div className="nav-clearance">
      <a
        href="#konten-utama"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:px-4 focus:py-2 focus:bg-primary-blue focus:text-white focus:rounded-lg focus:font-semibold focus:shadow-lg"
      >
        Lewat ke konten utama
      </a>
      <Navbar />
      <div id="konten-utama">{children}</div>
      <Footer />
    </div>
  );
}
