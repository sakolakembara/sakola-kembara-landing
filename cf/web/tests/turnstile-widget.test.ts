// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The widget script of /kontak (src/scripts/turnstile-widget.ts), run for real in a DOM against markup shaped
// like src/components/contact/ContactForm.astro, with a stand-in `window.turnstile`. It is not a browser:
// there is no challenge and no Cloudflare script (nothing here loads one). The same script is also run
// against the page the built Worker serves (scripts/e2e.mjs, group "turnstile").
// (helpers.ts is not imported: its `new URL(.., import.meta.url)` is rewritten by Vite in a DOM test environment)

const SITEKEY = '1x00000000000000000000AA';

const markup = (withApiTag = true, withSlot = true) => `
  <form id="kontak-form" method="post" action="/kontak">
    <input id="email" name="email" />
    <div>
      ${withSlot ? `<div data-turnstile data-sitekey="${SITEKEY}" data-action="contact" class="min-h-[65px]"></div>
      <p data-turnstile-failed hidden role="status">Verifikasi gagal. Silakan coba lagi.</p>` : ''}
    </div>
    <button type="submit"><span data-label>Kirim Pesan</span></button>
  </form>
  ${withApiTag ? '<script data-turnstile-api></script>' : ''}`;

interface Render {
  container: HTMLElement;
  options: Record<string, unknown>;
}
let renders: Render[];
let resets: (string | undefined)[];
let problems: string[];

/** What Cloudflare's script defines, as far as the page uses it. */
function installTurnstile() {
  window.turnstile = {
    render(container, options) {
      renders.push({ container, options });
      return `widget-${renders.length}`;
    },
    reset(id) {
      resets.push(id);
    },
  };
}

/** Fresh copy of the module each time: it binds its listeners when it is imported. */
async function runScript() {
  vi.resetModules();
  await import('~/scripts/turnstile-widget');
}

// The script binds a `pageshow` listener on the window each time it runs; a re-imported copy must not meet the
// listeners of the copies before it, so every listener added while a test runs is taken off again after it.
let added: [string, EventListenerOrEventListenerObject][];
const realAdd = globalThis.addEventListener.bind(globalThis);

beforeEach(() => {
  renders = [];
  resets = [];
  problems = [];
  added = [];
  delete window.turnstile;
  globalThis.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    added.push([type, listener]);
    realAdd(type, listener, options);
  }) as typeof globalThis.addEventListener;
  vi.spyOn(console, 'error').mockImplementation((...a) => void problems.push(`console.error: ${a.join(' ')}`));
  vi.spyOn(console, 'warn').mockImplementation((...a) => void problems.push(`console.warn: ${a.join(' ')}`));
  window.addEventListener('error', (e) => problems.push(`window error: ${e.message}`));
});

afterEach(() => {
  expect(problems).toEqual([]);
  for (const [type, listener] of added) globalThis.removeEventListener(type, listener);
  globalThis.addEventListener = realAdd as typeof globalThis.addEventListener;
  vi.restoreAllMocks();
  delete window.turnstile;
});

describe('turnstile-widget script', () => {
  it('Cloudflare\'s script was there first: renders once, explicitly, into the slot with the key and the action of its data attributes', async () => {
    document.body.innerHTML = markup();
    installTurnstile();
    await runScript();
    expect(renders).toHaveLength(1);
    expect(renders[0]!.container).toBe(document.querySelector('[data-turnstile]'));
    expect(renders[0]!.options).toEqual({ sitekey: SITEKEY, action: 'contact', theme: 'light', size: 'flexible', language: 'id' });
  });

  it('Cloudflare\'s script finishes after this one: waits for its load event, then renders once (a second load changes nothing)', async () => {
    document.body.innerHTML = markup();
    await runScript();
    expect(renders).toHaveLength(0);
    installTurnstile();
    const tag = document.querySelector('script[data-turnstile-api]')!;
    tag.dispatchEvent(new Event('load'));
    expect(renders).toHaveLength(1);
    tag.dispatchEvent(new Event('load'));
    expect(renders).toHaveLength(1);
  });

  it('renders into the form\'s slot, so Turnstile adds its hidden cf-turnstile-response field to this form', async () => {
    document.body.innerHTML = markup();
    installTurnstile();
    await runScript();
    expect(renders[0]!.container.closest('form')?.id).toBe('kontak-form');
  });

  it('a script that cannot be loaded (blocked, offline) shows the failure line and renders nothing', async () => {
    document.body.innerHTML = markup();
    await runScript();
    const failed = document.querySelector<HTMLElement>('[data-turnstile-failed]')!;
    expect(failed.hidden).toBe(true);
    document.querySelector('script[data-turnstile-api]')!.dispatchEvent(new Event('error'));
    expect(failed.hidden).toBe(false);
    expect(failed.textContent).toBe('Verifikasi gagal. Silakan coba lagi.');
    expect(renders).toHaveLength(0);
  });

  it('a page restored from the back/forward cache holds a spent token: the widget is reset; a normal pageshow does nothing', async () => {
    document.body.innerHTML = markup();
    installTurnstile();
    await runScript();
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));
    expect(resets).toEqual([]);
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    expect(resets).toEqual(['widget-1']);
  });

  it('no reset before the widget exists (a restored page whose script never loaded)', async () => {
    document.body.innerHTML = markup();
    await runScript();
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    expect(resets).toEqual([]);
  });

  it('without the slot (no site key) it does nothing at all, and does not touch the script tag', async () => {
    document.body.innerHTML = markup(false, false);
    installTurnstile();
    await runScript();
    expect(renders).toHaveLength(0);
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    expect(resets).toEqual([]);
  });

  it('without Cloudflare\'s tag and without `turnstile` it waits quietly: no error, no render', async () => {
    document.body.innerHTML = markup(false, true);
    await runScript();
    expect(renders).toHaveLength(0);
  });

  it('it cannot load anything by itself: no script is created and nothing is fetched', async () => {
    document.body.innerHTML = markup();
    const fetchSpy = vi.fn(() => Promise.reject(new Error('no network in this test')));
    vi.stubGlobal('fetch', fetchSpy);
    const created = vi.spyOn(document, 'createElement');
    installTurnstile();
    await runScript();
    expect(created.mock.calls.filter(([tag]) => String(tag).toLowerCase() === 'script')).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
