"use client";

/**
 * Choice controls shared across the steps of the multi-step recruitment
 * wizard. Labels, inputs and errors come from `components/ui/field`.
 */

import { Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";

/** Radio card: the input sits inside a bordered label that fills when chosen. */
function choiceClass(active: boolean, extra?: string) {
  return cn(
    "flex items-center gap-2.5 px-4 py-2.5 border-2 rounded-xl cursor-pointer transition-colors text-sm",
    active
      ? "border-primary-blue bg-primary-blue/5 text-primary-blue font-semibold"
      : "border-gray-200 hover:border-gray-300 text-gray-700",
    extra,
  );
}

export type FieldErrors = Record<string, string | undefined>;

/** A row of radio buttons rendered as pill-style cards. */
export function RadioGroup<T extends string>({
  name,
  value,
  onChange,
  options,
  columns = 2,
}: {
  name: string;
  value: T | "";
  onChange: (v: T) => void;
  options: readonly { value: T; label: string }[];
  columns?: 1 | 2 | 3;
}) {
  const gridCls =
    columns === 1
      ? "grid grid-cols-1 gap-2"
      : columns === 2
        ? "grid grid-cols-1 sm:grid-cols-2 gap-2"
        : "grid grid-cols-1 sm:grid-cols-3 gap-2";
  return (
    <div className={gridCls}>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <label
            key={opt.value}
            className={choiceClass(active)}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={active}
              onChange={() => onChange(opt.value)}
              className="w-4 h-4 accent-primary-blue"
            />
            <span>{opt.label}</span>
          </label>
        );
      })}
    </div>
  );
}

/** Radio group with an "Other: [text]" option that stores the entered value directly. */
export function RadioGroupWithOther({
  name,
  value,
  onChange,
  options,
  columns = 2,
  otherLabel = "Lainnya",
  otherPlaceholder = "Sebutkan…",
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  columns?: 1 | 2 | 3;
  otherLabel?: string;
  otherPlaceholder?: string;
}) {
  const isPreset = options.includes(value);
  const otherActive = value !== "" && !isPreset;
  const gridCls =
    columns === 1
      ? "grid grid-cols-1 gap-2"
      : columns === 2
        ? "grid grid-cols-1 sm:grid-cols-2 gap-2"
        : "grid grid-cols-1 sm:grid-cols-3 gap-2";
  return (
    <div className="space-y-2">
      <div className={gridCls}>
        {options.map((opt) => {
          const active = value === opt;
          return (
            <label
              key={opt}
              className={choiceClass(active)}
            >
              <input
                type="radio"
                name={name}
                checked={active}
                onChange={() => onChange(opt)}
                className="w-4 h-4 accent-primary-blue"
              />
              <span>{opt}</span>
            </label>
          );
        })}
        <label
          className={choiceClass(otherActive)}
        >
          <input
            type="radio"
            name={name}
            checked={otherActive}
            onChange={() => onChange(otherActive ? value : " ")}
            className="w-4 h-4 accent-primary-blue"
          />
          <span>{otherLabel}</span>
        </label>
      </div>
      {otherActive && (
        <Input
          type="text"
          value={value.trim() === "" ? "" : value}
          placeholder={otherPlaceholder}
          aria-label={otherLabel}
          onChange={(e) => onChange(e.target.value || " ")}
          autoFocus
        />
      )}
    </div>
  );
}

/** Simple toggle for "apakah ada X?" gating. */
export function YesNoToggle({
  name,
  value,
  onChange,
  yesLabel = "Ya",
  noLabel = "Tidak",
}: {
  name: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
  yesLabel?: string;
  noLabel?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 max-w-xs">
      {[
        { v: true, label: yesLabel },
        { v: false, label: noLabel },
      ].map((opt) => {
        const active = value === opt.v;
        return (
          <label
            key={String(opt.v)}
            className={choiceClass(active, "justify-center gap-2")}
          >
            <input
              type="radio"
              name={name}
              checked={active}
              onChange={() => onChange(opt.v)}
              className="w-4 h-4 accent-primary-blue"
            />
            <span>{opt.label}</span>
          </label>
        );
      })}
    </div>
  );
}
