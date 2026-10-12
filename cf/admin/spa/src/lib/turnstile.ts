import { useCallback, useMemo, useRef, useState } from "react";
import type { TurnstileAction } from "./captcha";

// Cloudflare Turnstile in the browser: the script loader and the state a form
// needs (a token to send, and to throw away after each use). The widget itself
// is components/TurnstileWidget.tsx. No package: the script is Cloudflare's own
// and `window.turnstile` is typed here, only as far as this app uses it.
//
// A token works once. Whatever the answer to a request that carried one, it is
// spent, so `take()` hands it out and starts a fresh challenge in one step.

/** `render=explicit`: nothing is drawn until `turnstile.render` is called (there is no `.cf-turnstile` element to find anyway). */
export const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** The part of `turnstile.render`'s options this app sets. */
export interface TurnstileOptions {
  sitekey: string;
  action: string;
  theme: "light";
  size: "flexible";
  language: string;
  callback: (token: string) => void;
  "expired-callback": () => void;
  "timeout-callback": () => void;
  "error-callback": (code?: string) => void;
}

/** The part of `window.turnstile` this app calls. */
export interface TurnstileApi {
  /** The widget's id, or undefined when it could not be drawn. */
  render(container: HTMLElement, options: TurnstileOptions): string | undefined;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_MARK = "data-sakem-turnstile";

/**
 * Loads Cloudflare's script, once per page: a second caller, or the same page
 * mounted again, reuses the element (and `window.turnstile`) already there.
 * Rejects when the script cannot be fetched (offline, blocked) and forgets it,
 * so the next attempt tries again.
 *
 * In the development mock (`pnpm dev:spa:mock`) nothing is loaded: the mock
 * puts its own `window.turnstile` in place before the app starts, and if it
 * did not, this refuses rather than reach Cloudflare from a mock.
 */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (import.meta.env.VITE_ADMIN_MOCK === "true") return Promise.reject(new Error("the mock does not load Cloudflare's script"));

  let script = document.querySelector<HTMLScriptElement>(`script[${SCRIPT_MARK}]`);
  if (script?.dataset.settled === "loaded") {
    // It ran and left no `window.turnstile`: something removed it. Start over.
    script.remove();
    script = null;
  }
  if (!script) {
    script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.setAttribute(SCRIPT_MARK, "");
    document.head.append(script);
  }

  const pending = script;
  return new Promise<TurnstileApi>((resolve, reject) => {
    pending.addEventListener(
      "load",
      () => {
        pending.dataset.settled = "loaded";
        if (window.turnstile) resolve(window.turnstile);
        else reject(new Error("the Turnstile script loaded without window.turnstile"));
      },
      { once: true },
    );
    pending.addEventListener(
      "error",
      () => {
        pending.remove();
        reject(new Error("the Turnstile script could not be loaded"));
      },
      { once: true },
    );
  });
}

/** What a form reads and calls. */
export interface TurnstileControl {
  action: TurnstileAction;
  /** From `GET /api/config`; null means this deployment has no Turnstile and nothing is shown or sent. */
  siteKey: string | null;
  /** A fresh token, or null while there is none (not solved yet, expired, spent). */
  token: string | null;
  /** The widget could not run (script blocked or offline, challenge error). The form cannot be sent until it recovers. */
  failed: boolean;
  /** The form must not be sent: there is a widget and no token. */
  blocked: boolean;
  /** `blocked` and still working on it: the button says "Memeriksa…". */
  checking: boolean;
  /** Throws the token away and starts a new challenge. */
  reset(): void;
  /** The token to send with this request, and a new challenge started at once (it is spent whatever the answer). */
  take(): string | null;
  /** For <TurnstileWidget> only. */
  widget: WidgetBinding;
}

export interface WidgetBinding {
  onToken(token: string): void;
  /** The token expired, or an interactive challenge timed out: it is no good any more and a new one must be asked for. */
  onLost(): void;
  onFailure(): void;
  attach(api: TurnstileApi, widgetId: string): void;
  detach(): void;
}

/**
 * The Turnstile state of one form. Pass `siteKey` from `usePublicConfig()`;
 * with null, nothing happens and `take()` returns null.
 */
export function useTurnstile(action: TurnstileAction, siteKey: string | null): TurnstileControl {
  const [token, setTokenState] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // The ref is what `take()` reads: two calls before React has drawn again must not hand out one token twice.
  const tokenRef = useRef<string | null>(null);
  const handle = useRef<{ api: TurnstileApi; id: string } | null>(null);

  const setToken = useCallback((next: string | null) => {
    tokenRef.current = next;
    setTokenState(next);
  }, []);

  const reset = useCallback(() => {
    setToken(null);
    const current = handle.current;
    if (current) current.api.reset(current.id);
  }, [setToken]);

  const take = useCallback(() => {
    const spent = tokenRef.current;
    reset();
    return spent;
  }, [reset]);

  const widget = useMemo<WidgetBinding>(
    () => ({
      onToken(next) {
        setFailed(false);
        setToken(next);
      },
      onLost() {
        setToken(null);
        const current = handle.current;
        if (current) current.api.reset(current.id);
      },
      onFailure() {
        setToken(null);
        setFailed(true);
      },
      attach(api, id) {
        handle.current = { api, id };
      },
      detach() {
        handle.current = null;
        setToken(null);
        setFailed(false);
      },
    }),
    [setToken],
  );

  const blocked = siteKey !== null && token === null;
  return { action, siteKey, token, failed, blocked, checking: blocked && !failed, reset, take, widget };
}
