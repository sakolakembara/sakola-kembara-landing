import { cva, type VariantProps } from "class-variance-authority";
import { createContext, useContext, useId } from "react";
import { cn } from "@/lib/cn";

type FieldState = { id: string; describedBy?: string; invalid: boolean };

const FieldContext = createContext<FieldState | null>(null);

/**
 * One form field (molecule): label, control, then a hint or an error. The `Input`, `Textarea` or `Select` inside it
 * picks up the id, `aria-describedby` and `aria-invalid` from here, so the wiring can't drift from the markup. The
 * admin's copy of the public kit's `components/ui/field.tsx` (cf/admin/DESIGN.md): same props, the label above the
 * control, the hint and the error at 13 px under it.
 *
 * With `group`, it is a `<fieldset>` whose `<legend>` names a set of controls (radio cards, yes/no), and the hint or
 * error describes the whole set.
 */
export function Field({
  id,
  group,
  label,
  required,
  hint,
  error,
  labelAside,
  hideLabel,
  className,
  children,
}: {
  /** The control's id; generated when left out. */
  id?: string;
  group?: boolean;
  label: React.ReactNode;
  /** Shows the asterisk; the control still needs its own `required`. */
  required?: boolean;
  hint?: React.ReactNode;
  error?: string;
  /** Set on the label's row, right-aligned, e.g. a "Lupa password?" link. */
  labelAside?: React.ReactNode;
  /** The label is still the control's name, but not drawn: for a field that would only repeat the title of its card. */
  hideLabel?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const autoId = useId();
  const baseId = id ?? autoId;
  const hintId = hint && !error ? `${baseId}-hint` : undefined;
  const errorId = error ? `${baseId}-error` : undefined;
  const describedBy = errorId ?? hintId;

  const asterisk = required && (
    <span aria-hidden className="ml-0.5 text-danger-fg">
      *
    </span>
  );
  const messages = (
    <>
      {hintId && (
        <div id={hintId} className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
          {hint}
        </div>
      )}
      {errorId && (
        <p id={errorId} className="mt-1.5 text-[13px] text-danger-fg">
          {error}
        </p>
      )}
    </>
  );

  if (group) {
    return (
      <fieldset aria-describedby={describedBy} className={cn("min-w-0", className)}>
        <legend className={cn("block text-sm font-medium text-gray-700", hideLabel ? "sr-only" : "mb-1.5")}>
          {label}
          {asterisk}
        </legend>
        {children}
        {messages}
      </fieldset>
    );
  }

  const labelEl = (
    <label htmlFor={baseId} className={cn("block text-sm font-medium text-gray-700", hideLabel ? "sr-only" : !labelAside && "mb-1.5")}>
      {label}
      {asterisk}
    </label>
  );

  return (
    <FieldContext.Provider value={{ id: baseId, describedBy, invalid: Boolean(error) }}>
      <div className={className}>
        {labelAside ? (
          <div className="mb-1.5 flex items-center justify-between gap-3">
            {labelEl}
            {labelAside}
          </div>
        ) : (
          labelEl
        )}
        {children}
        {messages}
      </div>
    </FieldContext.Provider>
  );
}

/**
 * Shared look of text inputs, textareas and selects (cf/admin/DESIGN.md section 2): a 1 px border, `rounded-lg`, 40 px
 * tall (44 px on a phone) with 14 px text, 16 px on a phone because smaller text makes iOS zoom in on focus. Focus
 * keeps the global 3 px light-blue outline and turns the border navy. `sm` is the filter rows above the tables.
 * A control with `aria-invalid` (set by `Field` when it has an error) gets a red border, also while focused.
 */
export const controlVariants = cva(
  "w-full border border-input bg-card text-base text-foreground leading-6 placeholder:text-gray-400 transition-colors focus-visible:border-primary disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-muted-foreground aria-invalid:border-danger-fg aria-invalid:focus-visible:border-danger-fg md:text-sm",
  {
    variants: {
      // A fixed line height so inputs and selects come out the same height instead of inheriting the body's 1.6.
      size: {
        md: "min-h-11 rounded-lg px-3 py-2 md:min-h-10",
        sm: "min-h-10 rounded-lg px-3 py-1.5",
      },
    },
    defaultVariants: { size: "md" },
  },
);

type ControlSize = VariantProps<typeof controlVariants>;

function useFieldProps(props: { id?: string; "aria-describedby"?: string; "aria-invalid"?: React.AriaAttributes["aria-invalid"] }) {
  const field = useContext(FieldContext);
  return {
    id: props.id ?? field?.id,
    "aria-describedby": props["aria-describedby"] ?? field?.describedBy,
    "aria-invalid": props["aria-invalid"] ?? (field?.invalid || undefined),
  };
}

/** Text input (atom). Inside a `Field` it is labelled and described automatically. */
export function Input({ size, className, ...props }: Omit<React.ComponentProps<"input">, "size"> & ControlSize) {
  return <input data-slot="input" {...props} {...useFieldProps(props)} className={cn(controlVariants({ size }), className)} />;
}

/** Multi-line input (atom). Not resizable by default; pass `resize-y` where long answers are expected. */
export function Textarea({ size, className, ...props }: React.ComponentProps<"textarea"> & ControlSize) {
  return (
    <textarea data-slot="textarea" {...props} {...useFieldProps(props)} className={cn(controlVariants({ size }), "min-h-20 resize-none", className)} />
  );
}

/** The select's arrow: a chevron drawn in the background, so the control stays a native `<select>` (a phone's own picker). */
const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";

/**
 * Native select (atom), white so it matches the inputs in every browser, with its own arrow. It gets an explicit
 * height because browsers size a select's text box differently from an input's.
 */
export function Select({ size, className, style, ...props }: Omit<React.ComponentProps<"select">, "size"> & ControlSize) {
  return (
    <select
      data-slot="select"
      {...props}
      {...useFieldProps(props)}
      style={{ backgroundImage: CHEVRON, ...style }}
      className={cn(
        controlVariants({ size }),
        "appearance-none bg-[length:1rem] bg-[position:right_0.75rem_center] bg-no-repeat pr-9",
        size === "sm" ? "h-10" : "h-11 md:h-10",
        className,
      )}
    />
  );
}
