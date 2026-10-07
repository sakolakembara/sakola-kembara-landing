import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const tagVariants = cva("inline-flex items-center gap-1.5 rounded-full text-xs font-semibold", {
  variants: {
    tone: {
      /** Category and phase tags. */
      brand: "bg-primary-blue text-white",
      /** Quiet chips, e.g. "290+ jam belajar setahun". */
      soft: "bg-primary-blue/10 text-primary-blue",
    },
    size: {
      sm: "px-2.5 py-1",
      md: "px-3 py-1.5",
    },
  },
  defaultVariants: { tone: "brand", size: "md" },
});

/** Pill-shaped label (atom). Tags are always `rounded-full` (SAKEM-031 D5); buttons never are. */
export function Tag({
  tone,
  size,
  className,
  children,
}: VariantProps<typeof tagVariants> & { className?: string; children: React.ReactNode }) {
  return <span className={cn(tagVariants({ tone, size }), className)}>{children}</span>;
}
