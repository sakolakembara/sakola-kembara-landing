import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const tagVariants = cva("inline-flex items-center gap-1.5 rounded-full text-xs font-semibold", {
  variants: {
    tone: {
      /** Category and phase tags. */
      brand: "bg-primary-blue text-white",
      /** Quiet chips. */
      soft: "bg-primary-blue/10 text-primary-blue",
      /*
       * Hues for categories and statuses in lists (report category, team category, application status...). Each map
       * in lib/ names the tone. The status hues are the status tokens of root DESIGN.md section 2.
       */
      blue: "border border-info-border bg-info-bg text-info-fg",
      amber: "border border-warning-border bg-warning-bg text-warning-fg",
      green: "border border-success-border bg-success-bg text-success-fg",
      red: "border border-danger-border bg-danger-bg text-danger-fg",
      purple: "border border-purple-200 bg-purple-50 text-purple-700",
      gray: "border border-gray-200 bg-gray-100 text-gray-700",
    },
    size: {
      sm: "h-6 px-2.5",
      md: "h-7 px-3",
      /** The status next to a detail page's title. */
      lg: "px-3 py-1.5 text-sm",
    },
  },
  defaultVariants: { tone: "brand", size: "md" },
});

export type TagTone = NonNullable<VariantProps<typeof tagVariants>["tone"]>;

/**
 * Pill-shaped label (atom). Tags are always `rounded-full`; buttons never are. `dot` puts a dot of the tag's own color
 * in front: for a status (*Terbit*, *Menunggu*), not for a category. The admin's copy of the public kit's
 * `components/ui/tag.tsx` (cf/admin/DESIGN.md).
 */
export function Tag({
  tone,
  size,
  dot,
  className,
  children,
}: VariantProps<typeof tagVariants> & { dot?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span data-slot="tag" className={cn(tagVariants({ tone, size }), className)}>
      {dot && <i aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
