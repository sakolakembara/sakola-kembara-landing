import { cn } from "@/lib/cn";

/** The white card around a data table and its empty state. */
export function TableCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("overflow-hidden rounded-xl border border-gray-100 bg-white", className)}>{children}</div>;
}

/**
 * Data table (molecule) for admin lists. It keeps every column and scrolls
 * sideways on narrow screens; children are `THead` and `TBody` (and an
 * optional caption such as the admin `TableHint`).
 */
export function Table({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full text-sm", className)}>{children}</table>
    </div>
  );
}

export function THead({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("bg-gray-50 text-gray-600", className)} {...props} />;
}

/** Column header: small uppercase label. */
export function Th({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn("px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide", className)}
      {...props}
    />
  );
}

export function TBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y divide-gray-100", className)} {...props} />;
}

/** Body cell; alignment and text styles come from `className`. */
export function Td({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-4 py-3", className)} {...props} />;
}
