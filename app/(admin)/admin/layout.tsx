import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ALLOWED_DOMAIN, auth, signOut } from "@/auth";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s | Admin Sakola Kembara" },
  robots: { index: false, follow: false },
};

const NAV_ITEMS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/applications", label: "Pendaftar" },
  { href: "/admin/announcements", label: "Pengumuman" },
  { href: "/admin/reports", label: "Laporan" },
  { href: "/admin/blog", label: "Blog" },
  { href: "/admin/team", label: "Tim" },
  { href: "/admin/settings", label: "Pengaturan" },
];

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
    <div className="h-dvh flex bg-gray-50 overflow-hidden">
      <aside className="w-60 shrink-0 bg-gray-900 text-white p-6 flex flex-col">
        <div className="font-[var(--font-display)] text-xl mb-8">SK Admin</div>
        <nav className="flex flex-col gap-1 text-sm">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="px-3 py-2 rounded-md text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <form
          className="mt-auto pt-6 border-t border-white/10"
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <div className="text-xs text-gray-500 mb-2 truncate" title={session.user.email!}>
            {session.user.email}
          </div>
          <button
            type="submit"
            className="text-sm text-gray-300 hover:text-white transition-colors"
          >
            Keluar
          </button>
        </form>
      </aside>
      {/* main is the scroll container. Padding is delegated to each page so
          editor pages can have a sticky header that truly pins to top: 0. */}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
