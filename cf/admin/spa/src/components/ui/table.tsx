import { cn } from "@/lib/cn";

// The admin's copy of the public kit's `components/ui/table.tsx` (cf/admin/DESIGN.md section 3): the same pieces and
// props, the look of the polished lists. The header is sentence case and quiet, rows are 14 px with room to breathe.

/** The white card around a data table and its empty state. */
export function TableCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("overflow-hidden rounded-xl border border-gray-200 bg-white", className)}>{children}</div>;
}

/**
 * Data table (molecule) for admin lists. It keeps every column and scrolls sideways on narrow screens; children are
 * `THead` and `TBody` (and an optional caption).
 */
export function Table({ className, wrapperClassName, wrapperRef, children, ...props }: React.ComponentProps<"table"> & { wrapperClassName?: string; wrapperRef?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={wrapperRef} className={cn("overflow-x-auto", wrapperClassName)}>
      <table data-slot="table" className={cn("w-full text-sm", className)} {...props}>
        {children}
      </table>
    </div>
  );
}

export function THead({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("border-b border-gray-200 bg-gray-50 text-gray-600", className)} {...props} />;
}

/** Column header: 13 px, semibold, sentence case. */
export function Th({ className, ...props }: React.ComponentProps<"th">) {
  return <th className={cn("h-11 px-4 text-left text-[13px] font-semibold", className)} {...props} />;
}

export function TBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y divide-gray-100", className)} {...props} />;
}

/** Body cell; alignment and text styles come from `className`. */
export function Td({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-4 py-3.5", className)} {...props} />;
}
