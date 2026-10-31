import { ChevronRight } from "lucide-react";
import { Link, useLocation } from "react-router";
import { NAV, navItemFor } from "~/lib/nav";
import { usePageChrome } from "~/lib/page-chrome";

interface Crumb {
  label: string;
  /** Set when the page is below the entry ("/blog/new" is below "Blog"): the entry then links back to its list. */
  href?: string;
}

/** The menu group and entry the page belongs to; empty for a path that is not in the menu (the 404 page). */
export function crumbsFor(pathname: string): Crumb[] {
  const item = navItemFor(pathname);
  if (!item) return [];
  const group = NAV.find((candidate) => candidate.items.includes(item));
  const clean = pathname.replace(/\/+$/, "") || "/";
  const crumbs: Crumb[] = [];
  if (group?.label) crumbs.push({ label: group.label });
  crumbs.push({ label: item.label, href: clean === item.path ? undefined : item.path });
  return crumbs;
}

/**
 * Where the page sits in the menu, in the desktop top bar: "Pendaftaran / Pendaftar". An editor page adds a last step,
 * the title of what it edits ("Konten Situs / Blog / Cara Belajar Efektif"), through the page chrome.
 */
export function Breadcrumb() {
  const chrome = usePageChrome();
  const leaf = chrome?.leaf;
  const crumbHref = chrome?.crumbHref;
  const found = crumbsFor(useLocation().pathname);
  if (found.length === 0) return null;
  // A page below its list may lead the list's step back to the list as the person had it (a filtered one).
  const steps = crumbHref ? found.map((crumb) => (crumb.href ? { ...crumb, href: crumbHref } : crumb)) : found;
  const crumbs = leaf ? [...steps, { label: leaf }] : steps;
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 text-[13px] font-medium text-foreground">
      <ol className="flex items-center gap-1.5">
        {crumbs.map((crumb, index) => (
          <li key={`${index}-${crumb.label}`} className={`flex items-center gap-1.5 ${index === crumbs.length - 1 ? "min-w-0" : "shrink-0"}`}>
            {index > 0 && <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-gray-400" />}
            {crumb.href ? (
              <Link to={crumb.href} className="truncate text-gray-600 hover:text-foreground hover:underline">
                {crumb.label}
              </Link>
            ) : (
              <span
                aria-current={index === crumbs.length - 1 ? "page" : undefined}
                className={index === crumbs.length - 1 ? "truncate" : "truncate text-gray-600"}
              >
                {crumb.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
