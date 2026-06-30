import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ALLOWED_DOMAIN, auth } from "@/auth";
import { Sidebar } from "./_sidebar";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s | Admin Sakola Kembara" },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Defense in depth: middleware already gates this, but a server-side
  // re-check guarantees nothing renders if a route is misconfigured.
  const session = await auth();
  if (!session?.user?.email?.endsWith(`@${ALLOWED_DOMAIN}`)) {
    redirect("/login");
  }

  return (
    // Column on mobile (top bar above main), row on desktop (sidebar left of
    // main). The sidebar component positions itself fixed on mobile so it
    // doesn't contribute to the column height when the drawer is closed.
    <div className="h-dvh flex flex-col md:flex-row bg-gray-50 overflow-hidden">
      <Sidebar email={session.user.email!} />
      {/* main is the scroll container. Padding is delegated to each page so
          editor pages can have a sticky header that truly pins to top: 0. */}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
