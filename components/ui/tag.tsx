import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const tagVariants = cva("inline-flex items-center gap-1.5 rounded-full text-xs font-semibold", {
  variants: {
    tone: {
      /** Category and phase tags. */
      brand: "bg-primary-blue text-white",
      /** Quiet chips, e.g. "290+ jam belajar setahun". */
      soft: "bg-primary-blue/10 text-primary-blue",
      /*
       * Hues for categories and statuses in lists (report category, team
       * category, application status…). Each map in lib/ names the tone.
       */
      blue: "border border-blue-200 bg-blue-50 text-blue-700",
      amber: "border border-amber-200 bg-amber-50 text-amber-700",
      green: "border border-emerald-200 bg-emerald-50 text-emerald-700",
      red: "border border-red-200 bg-red-50 text-red-700",
      purple: "border border-purple-200 bg-purple-50 text-purple-700",
      gray: "border border-gray-200 bg-gray-50 text-gray-700",
    },
    size: {
      sm: "px-2.5 py-1",
      md: "px-3 py-1.5",
      /** The status next to a detail page's title. */
      lg: "px-3 py-1.5 text-sm",
    },
  },
  defaultVariants: { tone: "brand", size: "md" },
});

export type TagTone = NonNullable<VariantProps<typeof tagVariants>["tone"]>;

/** Pill-shaped label (atom). Tags are always `rounded-full` (SAKEM-031 D5); buttons never are. */
export function Tag({
  tone,
  size,
  className,
  children,
}: VariantProps<typeof tagVariants> & { className?: string; children: React.ReactNode }) {
  return <span className={cn(tagVariants({ tone, size }), className)}>{children}</span>;
}
