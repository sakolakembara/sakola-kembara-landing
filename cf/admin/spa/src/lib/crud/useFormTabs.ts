import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

/**
 * The tab of a form page that has tabs (cf/admin/DESIGN.md, "Forms: one bar"): which one is open, and what the errors
 * do to it. A refused save opens the tab that holds the first error; a tab with an error is marked (`errorTabs`); and a
 * link of the error summary shows its field's tab before the summary tries to put the cursor there (a control on a tab
 * that is not open cannot take focus).
 *
 * `tabOf` says which tab a field is on, by the name the Worker gives its error: a function, not a table, since a list
 * of rows has errors named "educationHistory.1.institution". A field it does not know leaves the tab as it is.
 * `onReveal` is for what a field needs besides its tab (the blog's text must leave the preview to be written in).
 */
export function useFormTabs<T extends string>({
  initial,
  tabOf,
  fields,
  failures,
  onReveal,
}: {
  initial: T;
  tabOf: (field: string) => T | undefined;
  /** The Worker's errors by field name (`useMutation().fields`). */
  fields: Record<string, string>;
  /** `useMutation().failures`: it counts the refused saves, so the first error is looked at once per refusal. */
  failures: number;
  onReveal?: (field: string) => void;
}): { tab: T; setTab: Dispatch<SetStateAction<T>>; errorTabs: Set<T> } {
  const [tab, setTab] = useState<T>(initial);
  // What the two effects below read is read when they run, not when they were set up.
  const latest = useRef({ tabOf, onReveal, fields });
  latest.current = { tabOf, onReveal, fields };

  const errorTabs = new Set<T>();
  for (const name of Object.keys(fields)) {
    const wanted = tabOf(name);
    if (wanted) errorTabs.add(wanted);
  }

  useEffect(() => {
    const first = Object.keys(latest.current.fields)[0];
    const wanted = first ? latest.current.tabOf(first) : undefined;
    if (!first || !wanted) return;
    setTab(wanted);
    latest.current.onReveal?.(first);
  }, [failures]);

  useEffect(() => {
    const reveal = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href^='#']") : null;
      const name = link?.getAttribute("href")?.slice(1);
      const wanted = name ? latest.current.tabOf(name) : undefined;
      if (!name || !wanted) return;
      flushSync(() => {
        setTab(wanted);
        latest.current.onReveal?.(name);
      });
    };
    document.addEventListener("click", reveal, true);
    return () => document.removeEventListener("click", reveal, true);
  }, []);

  return { tab, setTab, errorTabs };
}
