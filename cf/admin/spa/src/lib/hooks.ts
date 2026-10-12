import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

/** The browser tab title, "Judul | Admin Sakola Kembara" (the legacy admin's template). */
export function usePageTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (title) document.title = `${title} | Admin Sakola Kembara`;
  }, [title]);
}

/**
 * Runs one async task at a time. A second call while one is in flight is
 * ignored, which stops a double click or a double Enter from sending a form
 * twice. A ref guards it, not the `pending` state: two submits can arrive
 * before React has re-rendered with the disabled button.
 */
export function useSubmitLock() {
  const locked = useRef(false);
  const [pending, setPending] = useState(false);
  const run = useCallback(async (task: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    try {
      await task();
    } finally {
      locked.current = false;
      setPending(false);
    }
  }, []);
  return { pending, run };
}

/**
 * Focuses a field when the page opens, but only with a mouse-like pointer: on a
 * phone it would open the keyboard and scroll the page before anyone read it.
 * Where the browser cannot tell (no matchMedia), it focuses.
 */
export function useAutoFocus(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const finePointer = typeof window.matchMedia !== "function" || window.matchMedia("(pointer: fine)").matches;
    if (finePointer) ref.current?.focus();
  }, [ref]);
}

/** After a failed validation, puts the cursor in the first field with an error. */
export function focusFirstInvalid(form: HTMLFormElement | null, order: readonly string[], errors: Record<string, unknown>): void {
  if (!form) return;
  const name = order.find((field) => errors[field]);
  if (!name) return;
  const element = form.elements.namedItem(name);
  if (element instanceof HTMLElement) element.focus();
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps keyboard focus inside `containerRef` while it is mounted (a modal
 * drawer): focus moves in on open, Tab and Shift+Tab wrap around, Escape calls
 * `onEscape`, and when the container goes away focus returns to `restoreTo`
 * (the button that opened it), unless the page already moved focus somewhere
 * on purpose. `restoreTo` is needed because by the time this runs the opener
 * may no longer be the active element: Safari does not focus a button on click,
 * and making the page behind inert blurs a focused button.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  onEscape: () => void,
  restoreTo?: RefObject<HTMLElement | null>,
): void {
  const escape = useRef(onEscape);
  useEffect(() => {
    escape.current = onEscape;
  });

  useEffect(() => {
    const found = containerRef.current;
    if (!found) return;
    const container: HTMLElement = found;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));

    (focusables()[0] ?? container).focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        escape.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0] as HTMLElement;
      const last = items[items.length - 1] as HTMLElement;
      const active = document.activeElement;
      const inside = active instanceof Node && container.contains(active);
      if (event.shiftKey && (!inside || active === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const active = document.activeElement;
      const focusLost = !active || active === document.body || container.contains(active);
      const target = restoreTo?.current ?? opener;
      if (focusLost && target?.isConnected) target.focus();
    };
  }, [containerRef, restoreTo]);
}
