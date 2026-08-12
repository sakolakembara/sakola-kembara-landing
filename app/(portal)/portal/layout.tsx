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
      <PortalNav displayName={displayName} />
      {/* Fixed nav is ~64px desktop / ~92px mobile (with the secondary row).
          Push main below it. */}
      <main className="flex-1 pt-[92px] md:pt-[68px]">{children}</main>
    </div>
  );
}
