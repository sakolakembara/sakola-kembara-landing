import { ChevronDown } from "lucide-react";
import { type ComponentProps, type KeyboardEvent, useEffect, useId, useState } from "react";
import { cn } from "@/lib/cn";
import { Input } from "./field";

// A box to choose ONE of a list that is not free text (cf/admin/DESIGN.md section 2): the ARIA 1.2 editable combobox with list
// autocomplete. The input is the combobox, the list under it its listbox, and the option under the arrows is its
// `aria-activedescendant`, so a screen reader reads it while the focus stays in the box. Typing narrows the list; Enter or a
// press chooses; Escape closes; leaving the box with something that is not an option puts the chosen one back (the value is
// always one of the options, or what it was). Enter never reaches the page's form: choosing is not saving.
// Inside a `Field` it is labelled and described like an `Input`.

export interface ComboboxOption {
  value: string;
  label: string;
  /** Said beside the label in a quieter voice ("nama lama"). */
  hint?: string;
}

export interface ComboboxProps extends Omit<ComponentProps<"input">, "value" | "onChange" | "role" | "type" | "children" | "size"> {
  value: string;
  options: ComboboxOption[];
  onChange: (value: string) => void;
  /** What the list says when no option matches what was typed. */
  emptyText?: string;
}

export function Combobox({ value, options, onChange, emptyText = "Tidak ada yang cocok.", className, onBlur, onKeyDown, ...props }: ComboboxProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  // What the person has typed; null while the box shows the chosen option (or the value, when it is not one of them).
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  const chosen = options.find((option) => option.value === value);
  const shown = query ?? chosen?.label ?? value;
  const wanted = (query ?? "").trim().toLowerCase();
  const visible = wanted === "" ? options : options.filter((option) => option.label.toLowerCase().includes(wanted));
  const current = open ? visible[active] : undefined;
  const optionId = (option: ComboboxOption) => `${listId}-${options.indexOf(option)}`;

  useEffect(() => {
    if (current) document.getElementById(optionId(current))?.scrollIntoView?.({ block: "nearest" });
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps

  function show() {
    setActive(Math.max(0, options.findIndex((option) => option.value === value)));
    setOpen(true);
  }

  function choose(option: ComboboxOption) {
    onChange(option.value);
    setQuery(null);
    setOpen(false);
  }

  function close() {
    setQuery(null);
    setOpen(false);
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) show();
      else if (visible.length > 0) setActive((now) => (now + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (current) choose(current);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  return (
    <div className="relative">
      <Input
        {...props}
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={current ? optionId(current) : undefined}
        value={shown}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onClick={() => {
          if (!open) show();
        }}
        onKeyDown={keyDown}
        onBlur={(event) => {
          onBlur?.(event);
          // Free text is not a value: what was typed is taken if it is exactly an option, and put back otherwise.
          const typed = query?.trim().toLowerCase();
          const same = typed ? options.find((option) => option.label.toLowerCase() === typed) : undefined;
          if (same) choose(same);
          else close();
        }}
        className={cn("pr-9", className)}
      />
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-gray-500" />
      {open && (
        <ul id={listId} role="listbox" aria-label="Pilihan" className="absolute inset-x-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg">
          {visible.map((option, index) => (
            <li
              key={option.value}
              id={optionId(option)}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => setActive(index)}
              onClick={() => choose(option)}
              className={cn("flex cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-2 text-sm text-foreground", index === active && "bg-gray-100", option.value === value && "font-semibold")}
            >
              <span className="min-w-0 truncate">{option.label}</span>
              {option.hint && <span className="shrink-0 text-xs font-normal text-muted-foreground">{option.hint}</span>}
            </li>
          ))}
          {visible.length === 0 && <li role="presentation" className="px-2.5 py-2 text-sm text-muted-foreground">{emptyText}</li>}
        </ul>
      )}
    </div>
  );
}
