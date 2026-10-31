import type { ReactNode } from "react";
import { Link } from "react-router";
import { Heading } from "@/components/ui/heading";
import { cn } from "@/lib/cn";
import { Skeleton } from "~/components/ui/skeleton";
import { usePageTitle } from "~/lib/hooks";

/**
 * The top of an admin page. A port of the legacy `AdminPageHeader`
 * (app/(admin)/admin/_page-header.tsx), same markup, with the admin's title style (28 px, semibold, navy;
 * cf/admin/DESIGN.md): an optional
 * back link (detail pages), an optional overline (e.g. "Detail pesan"), the
 * title as the page's h1, a description passed as children, and actions on the
 * right from `md` up. It also sets the browser tab title when `title` is text.
 */
export function PageHeader({
  title,
  documentTitle,
  back,
  overline,
  actions,
  className,
  children,
}: {
  title: ReactNode;
  /** Browser tab title when `title` is not plain text (e.g. a greeting). */
  documentTitle?: string;
  back?: { href: string; label: string };
  overline?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  usePageTitle(documentTitle ?? (typeof title === "string" ? title : null));

  return (
    <>
      {back && (
        <Link to={back.href} className="mb-4 block w-fit text-sm text-gray-500 transition-colors hover:text-gray-900">
          {back.label}
        </Link>
      )}
      <header className={cn("mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-center", className)}>
        <div>
          {overline && <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{overline}</p>}
          <Heading level="subsection" as="h1" className="mb-1 text-2xl font-semibold tracking-tight text-primary-blue-dark md:text-[28px]">
            {title}
          </Heading>
          {children}
        </div>
        {/* Actions keep their width; the description wraps instead. */}
        {actions && <div className="shrink-0">{actions}</div>}
      </header>
    </>
  );
}

/**
 * A grey line where a page's description will be while the number in it is not known yet. A description such as
 * "6 anggota tampil di /tim" used to say "0 anggota" for as long as the list was on its way and then change to the
 * real count: a wrong number, then a flick. This holds the line's height (so nothing below moves when the text
 * arrives) and says nothing; the table's own status text speaks for people who cannot see it.
 */
export function DescriptionSkeleton() {
  return (
    <div className="flex h-[1.6em] items-center">
      <Skeleton className="h-4 w-72 max-w-full" />
    </div>
  );
}
