import type { Metadata } from "next";
import { requireStudent } from "@/lib/auth-helpers";
import { PortalNav } from "./_nav";

export const metadata: Metadata = {
  title: { default: "Portal Siswa", template: "%s | Portal Siswa" },
  robots: { index: false, follow: false },
};

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const student = await requireStudent("/portal");
  const displayName = student.name ?? student.email;

  return (
    <div className="min-h-dvh bg-gray-50 flex flex-col">
      {/* The nav is sticky rather than fixed, so it reserves its own space —
          no hand-maintained top padding that goes stale when the nav grows. */}
      <PortalNav displayName={displayName} />
      <main className="flex-1">{children}</main>
    </div>
  );
}
