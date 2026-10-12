import { type ChangeEvent, useCallback, useMemo, useRef, useState } from "react";

// The values of a form and whether they differ from what was loaded (docs/cloudflare/admin-crud.md#15-the-spa-kit).
// Controlled inputs, plain objects; `dirty` is what the unsaved-changes guard watches.
//
// The edit screen loads the item first and renders the form only then, keyed by the item's version
// (`<Form key={item.updatedAt} initial={toValues(item)} />`), so "Muat ulang" after a stale save simply
// mounts a fresh form with the fresh values. `reset` is for the rare form that has to start over in place.

export type FormValues = Record<string, string | boolean>;

export interface FormState<T extends FormValues> {
  values: T;
  /** Differs from the values the form started with (or was last `reset` to). */
  dirty: boolean;
  set<K extends keyof T>(name: K, value: T[K]): void;
  /** Props for an `<Input>`, `<Textarea>` or `<Select>` whose value is a string: `id` and `name` are the field's name, so the error summary can link to it. */
  field(name: keyof T & string): { id: string; name: string; value: string; onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void };
  /** Props for a checkbox whose value is a boolean. */
  checkbox(name: keyof T & string): { id: string; name: string; checked: boolean; onChange: (event: ChangeEvent<HTMLInputElement>) => void };
  /** Starts over from `next` (or from the first values), and calls them the new "saved" state. */
  reset(next?: T): void;
}

export function useFormValues<T extends FormValues>(initial: T): FormState<T> {
  const baseline = useRef(initial);
  const [values, setValues] = useState<T>(initial);

  const dirty = useMemo(() => Object.keys(baseline.current).some((key) => baseline.current[key] !== values[key]) || Object.keys(values).length !== Object.keys(baseline.current).length, [values]);

  const set = useCallback(<K extends keyof T>(name: K, value: T[K]) => setValues((previous) => ({ ...previous, [name]: value })), []);

  return {
    values,
    dirty,
    set,
    field: (name) => ({
      id: name,
      name,
      value: String(values[name] ?? ""),
      onChange: (event) => set(name, event.target.value as T[typeof name]),
    }),
    checkbox: (name) => ({
      id: name,
      name,
      checked: values[name] === true,
      onChange: (event) => set(name, event.target.checked as T[typeof name]),
    }),
    reset: (next) => {
      baseline.current = next ?? baseline.current;
      setValues(next ?? baseline.current);
    },
  };
}
