import { LogOut } from "lucide-react";
import { NavLink } from "react-router";
import brandLogo from "@/public/images/logo-sakola-kembara.png";
import { useSubmitLock } from "~/lib/hooks";
import { useSession } from "~/lib/session";

/** The two pages of the portal (the legacy nav, app/(portal)/portal/_nav.tsx). `to` is relative to the router's basename. */
export const NAV_ITEMS = [
  { to: "/", label: "Beranda", end: true },
  { to: "/status", label: "Status Pendaftaran", end: false },
] as const;

/**
 * The portal's top bar: the brand on the left, the two pages, and who is signed in with "Keluar" on the right. One
 * list of links for every width (the legacy drew two, one hidden): on a phone it sits in a second row under the
 * brand, from `md` it sits beside it. The page the student is on carries `aria-current="page"`.
 */
export function PortalNav({ displayName }: { displayName: string }) {
  const { signOut } = useSession();
  const { pending, run } = useSubmitLock();

  return (
    <header className="sticky top-0 z-40 border-b border-gray-100 bg-white/95 backdrop-blur-md">
      <div className="mx-auto grid max-w-[1200px] grid-cols-[1fr_auto] items-center gap-x-8 px-4 md:grid-cols-[auto_1fr_auto] md:px-6">
        {/* The brand goes to the public site, which is another Worker on the same apex: a plain link, not the router's. */}
        <a href="/" className="col-start-1 row-start-1 flex items-center py-3 md:py-4">
          <img src={brandLogo} alt="Sakola Kembara" width={300} height={103} className="h-8 w-auto md:h-10" />
        </a>

        <nav aria-label="Menu portal" className="col-span-2 row-start-2 border-t border-gray-100 md:col-span-1 md:col-start-2 md:row-start-1 md:border-t-0">
          <ul className="flex items-center gap-5 md:gap-6">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className="block min-h-11 border-b-2 border-transparent py-3 text-sm font-medium text-gray-600 transition-colors hover:text-primary-blue aria-[current=page]:border-primary-blue aria-[current=page]:text-primary-blue md:flex md:items-center md:border-b-0 md:py-0 md:text-[15px] md:aria-[current=page]:border-transparent"
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="col-start-2 row-start-1 flex items-center gap-3 md:col-start-3">
          <div className="hidden text-right md:block">
            <div className="text-xs text-gray-500">Masuk sebagai</div>
            <div className="max-w-[180px] truncate text-xs font-semibold text-gray-800" title={displayName}>
              {displayName}
            </div>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(async () => void (await signOut()))}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 transition-colors hover:border-primary-blue/40 hover:text-primary-blue disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LogOut size={14} aria-hidden />
            {/* Visible from sm; on phones the button is icon-only but keeps its name. */}
            <span className="sr-only sm:not-sr-only">Keluar</span>
          </button>
        </div>
      </div>
    </header>
  );
}
