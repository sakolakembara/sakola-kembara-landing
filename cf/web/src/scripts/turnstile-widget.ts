// The Turnstile widget of the /kontak form (src/components/contact/ContactForm.astro), inlined into the
// page next to the form's own small script. The form posts without any script, but the widget cannot run
// without JavaScript, which is why the form shows a notice inside <noscript> and the API Worker refuses a
// post without a token wherever a Turnstile secret is configured (always in production).
//
// Explicit rendering into the form's `[data-turnstile]` slot (present only when a site key is set), once
// Cloudflare's script has defined `window.turnstile`. Turnstile then adds the hidden field
// `cf-turnstile-response` to the form, which the post carries to the server.
//   - A token works once and expires after five minutes. Expiry is Turnstile's own business
//     (`refresh-expired` is "auto" by default). A page restored from the back/forward cache holds the token
//     of the post that left it, already spent, so `pageshow` resets the widget. After a refused post the
//     server renders the form again, which is a fresh widget.
//   - If Cloudflare's script cannot be loaded (blocked, offline) the slot says the verification failed.
//
// The script URL is in the page (a `<script data-turnstile-api>` tag, src/lib/turnstile.ts) and never in
// this file: this file has no way to load anything, it only waits for `window.turnstile`.

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string | undefined;
  reset(widgetId?: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const slot = document.querySelector<HTMLElement>('#kontak-form [data-turnstile]');
let widgetId: string | undefined;

/** Renders the widget once, as soon as Cloudflare's script has defined `window.turnstile`. */
function renderWidget() {
  if (!slot || widgetId !== undefined || !window.turnstile) return;
  widgetId = window.turnstile.render(slot, {
    sitekey: slot.dataset.sitekey,
    action: slot.dataset.action,
    theme: 'light',
    size: 'flexible',
    language: 'id',
  });
}

if (slot) {
  if (window.turnstile) {
    renderWidget();
  } else {
    // Cloudflare's script is async: it may finish before or after this module runs. Nothing can happen
    // between the check above and these listeners (one thread), so one of the two paths always fires.
    const api = document.querySelector<HTMLScriptElement>('script[data-turnstile-api]');
    api?.addEventListener('load', renderWidget, { once: true });
    api?.addEventListener(
      'error',
      () => {
        const failed = slot.parentElement?.querySelector<HTMLElement>('[data-turnstile-failed]');
        if (failed) failed.hidden = false;
      },
      { once: true },
    );
  }
  addEventListener('pageshow', (e) => {
    // The token of the post that left this page is spent: ask for a new one.
    if (e.persisted && widgetId !== undefined) window.turnstile?.reset(widgetId);
  });
}

// Marks the file as a module (so the page's import and the tests' import type-check); the bundler keeps the code above.
export {};
