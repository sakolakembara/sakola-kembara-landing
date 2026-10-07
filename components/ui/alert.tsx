import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const alertVariants = cva("rounded-lg border px-4 py-3 text-sm leading-relaxed", {
  variants: {
    tone: {
      danger: "border-danger-border bg-danger-bg text-danger-fg",
      success: "border-success-border bg-success-bg text-success-fg",
      warning: "border-warning-border bg-warning-bg text-warning-fg",
      info: "border-info-border bg-info-bg text-info-fg",
    },
  },
  defaultVariants: { tone: "danger" },
});

/**
 * A message banner (atom), e.g. a form's error or a "link sent" notice, in the
 * status colors (SAKEM-031 D2). Errors are announced right away; the other
 * tones politely.
 */
export function Alert({
  tone,
  className,
  children,
}: VariantProps<typeof alertVariants> & { className?: string; children: React.ReactNode }) {
  const urgent = (tone ?? "danger") === "danger";
  return (
    <div role={urgent ? "alert" : "status"} className={cn(alertVariants({ tone }), className)}>
      {children}
    </div>
  );
}
