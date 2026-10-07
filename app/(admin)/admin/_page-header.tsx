import { Heading } from "@/components/ui/heading";
import { cn } from "@/lib/cn";

/**
 * The top of an admin page: an optional overline (e.g. "Detail pesan"), the
 * page title as its h1, a description passed as children, and actions on the
 * right from `md` up.
 */
export function AdminPageHeader({
  title,
  overline,
  actions,
  className,
  children,
}: {
  title: React.ReactNode;
  overline?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className={cn("mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-center", className)}>
      <div>
        {overline && (
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{overline}</p>
        )}
        <Heading level="subsection" as="h1" className="mb-1 text-gray-900">
          {title}
        </Heading>
        {children}
      </div>
      {/* Actions keep their width; the description wraps instead. */}
      {actions && <div className="shrink-0">{actions}</div>}
    </header>
  );
}
