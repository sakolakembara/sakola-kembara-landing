import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { getCurrentAnnouncement } from "@/lib/announcements";

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const announcement = await getCurrentAnnouncement();
  return (
    <>
      <Navbar announcement={announcement} />
      {children}
      <Footer />
    </>
  );
}
