import { type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The tabs of an editor page, under the top bar and sticking to it while the page scrolls (cf/admin/DESIGN.md, "Forms:
 * one bar"). The ARIA pattern: one tab in the tab order (the selected one), arrow keys, Home and End move between
 * them (the strip is padded so the labels, which have 14 px of their own, line up with the page's edge), and each tab names the panel it controls (`panel-<id>`; the page gives its panels those ids and
 * `aria-labelledby="tab-<id>"`). A tab with an error shows a red dot that a screen reader reads out.
 */
export interface PageTabItem<T extends string> {
  id: T;
  label: ReactNode;
  invalid?: boolean;
}

export function PageTabs<T extends string>({ tabs, value, onChange, label }: { tabs: PageTabItem<T>[]; value: T; onChange: (next: T) => void; label: string }) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.id === value);
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    onChange(tabs[next].id);
    document.getElementById(`tab-${tabs[next].id}`)?.focus();
  }

  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="sticky top-0 z-10 flex gap-0.5 overflow-x-auto border-b border-border bg-card px-0.5 md:px-[26px]">
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative -mb-px inline-flex h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3.5 text-sm font-medium transition-colors",
              selected ? "border-primary text-primary" : "border-transparent text-gray-600 hover:text-gray-900",
            )}
          >
            {tab.label}
            {tab.invalid && <span className="size-2 rounded-full bg-danger-fg" role="img" aria-label="Ada kesalahan" />}
          </button>
        );
      })}
    </div>
  );
}
