"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Menu, X } from "lucide-react";
import { adminSignOut } from "./_actions";

const NAV_ITEMS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/applications", label: "Pendaftar" },
  { href: "/admin/messages", label: "Pesan" },
  { href: "/admin/announcements", label: "Pengumuman" },
  { href: "/admin/reports", label: "Laporan" },
  { href: "/admin/blog", label: "Blog" },
  { href: "/admin/team", label: "Tim" },
  { href: "/admin/resources", label: "Berkas Pendaftaran" },
  { href: "/admin/audit", label: "Aktivitas" },
  { href: "/admin/settings", label: "Pengaturan" },
];

interface SidebarProps {
  email: string;
}

export function Sidebar({ email }: SidebarProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer whenever the route changes (clicking a nav link on
  // mobile fires this on next render).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  return (
    <>
      {/* Mobile top bar — participates in the flex column so it pushes main
          content down. Hidden on desktop. */}
      <div className="md:hidden flex items-center justify-between bg-gray-900 text-white px-4 py-3 shrink-0">
        <span className="font-[var(--font-display)] text-lg">SK Admin</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Buka menu"
          className="p-2 -mr-2"
        >
          <Menu size={22} />
        </button>
      </div>

      {/* Backdrop for the mobile drawer. Tappable to dismiss. */}
      {open && (
        <button
          type="button"
          aria-label="Tutup menu"
          onClick={() => setOpen(false)}
          className="md:hidden fixed inset-0 z-40 bg-black/50"
        />
      )}

      {/* Sidebar: fixed sliding drawer on mobile, in-flow column on desktop. */}
      <aside
        className={`fixed md:relative top-0 left-0 z-50 h-dvh md:h-auto w-64 md:w-60 shrink-0 bg-gray-900 text-white p-6 flex flex-col transition-transform duration-200 ease-out ${
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="flex items-center justify-between mb-8">
          <span className="font-[var(--font-display)] text-xl">SK Admin</span>
          {/* Close button only visible on mobile, inside the drawer. */}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Tutup menu"
            className="md:hidden p-1 -mr-1 text-gray-400 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex flex-col gap-1 text-sm">
          {NAV_ITEMS.map((item) => {
            const active =
              item.href === "/admin"
                ? pathname === "/admin"
                : pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-2 rounded-md transition-colors ${
                  active
                    ? "bg-white/10 text-white font-medium"
                    : "text-gray-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <form
          className="mt-auto pt-6 border-t border-white/10"
          action={adminSignOut}
        >
          <div
            className="text-xs text-gray-500 mb-2 truncate"
            title={email}
          >
            {email}
          </div>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 text-sm text-gray-300 hover:text-white transition-colors"
          >
            <LogOut size={14} />
            Keluar
          </button>
        </form>
      </aside>
    </>
  );
}
