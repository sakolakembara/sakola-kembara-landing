import { useSyncExternalStore } from "react";

// Whether the window is at least `md` wide (Tailwind's 768 px): the frame with the sidebar and the white top bar, as
// opposed to the phone's navy bar. A page that puts its own controls in that top bar needs to know which one it is in,
// because CSS alone would leave two copies of every button in the page. Without `matchMedia` (jsdom) the answer is yes,
// so a test sees the desktop frame unless it stubs the query.

function matches(query: string): boolean {
  return typeof window.matchMedia !== "function" || window.matchMedia(query).matches;
}

function useMatches(query: string): boolean {
  const subscribe = (notify: () => void) => {
    if (typeof window.matchMedia !== "function") return () => {};
    const list = window.matchMedia(query);
    list.addEventListener("change", notify);
    return () => list.removeEventListener("change", notify);
  };
  return useSyncExternalStore(
    subscribe,
    () => matches(query),
    () => true,
  );
}

export function useIsDesktop(): boolean {
  return useMatches("(min-width: 768px)");
}

/** At least `lg` (1024 px): where a page has room for a column beside its list (the Media page's panel); below it the same content opens in a window. */
export function useIsWide(): boolean {
  return useMatches("(min-width: 1024px)");
}
