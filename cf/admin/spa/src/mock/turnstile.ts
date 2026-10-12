import type { TurnstileApi, TurnstileOptions } from "~/lib/turnstile";

// MOCK, local development only (see mock/install.ts). A stand-in for Cloudflare's
// `window.turnstile`, so the forms can be tried with the widget in place while
// nothing leaves the machine: the script is never loaded in mock mode
// (loadTurnstile() in lib/turnstile.ts refuses), this object is there instead.
//
// A widget "solves" itself after a moment and hands out a made-up token. The
// mock API (mock/transport.ts) accepts each token once, like the real check,
// so a page that forgets to reset the widget after a request meets
// "Verifikasi keamanan gagal" here too.

export const MOCK_SITE_KEY = "mock-site-key";
export const MOCK_TOKEN_PREFIX = "mock-turnstile-token-";
const SOLVE_MS = 900;

interface MockWidget {
  box: HTMLElement;
  options: TurnstileOptions;
  timer: number | undefined;
}

export function installMockTurnstile(): void {
  const widgets = new Map<string, MockWidget>();
  let widgetCount = 0;
  let tokenCount = 0;

  function solve(id: string): void {
    const widget = widgets.get(id);
    if (!widget) return;
    window.clearTimeout(widget.timer);
    widget.box.textContent = "Pemeriksaan keamanan tiruan: memeriksa…";
    widget.timer = window.setTimeout(() => {
      widget.box.textContent = "Pemeriksaan keamanan tiruan: berhasil";
      tokenCount += 1;
      widget.options.callback(`${MOCK_TOKEN_PREFIX}${tokenCount}`);
    }, SOLVE_MS);
  }

  const mock: TurnstileApi = {
    render(container, options) {
      widgetCount += 1;
      const id = `mock-widget-${widgetCount}`;
      const box = document.createElement("div");
      box.style.cssText =
        "box-sizing:border-box;height:65px;display:flex;align-items:center;padding:0 16px;border:1px solid #d1d5db;border-radius:4px;background:#fafafa;color:#374151;font:500 14px system-ui";
      container.append(box);
      widgets.set(id, { box, options, timer: undefined });
      solve(id);
      return id;
    },
    reset(id) {
      solve(id);
    },
    remove(id) {
      const widget = widgets.get(id);
      if (!widget) return;
      window.clearTimeout(widget.timer);
      widget.box.remove();
      widgets.delete(id);
    },
  };
  window.turnstile = mock;
}
