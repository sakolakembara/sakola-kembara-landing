import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";

// A notice that survives a route change ("Pengumuman berhasil disimpan." on the list the form just returned
// to). It travels in the navigation's history state, so it needs no global store and no timing:
//
//   navigate("/announcements", { state: flashState({ tone: "success", text: "Pengumuman berhasil disimpan." }) });
//
// and the screen that shows it calls `useFlash()` and renders `<Flash />`. Once it has been read it is
// removed from the history entry, so reloading the page does not show it again. A notice raised on the page
// itself (a delete from the list) goes through `show`.

export interface FlashMessage {
  tone: "success" | "danger";
  text: string;
}

/** The `state` for `navigate(to, { state })`. */
export function flashState(message: FlashMessage): { flash: FlashMessage } {
  return { flash: message };
}

/** The notice inside a location's `state`, or null: anything else in `state` is not ours. */
export function readFlash(state: unknown): FlashMessage | null {
  if (state === null || typeof state !== "object") return null;
  const flash = (state as { flash?: unknown }).flash;
  if (flash === null || typeof flash !== "object") return null;
  const { tone, text } = flash as { tone?: unknown; text?: unknown };
  return (tone === "success" || tone === "danger") && typeof text === "string" && text !== "" ? { tone, text } : null;
}

export interface FlashControl {
  flash: FlashMessage | null;
  show(message: FlashMessage): void;
  dismiss(): void;
}

export function useFlash(): FlashControl {
  const location = useLocation();
  const navigate = useNavigate();
  const [flash, setFlash] = useState<FlashMessage | null>(() => readFlash(location.state));

  // A notice that arrived with this navigation: keep it here, and take it out of the history entry.
  useEffect(() => {
    const incoming = readFlash(location.state);
    if (!incoming) return;
    setFlash(incoming);
    navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, { replace: true, state: null });
  }, [location.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const show = useCallback((message: FlashMessage) => setFlash(message), []);
  const dismiss = useCallback(() => setFlash(null), []);
  return { flash, show, dismiss };
}
