import { ArrowLeft } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { usePageChrome } from "~/lib/page-chrome";
import { useIsDesktop } from "~/lib/use-desktop";

/**
 * The bar of an editor page (cf/admin/DESIGN.md, "Forms: one bar"). From `md` up it is the shell's own top bar: the
 * breadcrumb gets the title as its last step, the status goes next to it and the actions on the right, so there is no
 * second bar and no separate "back" button (the breadcrumb is the way back). On a phone, where the shell's bar is the
 * navy one with the menu, the page draws a thin bar with a back arrow, the title and the status, and the actions in a bar
 * at the bottom edge, where a thumb is.
 *
 * Without the shell (a form rendered on its own) it draws the phone's version, so nothing is lost.
 *
 * A page that only shows something (a detail page of an applicant) has no actions of its own: it passes none, the shell
 * keeps its link to the public site and the phone gets no bar at the bottom. `crumbHref` is for a page below its list
 * that wants the breadcrumb's list step to lead back to the list as the person had it (its filters), not the plain list.
 */
export function PageBar({
  title,
  back,
  status,
  actions,
  crumbHref,
}: {
  title: string;
  back: { href: string; label?: string };
  status?: ReactNode;
  actions?: ReactNode;
  crumbHref?: string;
}) {
  const chrome = usePageChrome();
  const desktop = useIsDesktop();
  const slots = desktop && chrome?.actions ? { leading: chrome.leading, actions: chrome.actions } : null;
  const setLeaf = chrome?.setLeaf;
  const setCrumbHref = chrome?.setCrumbHref;
  const setHasActions = chrome?.setHasActions;
  const hasActions = Boolean(actions);

  useEffect(() => {
    if (!slots) return;
    setLeaf?.(title);
    setCrumbHref?.(crumbHref ?? null);
    setHasActions?.(hasActions);
    return () => {
      setLeaf?.(null);
      setCrumbHref?.(null);
      setHasActions?.(false);
    };
  }, [Boolean(slots), title, crumbHref, hasActions, setLeaf, setCrumbHref, setHasActions]); // eslint-disable-line react-hooks/exhaustive-deps

  if (slots) {
    return (
      <>
        {status && slots.leading && createPortal(status, slots.leading)}
        {createPortal(actions, slots.actions)}
      </>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-2 md:px-6">
        <Link to={back.href} aria-label={back.label ?? "Kembali"} className="-ml-2 inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900">
          <ArrowLeft size={18} aria-hidden="true" />
        </Link>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{title}</span>
        {status}
      </div>
      {actions && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-border bg-card px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 *:flex-1 md:hidden">{actions}</div>
      )}
    </>
  );
}
