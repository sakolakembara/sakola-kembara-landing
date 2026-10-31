import { useCallback, useEffect, useMemo, useState } from "react";

// Which rows of a list are ticked. The choice belongs to the rows on screen: a new page, search, filter or sort is
// another set of rows (`resetKey` changes), so it starts empty rather than carrying ticks the person can no longer
// see. A row that left the page (deleted, or gone after a reload) is not counted either.

export interface Selection<T> {
  /** The ticked rows that are on the page, in the page's order. */
  rows: T[];
  /** Their ids. */
  ids: ReadonlySet<string>;
  toggle(id: string): void;
  /** Ticks the whole page, or unticks it when all of it already is. */
  toggleAll(): void;
  clear(): void;
  /** Unticks some rows (the ones an action went through for). */
  drop(ids: readonly string[]): void;
}

export function useSelection<T>(rows: readonly T[], rowKey: (row: T) => string, resetKey: string): Selection<T> {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => setTicked(new Set()), [resetKey]);

  const chosen = useMemo(() => rows.filter((row) => ticked.has(rowKey(row))), [rows, rowKey, ticked]);
  const ids = useMemo(() => new Set(chosen.map(rowKey)), [chosen, rowKey]);

  const toggle = useCallback(
    (id: string) =>
      setTicked((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );

  const toggleAll = useCallback(() => {
    const page = rows.map(rowKey);
    setTicked((current) => (page.length > 0 && page.every((id) => current.has(id)) ? new Set([...current].filter((id) => !page.includes(id))) : new Set([...current, ...page])));
  }, [rows, rowKey]);

  const clear = useCallback(() => setTicked(new Set()), []);
  const drop = useCallback((dropped: readonly string[]) => setTicked((current) => new Set([...current].filter((id) => !dropped.includes(id)))), []);

  return { rows: chosen, ids, toggle, toggleAll, clear, drop };
}
