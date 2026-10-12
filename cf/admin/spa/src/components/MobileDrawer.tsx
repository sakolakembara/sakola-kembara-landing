import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import { useFocusTrap } from "~/lib/hooks";

/**
 * The menu on phones: a panel that slides in from the left over a dark
 * backdrop. It is a modal dialog, so keyboard focus is held inside it (Tab
 * wraps), Escape closes it, and focus goes back to the menu button afterwards.
 * It is only mounted while open. Below `md` only; the desktop sidebar is a
 * separate element.
 */
export function MobileDrawer({
  onClose,
  restoreFocusTo,
  children,
}: {
  onClose: () => void;
  /** The menu button: where focus goes when the drawer closes. */
  restoreFocusTo: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(panel, onClose, restoreFocusTo);

  // Nothing behind the panel should scroll while it is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <>
      {/* Tapping outside closes it. Not a button: keyboard users have Escape and the close button. */}
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-40 bg-black/50 md:hidden" />
      <div
        ref={panel}
        id="mobile-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Menu navigasi"
        tabIndex={-1}
        className="fixed left-0 top-0 z-50 flex h-dvh w-64 flex-col bg-gray-900 p-6 text-white transition-transform duration-200 ease-out starting:-translate-x-full motion-reduce:transition-none md:hidden"
      >
        {children}
      </div>
    </>
  );
}
