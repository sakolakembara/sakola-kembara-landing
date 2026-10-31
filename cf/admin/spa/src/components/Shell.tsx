import { ExternalLink, Menu, PanelLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { cn } from "@/lib/cn";
import { DashboardProvider, useSharedDashboard } from "~/lib/dashboard-provider";
import { useSubmitLock } from "~/lib/hooks";
import { visibleNav } from "~/lib/nav";
import { ChromeSlot, PageChromeProvider, usePageChrome } from "~/lib/page-chrome";
import { useMe, useSession } from "~/lib/session";
import { useSidebarCollapsed } from "~/lib/sidebar-state";
import { SITE_URL } from "~/lib/site";
import { Breadcrumb } from "./Breadcrumb";
import { ErrorBoundary } from "./ErrorBoundary";
import { MobileDrawer } from "./MobileDrawer";
import { asideClass, FRAME_CLASS, HEADER_CLASS, MOBILE_BAR_CLASS, MobileBrand } from "./shell-parts";
import { SidebarBody } from "./Sidebar";

/**
 * The frame of every signed-in page (cf/admin/DESIGN.md, "Shell"): a navy sidebar from `md` up, 248 px wide or
 * collapsed to a 72 px icon rail (the button in the top bar, Ctrl+B), beside a white top bar with the breadcrumb and a
 * link to the public site; on phones a navy top bar with a menu button that opens a drawer. The page itself is
 * `<main>`, the only part that scrolls, and each page supplies its own padding so an editor can pin a sticky header.
 * The dashboard's answer is read once here: the sidebar shows its counts and the dashboard page its tiles.
 */
export function Shell() {
  return (
    <DashboardProvider>
      <PageChromeProvider>
        <ShellFrame />
      </PageChromeProvider>
    </DashboardProvider>
  );
}

function ShellFrame() {
  const me = useMe();
  const { signOut } = useSession();
  const { counts } = useSharedDashboard();
  const chrome = usePageChrome();
  const groups = useMemo(() => visibleNav(me), [me]);
  const { pathname } = useLocation();
  const { collapsed, toggle } = useSidebarCollapsed();

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

  const body = (extra: { collapsed?: boolean; onNavigate?: () => void; onClose?: () => void }) => (
    <SidebarBody
      me={me}
      groups={groups}
      counts={counts}
      onSignOut={handleSignOut}
      signingOut={signingOut}
      signOutError={signOutError}
      {...extra}
    />
  );

  const toggleLabel = collapsed ? "Bentangkan menu samping" : "Ciutkan menu samping";

  return (
    // Column on phones (top bar above main), row on desktop (sidebar left of main).
    // `relative`, here and on <main>: an absolutely positioned element (every `sr-only` one: a hidden file input, a
    // live region) is only clipped by a box that is its containing block. Without it, one deep in a long page sticks
    // out of the shell and makes the document itself taller than the window, so the whole shell scrolls away and
    // leaves white under it.
    <div className={FRAME_CLASS}>
      <button
        type="button"
        onClick={() => main.current?.focus()}
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-blue focus:shadow-lg"
      >
        Lewati ke konten utama
      </button>

      <div inert={drawerOpen} className={MOBILE_BAR_CLASS}>
        <MobileBrand />
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

      <aside inert={drawerOpen} className={asideClass(collapsed)}>
        {body({ collapsed })}
      </aside>

      {drawerOpen && (
        <MobileDrawer onClose={() => setDrawerOpen(false)} restoreFocusTo={menuButton}>
          {body({ onNavigate: () => setDrawerOpen(false), onClose: () => setDrawerOpen(false) })}
        </MobileDrawer>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header inert={drawerOpen} className={HEADER_CLASS}>
          <button
            type="button"
            onClick={toggle}
            aria-label={toggleLabel}
            aria-keyshortcuts="Control+B Meta+B"
            title={`${collapsed ? "Bentangkan" : "Ciutkan"} menu (Ctrl+B)`}
            className="inline-flex size-[34px] items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
          >
            <PanelLeft size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <span aria-hidden="true" className="h-5 w-px bg-border" />
          <Breadcrumb />
          {/* Two places an editor page fills (PageBar): its status next to the breadcrumb, its actions on the right. */}
          <ChromeSlot slot="leading" className="flex min-w-0 items-center gap-2 empty:hidden" />
          <div className="ml-auto flex shrink-0 items-center gap-3">
            <ChromeSlot slot="actions" className="flex items-center gap-2 empty:hidden" />
            {/* The page's own buttons need the room; its address is on the page. */}
            {!chrome?.hasActions && (
              <a
                href={SITE_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Lihat situs (tab baru)"
                className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-primary hover:underline"
              >
                Lihat situs
                <ExternalLink size={15} aria-hidden="true" />
              </a>
            )}
          </div>
        </header>

        {/* main is the scroll container. Padding belongs to each page. */}
        <main id="main" ref={main} tabIndex={-1} inert={drawerOpen} className="relative min-h-0 flex-1 overflow-auto outline-none">
          <ErrorBoundary resetKey={pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
