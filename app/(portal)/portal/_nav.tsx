"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { portalSignOut } from "./_actions";
import brandLogo from "@/public/images/logo-sakola-kembara.png";

const NAV_ITEMS = [
  { href: "/portal", label: "Beranda" },
  { href: "/portal/status", label: "Status Pendaftaran" },
];

interface Props {
  displayName: string;
}

/**
 * Portal top-bar. Matches the public Navbar's visual language (fixed, white
 * with a subtle backdrop blur, brand logo on the left) but with a compact
 * two-item nav + user chip on the right. Mirrored below for mobile.
 */
export function PortalNav({ displayName }: Props) {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 bg-white/95 backdrop-blur-md z-40 border-b border-gray-100">
      <div className="max-w-[1200px] mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-8">
          <Link href="/" aria-label="Sakola Kembara" className="flex items-center">
            <Image
              src={brandLogo}
              alt="Sakola Kembara"
              width={300}
              height={103}
              priority
              className="h-8 md:h-10 w-auto"
            />
          </Link>
          <ul className="hidden md:flex items-center gap-6">
            {NAV_ITEMS.map((item) => {
              const active =
                item.href === "/portal"
                  ? pathname === "/portal"
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`text-[15px] font-medium transition-colors ${
                      active
                        ? "text-primary-blue"
                        : "text-gray-600 hover:text-primary-blue"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden md:block text-right">
            <div className="text-xs text-gray-500">Masuk sebagai</div>
            <div
              className="text-xs font-semibold text-gray-800 truncate max-w-[180px]"
              title={displayName}
            >
              {displayName}
            </div>
          </div>
          <form action={portalSignOut}>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-primary-blue border border-gray-200 rounded-lg px-3 py-2 hover:border-primary-blue/40 transition-colors"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">Keluar</span>
            </button>
          </form>
        </div>
      </div>

      {/* Mobile secondary nav row */}
      <div className="md:hidden max-w-[1200px] mx-auto px-4 border-t border-gray-100">
        <ul className="flex items-center gap-5">
          {NAV_ITEMS.map((item) => {
            const active =
              item.href === "/portal"
                ? pathname === "/portal"
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`block py-3 text-sm font-medium border-b-2 transition-colors ${
                    active
                      ? "text-primary-blue border-primary-blue"
                      : "text-gray-600 border-transparent hover:text-primary-blue"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
