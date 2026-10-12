import { Menu } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { useSubmitLock } from "~/lib/hooks";
import { visibleNav } from "~/lib/nav";
import { useMe, useSession } from "~/lib/session";
import { ErrorBoundary } from "./ErrorBoundary";
import { MobileDrawer } from "./MobileDrawer";
import { SidebarBody } from "./Sidebar";

/**
 * The frame of every signed-in page (the legacy admin layout): a fixed sidebar
 * from `md` up; on phones a top bar with a menu button that opens a drawer. The
 * page itself is `<main>`, the only part that scrolls, and each page supplies
 * its own padding so an editor can pin a sticky header.
 */
export function Shell() {
  const me = useMe();
  const { signOut } = useSession();
  const groups = useMemo(() => visibleNav(me), [me]);
  const { pathname } = useLocation();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const { pending: signingOut, run } = useSubmitLock();
  const main = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);

  // After moving to another page, start reading at its content, not on the
  // link just pressed (what a full page load does), and close the drawer.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    setDrawerOpen(false);
    main.current?.focus({ preventScroll: true });
  }, [pathname]);

  // A drawer left open when the window grows to desktop width would hold
  // keyboard focus in a panel that is no longer visible.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const wide = window.matchMedia("(min-width: 768px)");
    const close = () => {
      if (wide.matches) setDrawerOpen(false);
    };
    wide.addEventListener("change", close);
    return () => wide.removeEventListener("change", close);
  }, []);

  const handleSignOut = () =>
    run(async () => {
      setSignOutError(false);
      if (!(await signOut())) setSignOutError(true);
    });

  const body = (extra: { onNavigate?: () => void; onClose?: () => void }) => (
    <SidebarBody
      me={me}
      groups={groups}
      onSignOut={handleSignOut}
      signingOut={signingOut}
      signOutError={signOutError}
      {...extra}
    />
  );

  return (
    // Column on phones (top bar above main), row on desktop (sidebar left of main).
    <div className="flex h-dvh flex-col overflow-hidden bg-gray-50 md:flex-row">
      <button
        type="button"
        onClick={() => main.current?.focus()}
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-blue focus:shadow-lg"
      >
        Lewati ke konten utama
      </button>

      <div
        inert={drawerOpen}
        className="flex shrink-0 items-center justify-between bg-gray-900 px-4 py-1 text-white md:hidden"
      >
        <span className="font-[family-name:var(--font-display)] text-lg">SK Admin</span>
        <button
          ref={menuButton}
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Buka menu"
          aria-haspopup="dialog"
          aria-expanded={drawerOpen}
          aria-controls="mobile-drawer"
          className="-mr-3 flex size-11 items-center justify-center"
        >
          <Menu size={22} aria-hidden="true" />
        </button>
      </div>

      <aside inert={drawerOpen} className="hidden w-60 shrink-0 bg-gray-900 p-6 text-white md:block">
        {body({})}
      </aside>

      {drawerOpen && (
        <MobileDrawer onClose={() => setDrawerOpen(false)} restoreFocusTo={menuButton}>
          {body({ onNavigate: () => setDrawerOpen(false), onClose: () => setDrawerOpen(false) })}
        </MobileDrawer>
      )}

      {/* main is the scroll container. Padding belongs to each page. */}
      <main id="main" ref={main} tabIndex={-1} inert={drawerOpen} className="flex-1 overflow-auto outline-none">
        <ErrorBoundary resetKey={pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}
