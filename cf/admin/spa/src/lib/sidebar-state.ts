import { useCallback, useEffect, useState } from "react";

// Whether the desktop sidebar is collapsed to its icon rail. The choice is kept in the browser (a per-person
// convenience, so `localStorage`, which can be missing or throw: then it just starts open each time). Ctrl+B or
// ⌘B toggles it, like the sidebar of the editors people already know.

// `spa/index.html` reads this key too (its inline script), to draw the rail before any script has run.
const KEY = "sakem-admin:sidebar";

/** What was kept: the skeleton drawn before the session is known reads it too, without the hook's keyboard listener. */
export function readSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "collapsed";
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(KEY, collapsed ? "collapsed" : "open");
  } catch {
    // Not kept: nothing else depends on it.
  }
}

/** Typing in a field: the shortcut must leave Ctrl+B to the field (bold in an editor, for one). */
function isTyping(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])") !== null;
}

export function useSidebarCollapsed(): { collapsed: boolean; toggle: () => void } {
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed);
  const toggle = useCallback(() => setCollapsed((current) => !current), []);

  useEffect(() => writeCollapsed(collapsed), [collapsed]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "b") return;
      if (isTyping(event.target)) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  return { collapsed, toggle };
}
