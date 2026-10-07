"use client";

import { createContext, useContext, useId } from "react";
import { cn } from "@/lib/cn";

type FieldState = { id: string; describedBy?: string; invalid: boolean };

const FieldContext = createContext<FieldState | null>(null);

/**
 * One form field (molecule): label, control, then a hint or an error. The
 * `Input`, `Textarea` or `Select` inside it picks up the id, `aria-describedby`
 * and `aria-invalid` from here, so the wiring can't drift from the markup.
 *
 * With `group`, it is a `<fieldset>` whose `<legend>` names a set of controls
 * (radio cards, yes/no), and the hint or error describes the whole set.
 */
export function Field({
  id,
  group,
  label,
  required,
  hint,
  error,
  labelAside,
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
        <div id={hintId} className="mt-1.5 text-xs leading-relaxed text-gray-500">
          {hint}
        </div>
      )}
      {errorId && (
        <p id={errorId} className="mt-1.5 text-xs text-danger-fg">
          {error}
        </p>
      )}
    </>
  );

  if (group) {
    return (
      <fieldset aria-describedby={describedBy} className={cn("min-w-0", className)}>
        <legend className="mb-2 block text-sm font-medium text-gray-700">
          {label}
          {asterisk}
        </legend>
        {children}
        {messages}
      </fieldset>
    );
  }

  const labelEl = (
    <label htmlFor={baseId} className={cn("block text-sm font-medium text-gray-700", !labelAside && "mb-2")}>
      {label}
      {asterisk}
    </label>
  );

  return (
    <FieldContext.Provider value={{ id: baseId, describedBy, invalid: Boolean(error) }}>
      <div className={className}>
        {labelAside ? (
          <div className="mb-2 flex items-center justify-between gap-3">
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

/** Shared look of text inputs, textareas and selects (DESIGN.md, Forms). */
export const controlClass =
  "w-full rounded-xl border-2 border-gray-200 px-4 py-3 focus:border-primary-blue focus:outline-none";

function useFieldProps(props: { id?: string; "aria-describedby"?: string; "aria-invalid"?: React.AriaAttributes["aria-invalid"] }) {
  const field = useContext(FieldContext);
  return {
    id: props.id ?? field?.id,
    "aria-describedby": props["aria-describedby"] ?? field?.describedBy,
    "aria-invalid": props["aria-invalid"] ?? (field?.invalid || undefined),
  };
}

/** Text input (atom). Inside a `Field` it is labelled and described automatically. */
export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input {...props} {...useFieldProps(props)} className={cn(controlClass, className)} />;
}

/** Multi-line input (atom). Not resizable by default; pass `resize-y` where long answers are expected. */
export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea {...props} {...useFieldProps(props)} className={cn(controlClass, "resize-none", className)} />;
}

/** Native select (atom), white so it matches the inputs in every browser. */
export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return <select {...props} {...useFieldProps(props)} className={cn(controlClass, "bg-white", className)} />;
}
