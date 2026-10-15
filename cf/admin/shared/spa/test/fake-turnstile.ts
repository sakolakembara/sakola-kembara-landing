import { act, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";
import type { TurnstileApi, TurnstileOptions } from "../turnstile";

// Stands in for Cloudflare's script and for `window.turnstile`, so no test
// reaches the network. The page adds a <script> element (jsdom never fetches
// it); `loadScript()` then does what the real script does when it has run: it
// defines `window.turnstile` and the element fires `load`.

export const SCRIPT_SELECTOR = 'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]';

export interface FakeWidget {
  id: string;
  container: HTMLElement;
  options: TurnstileOptions;
  removed: boolean;
  /** How many times the page asked for a fresh challenge. */
  resets: number;
}

export function fakeTurnstile() {
  const widgets: FakeWidget[] = [];
  const api = {
    render: vi.fn<TurnstileApi["render"]>((container: HTMLElement, options: TurnstileOptions) => {
      const widget: FakeWidget = { id: `widget-${widgets.length + 1}`, container, options, removed: false, resets: 0 };
      widgets.push(widget);
      return widget.id;
    }),
    reset: vi.fn((id: string) => {
      const widget = widgets.find((w) => w.id === id);
      if (widget) widget.resets += 1;
    }),
    remove: vi.fn((id: string) => {
      const widget = widgets.find((w) => w.id === id);
      if (widget) widget.removed = true;
    }),
  } satisfies TurnstileApi;

  const script = () => document.querySelector<HTMLScriptElement>(SCRIPT_SELECTOR);
  const current = () => {
    const widget = widgets.at(-1);
    if (!widget) throw new Error("no widget has been drawn (after `preload()`, `await turnstile.drawn()` first: the page draws it in an effect)");
    return widget;
  };

  return {
    api,
    widgets,
    script,
    /** The widget the page drew last. Synchronous: after `preload()` or a page change, wait for it with `drawn()` first. */
    current,
    /**
     * Resolves with the widget once the page has drawn one that is still on the page (and, with `action`, one for that
     * action). The page draws in an effect that runs after the button waiting for the token ("Memeriksa…") is on
     * screen, so that button appearing does not mean the widget is there yet: under load the effect can run a moment
     * later. A page that swaps one form for another (the registration, then the resend of the link) draws a second
     * widget: name its `action`, or `current()` may still be the first one, which is gone.
     */
    async drawn(action?: string) {
      await waitFor(() => {
        const widget = widgets.at(-1);
        expect(widget, "no widget has been drawn").toBeDefined();
        expect(widget!.removed, "the last widget drawn has been removed").toBe(false);
        if (action !== undefined) expect(widget!.options.action).toBe(action);
      });
      return current();
    },
    /** The page asked for the script; run it. Resolves once the widget is drawn (`drawn: false` when `render` is made to fail). */
    async loadScript({ drawn = true } = {}) {
      await waitFor(() => expect(script()).not.toBeNull());
      await act(async () => {
        window.turnstile = api;
        script()!.dispatchEvent(new Event("load"));
      });
      if (drawn) await waitFor(() => expect(widgets.length).toBeGreaterThan(0));
    },
    /** Cloudflare is already loaded (a second page, or the mock): no script element is needed. */
    preload() {
      window.turnstile = api;
    },
    /** The script cannot be fetched (offline, blocked). */
    async failScript() {
      await waitFor(() => expect(script()).not.toBeNull());
      await act(async () => {
        script()!.dispatchEvent(new Event("error"));
      });
    },
    /** What the widget does when the visitor passes the challenge. */
    solve(token: string) {
      act(() => current().options.callback(token));
    },
    expire() {
      act(() => current().options["expired-callback"]());
    },
    timeout() {
      act(() => current().options["timeout-callback"]());
    },
    error(code = "300010") {
      act(() => current().options["error-callback"](code));
    },
  };
}

export type FakeTurnstile = ReturnType<typeof fakeTurnstile>;
