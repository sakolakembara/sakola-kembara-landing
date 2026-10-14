import { createContext, type ReactNode, useContext, useEffect, useRef } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Heading } from "@/components/ui/heading";
import { cn } from "@/lib/cn";
import type { StepId } from "@shared/application-form/steps";
import type { Wizard } from "~/lib/wizard/use-wizard";

// The controls the seven steps are made of. Each one is a legacy control (the `Field` kit, radio cards, yes/no) wired to the
// wizard: it reads its value and its error by NAME, writes through `update`, and marks itself with `data-field` so a line of
// the error summary can move focus to it. A group of radios is a `<fieldset>` with its `<legend>` (the kit's `Field group`),
// so a screen reader hears the question once and then the options; the keyboard is the native one (Tab into the group, the
// arrow keys inside it).

export type FormState = Pick<Wizard, "values" | "errors" | "update" | "filesOf" | "applyFileChange" | "expire">;
const FormContext = createContext<FormState | null>(null);

export function FormProvider({ form, children }: { form: FormState; children: ReactNode }) {
  return <FormContext.Provider value={form}>{children}</FormContext.Provider>;
}

export function useForm(): FormState {
  const form = useContext(FormContext);
  if (!form) throw new Error("useForm must be used inside <FormProvider>");
  return form;
}

type Bucket = Record<string, unknown>;

/** The value of a text-like field of a bucket. */
function useValue(bucket: StepId, name: string): string {
  const { values } = useForm();
  const value = (values[bucket] as unknown as Bucket)[name];
  return typeof value === "string" ? value : "";
}

/** Writes one field of a bucket. */
function useSetter(bucket: StepId, name: string) {
  const { update } = useForm();
  return (value: unknown) => (update as (b: StepId, patch: Bucket) => void)(bucket, { [name]: value });
}

export function StepHeader({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <header className="mb-2 border-b border-gray-100 pb-4">
      {/* The heading takes focus when the screen changes (see Wizard): a keyboard or screen reader user starts at the new screen. */}
      <Heading level="subsection" tabIndex={-1} data-step-heading className="mb-2 text-gray-900 focus:outline-none">
        {title}
      </Heading>
      {subtitle && <p className="text-sm leading-relaxed text-gray-600 md:text-base">{subtitle}</p>}
    </header>
  );
}

export function FormSection({ title, children, tone = "plain" }: { title: string; children: ReactNode; tone?: "plain" | "blue" }) {
  return (
    <section className="pt-2">
      <h3
        className={cn(
          "mb-4 border-b pb-2 text-sm font-bold uppercase tracking-wide",
          tone === "blue" ? "border-primary-blue/20 text-primary-blue" : "border-gray-100 text-gray-900",
        )}
      >
        {title}
      </h3>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

// ─── Text

interface TextProps {
  bucket: StepId;
  name: string;
  label: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  placeholder?: string;
  inputMode?: "text" | "numeric" | "tel";
  type?: "text" | "tel";
  autoComplete?: string;
  /** Text after the input, drawn inside it on the right ("m²", "bulan"). It is part of the label's meaning, so the label says it too. */
  suffix?: string;
  /** What is stored for what was typed (the WhatsApp number loses its spaces as it is typed, as the legacy field did). */
  clean?: (typed: string) => string;
  className?: string;
}

export function TextField({ bucket, name, label, required = true, hint, placeholder, inputMode, type = "text", autoComplete, suffix, clean, className }: TextProps) {
  const { errors } = useForm();
  const value = useValue(bucket, name);
  const set = useSetter(bucket, name);
  const input = (
    <Input
      id={name}
      data-field={name}
      type={type}
      inputMode={inputMode}
      autoComplete={autoComplete ?? "off"}
      value={value}
      placeholder={placeholder}
      onChange={(event) => set(clean ? clean(event.target.value) : event.target.value)}
      className={suffix ? "pr-16" : undefined}
    />
  );
  return (
    <Field id={name} label={label} required={required} hint={hint} error={errors[name]} className={className}>
      {suffix ? (
        <div className="relative max-w-[240px]">
          {input}
          <span aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
            {suffix}
          </span>
        </div>
      ) : (
        input
      )}
    </Field>
  );
}

interface AreaProps {
  bucket: StepId;
  name: string;
  label: ReactNode;
  hint?: ReactNode;
  placeholder?: string;
  rows?: number;
  /** Shows "N / max karakter" under the box and stops typing at the maximum (the interview). */
  maxLength?: number;
  autoComplete?: string;
}

export function AreaField({ bucket, name, label, hint, placeholder, rows = 3, maxLength, autoComplete }: AreaProps) {
  const { errors } = useForm();
  const value = useValue(bucket, name);
  const set = useSetter(bucket, name);
  return (
    <Field id={name} label={label} required hint={hint} error={errors[name]}>
      <Textarea
        id={name}
        data-field={name}
        rows={rows}
        maxLength={maxLength}
        autoComplete={autoComplete ?? "off"}
        value={value}
        placeholder={placeholder}
        onChange={(event) => set(event.target.value)}
        className="min-h-[80px] resize-y"
      />
      {maxLength !== undefined && (
        <p
          className={cn(
            "mt-1 text-right text-xs",
            value.length >= maxLength ? "font-medium text-danger-fg" : value.length >= maxLength * 0.9 ? "text-warning-fg" : "text-gray-500",
          )}
        >
          {value.length} / {maxLength} karakter
        </p>
      )}
    </Field>
  );
}

export function SelectField({ bucket, name, label, hint, required = true, placeholder, options }: { bucket: StepId; name: string; label: ReactNode; hint?: ReactNode; required?: boolean; placeholder: string; options: readonly { value: string; label: string }[] }) {
  const { errors } = useForm();
  const value = useValue(bucket, name);
  const set = useSetter(bucket, name);
  return (
    <Field id={name} label={label} required={required} hint={hint} error={errors[name]}>
      <Select id={name} data-field={name} value={value} onChange={(event) => set(event.target.value)} className="max-w-[200px]">
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

// ─── Choices

/** A radio card: the input inside a bordered label that fills when chosen. The ring shows when the keyboard is on the input. */
const CARD =
  "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border-2 px-4 py-2.5 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-blue has-[:focus-visible]:ring-offset-2";
const card = (active: boolean, extra?: string) =>
  cn(CARD, active ? "border-primary-blue bg-primary-blue/5 font-semibold text-primary-blue" : "border-gray-200 text-gray-700 hover:border-gray-300", extra);

const GRID = { 1: "grid grid-cols-1 gap-2", 2: "grid grid-cols-1 gap-2 sm:grid-cols-2", 3: "grid grid-cols-1 gap-2 sm:grid-cols-3" } as const;

interface ChoiceProps {
  bucket: StepId;
  name: string;
  label: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  options: readonly { value: string; label: string }[];
  columns?: 1 | 2 | 3;
}

/** One answer out of a few, as a row of radio cards. */
export function ChoiceField({ bucket, name, label, required = true, hint, options, columns = 2 }: ChoiceProps) {
  const { errors } = useForm();
  const value = useValue(bucket, name);
  const set = useSetter(bucket, name);
  return (
    <Field group id={name} label={label} required={required} hint={hint} error={errors[name]}>
      <div className={GRID[columns]} data-field={name}>
        {options.map((option) => (
          <label key={option.value} className={card(value === option.value)}>
            <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => set(option.value)} className="size-4 accent-primary-blue" />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </Field>
  );
}

/** "Apakah ada ...?": Ya or Tidak, stored as a boolean. */
export function YesNoField({ bucket, name, label, required = false, hint, yes = "Ya", no = "Tidak", onChange }: { bucket: StepId; name: string; label: ReactNode; required?: boolean; hint?: ReactNode; yes?: string; no?: string; onChange?: (value: boolean) => void }) {
  const { values, errors } = useForm();
  const value = (values[bucket] as unknown as Bucket)[name] === true;
  const set = useSetter(bucket, name);
  return (
    <Field group id={name} label={label} required={required} hint={hint} error={errors[name]}>
      <div className="grid max-w-xs grid-cols-2 gap-2" data-field={name}>
        {[
          { on: true, text: yes },
          { on: false, text: no },
        ].map((option) => (
          <label key={String(option.on)} className={card(value === option.on, "justify-center")}>
            <input
              type="radio"
              name={name}
              checked={value === option.on}
              onChange={() => {
                set(option.on);
                onChange?.(option.on);
              }}
              className="size-4 accent-primary-blue"
            />
            <span>{option.text}</span>
          </label>
        ))}
      </div>
    </Field>
  );
}

/** A few ready answers and "Lainnya" with a box to write in (the occupations, how the student is related to another earner). */
export function ChoiceOrOtherField({ bucket, name, label, required = true, hint, options, columns = 2, otherPlaceholder }: Omit<ChoiceProps, "options"> & { options: readonly string[]; otherPlaceholder: string }) {
  const { errors } = useForm();
  const value = useValue(bucket, name);
  const set = useSetter(bucket, name);
  const other = useRef<HTMLInputElement>(null);
  const wantsFocus = useRef(false);
  const preset = options.includes(value);
  const otherActive = value !== "" && !preset;

  // The box takes focus when the student chooses "Lainnya", not when a saved answer is drawn on a screen that just opened.
  useEffect(() => {
    if (wantsFocus.current && other.current) {
      other.current.focus();
      wantsFocus.current = false;
    }
  });

  return (
    <Field group id={name} label={label} required={required} hint={hint} error={errors[name]}>
      <div className="space-y-2">
        <div className={GRID[columns]} data-field={name}>
          {options.map((option) => (
            <label key={option} className={card(value === option)}>
              <input type="radio" name={name} checked={value === option} onChange={() => set(option)} className="size-4 accent-primary-blue" />
              <span>{option}</span>
            </label>
          ))}
          <label className={card(otherActive)}>
            <input
              type="radio"
              name={name}
              checked={otherActive}
              onChange={() => {
                wantsFocus.current = true;
                // A single space is "Lainnya, nothing written yet": the box opens, and the rules still ask for an answer.
                set(otherActive ? value : " ");
              }}
              className="size-4 accent-primary-blue"
            />
            <span>Lainnya</span>
          </label>
        </div>
        {otherActive && <Input ref={other} type="text" aria-label="Lainnya" value={value.trim() === "" ? "" : value} placeholder={otherPlaceholder} autoComplete="off" onChange={(event) => set(event.target.value || " ")} />}
      </div>
    </Field>
  );
}
