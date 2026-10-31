import { type FocusEvent, type KeyboardEvent, type RefObject, useCallback, useEffect, useId, useRef, useState } from "react";

// The behaviour of a small panel that opens from a button (the user menu, the column menu, a row's menu). It is a
// disclosure, not an ARIA menu: the button comes first in the page and the panel right after it, so Tab walks from
// one into the other and no arrow-key handling is promised. Escape (focus goes back to the button), a press outside
// and Tab out of it close it.
//
//   const menu = useDisclosure();
//   <div {...menu.rootProps}>
//     <button ref={menu.trigger} onClick={menu.toggle} aria-expanded={menu.open} aria-controls={menu.open ? menu.panelId : undefined}>
//     {menu.open && <div id={menu.panelId}>...</div>}
//   </div>

export interface Disclosure {
  open: boolean;
  toggle(): void;
  close(): void;
  trigger: RefObject<HTMLButtonElement | null>;
  panelId: string;
  /** Spread on the element that holds both the button and the panel. */
  rootProps: {
    ref: RefObject<HTMLDivElement | null>;
    onKeyDown(event: KeyboardEvent): void;
    onBlur(event: FocusEvent): void;
  };
}

export function useDisclosure(): Disclosure {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const toggle = useCallback(() => setOpen((current) => !current), []);
  const close = useCallback(() => setOpen(false), []);

  return {
    open,
    toggle,
    close,
    trigger,
    panelId,
    rootProps: {
      ref: root,
      onKeyDown: (event) => {
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      },
      onBlur: (event) => {
        // Focus moved to something outside (Tab); a press on plain text inside has no target and is left alone.
        if (event.relatedTarget && !root.current?.contains(event.relatedTarget as Node)) setOpen(false);
      },
    },
  };
}
