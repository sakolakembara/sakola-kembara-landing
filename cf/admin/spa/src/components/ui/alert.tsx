import { cva, type VariantProps } from "class-variance-authority";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";

const alertVariants = cva("flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm leading-relaxed", {
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

const ICONS = { danger: CircleAlert, success: CircleCheck, warning: TriangleAlert, info: Info } as const;

/**
 * A message banner (atom), e.g. a form's error or a "link sent" notice, in the status colors (root DESIGN.md section
 * 2), with an icon that says the same as the color (a color alone is not enough). Errors are announced right away; the
 * other tones politely. The admin's copy of the public kit's `components/ui/alert.tsx`: same props.
 */
export function Alert({
  tone,
  className,
  children,
}: VariantProps<typeof alertVariants> & { className?: string; children: React.ReactNode }) {
  const kind = tone ?? "danger";
  const Icon = ICONS[kind];
  return (
    <div data-slot="alert" role={kind === "danger" ? "alert" : "status"} className={cn(alertVariants({ tone }), className)}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
