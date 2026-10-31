import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

// Which columns of a list the person wants (the "Kolom" menu). The first column, the one that names the row, always
// shows. The choice is kept in the browser per list (`localStorage`, which can be missing or throw: then every
// column shows each time), as the sidebar's is: it is a per-person convenience, never something to rely on.

const KEY = "sakem-admin:columns:";

function readHidden(id: string): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY + id) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : []);
  } catch {
    return new Set();
  }
}

function writeHidden(id: string, hidden: ReadonlySet<string>): void {
  try {
    if (hidden.size === 0) window.localStorage.removeItem(KEY + id);
    else window.localStorage.setItem(KEY + id, JSON.stringify([...hidden]));
  } catch {
    // Not kept: nothing else depends on it.
  }
}

interface Choosable {
  key: string;
  header: ReactNode;
}

export interface ColumnChoice<C extends Choosable> {
  /** The columns to draw. */
  shown: C[];
  /** What the menu offers: every column but the first, and none without a text header to name it by. */
  options: { key: string; label: string; shown: boolean }[];
  toggle(key: string): void;
  /** Some column the menu offers is off. */
  anyHidden: boolean;
  showAll(): void;
}

export function useColumnChoice<C extends Choosable>(id: string, columns: readonly C[]): ColumnChoice<C> {
  const [hidden, setHidden] = useState(() => readHidden(id));

  useEffect(() => writeHidden(id, hidden), [id, hidden]);

  const options = useMemo(
    () => columns.slice(1).flatMap((column) => (typeof column.header === "string" ? [{ key: column.key, label: column.header, shown: !hidden.has(column.key) }] : [])),
    [columns, hidden],
  );
  // A stored key of a column that no longer exists (or no longer can be hidden) is ignored.
  const offered = useMemo(() => new Set(options.map((option) => option.key)), [options]);
  const shown = useMemo(() => columns.filter((column, index) => index === 0 || !offered.has(column.key) || !hidden.has(column.key)), [columns, hidden, offered]);

  const toggle = useCallback(
    (key: string) =>
      setHidden((current) => {
        const next = new Set(current);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
    [],
  );
  const showAll = useCallback(() => setHidden(new Set()), []);

  return { shown, options, toggle, anyHidden: options.some((option) => !option.shown), showAll };
}
