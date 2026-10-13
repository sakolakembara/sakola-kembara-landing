import { useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router";
import { displayName } from "~/lib/me";
import { useMe } from "~/lib/session";
import { ErrorBoundary } from "./ErrorBoundary";
import { PortalNav } from "./PortalNav";

/**
 * Layout route of the signed-in portal: the top bar, then the page. The bar is sticky rather than fixed, so it
 * reserves its own space (the legacy layout). A crash in a page is caught here, under the bar, and clears when the
 * student goes to another page. After going to another page focus moves to the content, so a keyboard or screen
 * reader user starts at the new page and not on the link they pressed.
 */
export function PortalShell() {
  const me = useMe();
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    main.current?.focus();
  }, [pathname]);

  return (
    <div className="flex min-h-dvh flex-col bg-gray-50">
      <a
        href="#isi"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-blue"
      >
        Lewat ke konten utama
      </a>
      <PortalNav displayName={displayName(me)} />
      <main id="isi" ref={main} tabIndex={-1} className="flex-1 focus:outline-none">
        <ErrorBoundary variant="page" resetKey={pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}
