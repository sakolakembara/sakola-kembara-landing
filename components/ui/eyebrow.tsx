import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const eyebrowVariants = cva(
  "inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wider",
  {
    variants: {
      tone: {
        light: "text-primary-blue",
        dark: "text-secondary-yellow",
      },
    },
    defaultVariants: { tone: "light" },
  },
);

/** The yellow-dot uppercase label above a section heading (atom). The dot is always yellow. */
export function Eyebrow({
  tone,
  className,
  children,
}: VariantProps<typeof eyebrowVariants> & { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn(eyebrowVariants({ tone }), className)}>
      <span aria-hidden className="h-2 w-2 rounded-full bg-secondary-yellow" />
      {children}
    </div>
  );
}
