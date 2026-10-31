import { useSyncExternalStore } from "react";

// Whether the window is at least `md` wide (Tailwind's 768 px): the frame with the sidebar and the white top bar, as
// opposed to the phone's navy bar. A page that puts its own controls in that top bar needs to know which one it is in,
// because CSS alone would leave two copies of every button in the page. Without `matchMedia` (jsdom) the answer is yes,
// so a test sees the desktop frame unless it stubs the query.

const QUERY = "(min-width: 768px)";

function subscribe(notify: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(QUERY);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

const read = () => typeof window.matchMedia !== "function" || window.matchMedia(QUERY).matches;

export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, read, () => true);
}
