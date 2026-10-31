import { Ellipsis, type LucideIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useDisclosure } from "~/lib/use-disclosure";

/**
 * The "..." of a row: the actions that are not the one a row is for, behind one button ("Aksi lainnya untuk <name>").
 * A disclosure (`useDisclosure`), not an ARIA menu: ordinary buttons in a panel, so Tab walks through them.
 *
 * The panel is `position: fixed`, placed from the button on opening: a table clips what sticks out of its card, and a
 * panel inside the last row would be cut off. It opens downward, or upward when there is no room below, and closes
 * when the page scrolls or the window changes size enough to move its button (it would be left hanging where the row
 * used to be); a scroll that leaves the button where it was does not close it.
 */
export interface RowMenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect(): void;
  /** Red: it cannot be undone. */
  destructive?: boolean;
  disabled?: boolean;
}

const GAP = 4;

export function RowMenu({ name, items }: { name: string; items: readonly RowMenuItem[] }) {
  const menu = useDisclosure();
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; right: number } | null>(null);

  // Measured once the panel exists: below the button when it fits, else above.
  useLayoutEffect(() => {
    if (!menu.open) {
      setPlace(null);
      return;
    }
    const button = menu.trigger.current?.getBoundingClientRect();
    if (!button) return;
    const height = panel.current?.offsetHeight ?? 0;
    const fitsBelow = button.bottom + GAP + height <= window.innerHeight;
    setPlace({ top: fitsBelow ? button.bottom + GAP : Math.max(GAP, button.top - GAP - height), right: Math.max(GAP, window.innerWidth - button.right) });
    const close = () => {
      const now = menu.trigger.current?.getBoundingClientRect();
      if (!now || Math.abs(now.top - button.top) > 1 || Math.abs(now.left - button.left) > 1) menu.close();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu.open, menu.trigger, menu.close]);

  return (
    <div {...menu.rootProps} className="relative inline-flex">
      <button
        ref={menu.trigger}
        type="button"
        onClick={menu.toggle}
        aria-label={`Aksi lainnya untuk ${name}`}
        title="Aksi lainnya"
        aria-expanded={menu.open}
        aria-controls={menu.open ? menu.panelId : undefined}
        className="inline-flex min-h-10 items-center justify-center rounded-lg px-2.5 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 md:min-h-[34px] [&_svg]:size-4"
      >
        <Ellipsis aria-hidden="true" />
      </button>
      {menu.open && (
        <div
          ref={panel}
          id={menu.panelId}
          style={place ? { top: place.top, right: place.right } : { top: 0, right: 0, visibility: "hidden" }}
          className="fixed z-50 min-w-44 rounded-xl border border-border bg-card p-1.5 text-left shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              disabled={item.disabled}
              onClick={() => {
                menu.close();
                item.onSelect();
              }}
              className={cn(
                "flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
                item.destructive ? "text-red-700 hover:bg-danger-bg hover:text-red-800" : "text-gray-800 hover:bg-gray-50",
              )}
            >
              <item.icon aria-hidden="true" />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
