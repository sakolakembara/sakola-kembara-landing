import type { Metadata } from "next";
import Link from "next/link";
import { LogOut } from "lucide-react";
import { requireStudent } from "@/lib/auth-helpers";
import { portalSignOut } from "./_actions";

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

  return (
    <div className="min-h-dvh flex flex-col bg-gray-50">
      <header className="bg-white border-b border-gray-100">
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link
              href="/"
              className="font-[var(--font-display)] text-lg text-gray-900 hover:opacity-80 transition-opacity"
            >
              Sakola Kembara
            </Link>
            <nav className="hidden sm:flex items-center gap-4 text-sm">
              <PortalLink href="/portal" label="Beranda" />
              <PortalLink href="/portal/status" label="Status Pendaftaran" />
            </nav>
          </div>
          <form action={portalSignOut} className="flex items-center gap-3">
            <div className="text-right hidden md:block">
              <div className="text-xs text-gray-500">Masuk sebagai</div>
              <div className="text-xs font-medium text-gray-800 truncate max-w-[180px]">
                {student.name ?? student.email}
              </div>
            </div>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors"
            >
              <LogOut size={14} />
              Keluar
            </button>
          </form>
        </div>
        <nav className="sm:hidden max-w-4xl mx-auto px-4 flex items-center gap-4 text-sm border-t border-gray-100 py-2">
          <PortalLink href="/portal" label="Beranda" />
          <PortalLink href="/portal/status" label="Status" />
        </nav>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}

function PortalLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="text-gray-600 hover:text-primary-blue font-medium transition-colors"
    >
      {label}
    </Link>
  );
}
