"use client";

/**
 * Small building blocks shared across every step of the multi-step recruitment
 * wizard. Keeping these here avoids duplicating input/label markup across 7+
 * step files.
 */

import type { ReactNode } from "react";

export const TEXT_INPUT =
  "w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-primary-blue focus:outline-none text-sm";

export const TEXTAREA =
  "w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-primary-blue focus:outline-none text-sm resize-y min-h-[120px]";

export type FieldErrors = Record<string, string | undefined>;

export function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="block text-sm font-semibold text-gray-800 mb-2"
      >
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {!error && hint && (
        <div className="text-xs text-gray-500 mt-1.5 leading-relaxed">
          {hint}
        </div>
      )}
      {error && (
        <p className="text-xs text-red-600 mt-1.5">{error}</p>
      )}
    </div>
  );
}

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
            className={`flex items-center gap-2.5 px-4 py-2.5 border-2 rounded-lg cursor-pointer transition-colors text-sm ${
              active
                ? "border-primary-blue bg-primary-blue/5 text-primary-blue font-semibold"
                : "border-gray-200 hover:border-gray-300 text-gray-700"
            }`}
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
              className={`flex items-center gap-2.5 px-4 py-2.5 border-2 rounded-lg cursor-pointer transition-colors text-sm ${
                active
                  ? "border-primary-blue bg-primary-blue/5 text-primary-blue font-semibold"
                  : "border-gray-200 hover:border-gray-300 text-gray-700"
              }`}
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
          className={`flex items-center gap-2.5 px-4 py-2.5 border-2 rounded-lg cursor-pointer transition-colors text-sm ${
            otherActive
              ? "border-primary-blue bg-primary-blue/5 text-primary-blue font-semibold"
              : "border-gray-200 hover:border-gray-300 text-gray-700"
          }`}
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
        <input
          type="text"
          value={value.trim() === "" ? "" : value}
          placeholder={otherPlaceholder}
          onChange={(e) => onChange(e.target.value || " ")}
          className={TEXT_INPUT}
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
            className={`flex items-center justify-center gap-2 px-4 py-2.5 border-2 rounded-lg cursor-pointer transition-colors text-sm ${
              active
                ? "border-primary-blue bg-primary-blue/5 text-primary-blue font-semibold"
                : "border-gray-200 hover:border-gray-300 text-gray-700"
            }`}
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
