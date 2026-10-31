import { useId } from "react";
import { cn } from "@/lib/cn";

// shadcn's Switch, as a native checkbox with `role="switch"` (no Radix: the page stays a plain form control, keyboard
// and screen reader work by themselves, and the value goes in the form as any checkbox does). The track and the thumb
// are CSS: `appearance-none` and an `::after` for the thumb. `SwitchField` is the row shadcn's settings pages use:
// the label and what it does on the left, the switch on the right, the whole row pressable.

export function Switch({ className, ...props }: Omit<React.ComponentProps<"input">, "type" | "role">) {
  return (
    <input
      data-slot="switch"
      type="checkbox"
      role="switch"
      className={cn(
        "peer relative inline-flex h-[1.4rem] w-10 shrink-0 cursor-pointer appearance-none items-center rounded-full border border-transparent bg-gray-300 transition-colors checked:bg-primary disabled:cursor-not-allowed disabled:opacity-50",
        "after:absolute after:left-0.5 after:top-1/2 after:size-[1.1rem] after:-translate-y-1/2 after:rounded-full after:bg-white after:shadow-sm after:transition-transform checked:after:translate-x-[1.2rem] motion-reduce:transition-none motion-reduce:after:transition-none",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A labelled switch in a bordered row. `description` says what turning it on does (read with the control); `error` is
 * the Worker's sentence for the field. The id is the field's name, so the error summary of `FormShell` can link to it.
 */
export function SwitchField({
  id,
  label,
  description,
  error,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type" | "role" | "id"> & { id: string; label: React.ReactNode; description?: React.ReactNode; error?: string }) {
  const auto = useId();
  const descriptionId = description ? `${auto}-description` : undefined;
  const errorId = error ? `${auto}-error` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-border bg-card px-3.5 py-3 transition-colors hover:bg-gray-50 has-[:disabled]:cursor-not-allowed has-[:disabled]:hover:bg-card">
        <span className="min-w-0 space-y-0.5">
          <span className="block text-sm font-medium text-foreground">{label}</span>
          {description && (
            <span id={descriptionId} className="block text-[13px] leading-relaxed text-muted-foreground">
              {description}
            </span>
          )}
        </span>
        <Switch id={id} aria-describedby={errorId ?? descriptionId} aria-invalid={error ? true : undefined} className="mt-0.5" {...props} />
      </label>
      {error && (
        <p id={errorId} className="mt-1.5 text-[13px] text-danger-fg">
          {error}
        </p>
      )}
    </div>
  );
}
