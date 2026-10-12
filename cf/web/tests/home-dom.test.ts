// @vitest-environment happy-dom
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mapLocations, testimonials } from '~/lib/home-data';

// The built home page, in a DOM, with its own scripts run for real: the stat dialog opener, the
// carousel controls and the lazy Leaflet map (the dynamic imports included), plus the navbar script.
// This is the check that the markup and the scripts agree (selectors, hidden/un-hidden controls,
// the data the map reads) and that rendering the page logs no console errors. It is NOT a browser:
// there is no layout, so the geometry the carousel reads is stubbed, and no pixel was looked at.
// Needs `pnpm build`; skipped without dist/.
// (helpers.ts is not imported: its `new URL(.., import.meta.url)` is rewritten by Vite in a DOM test environment)
const webRoot = path.resolve(import.meta.dirname, '..');
const client = path.join(webRoot, 'dist/client');
const built = existsSync(path.join(client, 'index.html'));

const scriptDir = path.join(webRoot, 'dist/.dom-test');
let runId = 0;

/** Runs the page's module script that contains `marker`, as the browser would (inline ones from a temp file). */
async function runScript(html: string, marker: string) {
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !m[1].includes('ld+json'));
  const hit = scripts.find((m) => {
    const src = m[1].match(/\ssrc="([^"]+)"/)?.[1];
    return (src ? readFileSync(path.join(client, src), 'utf8') : m[2]).includes(marker);
  });
  if (!hit) throw new Error(`no script contains ${marker}`);
  const src = hit[1].match(/\ssrc="([^"]+)"/)?.[1];
  let file: string;
  if (src) {
    file = path.join(client, src);
  } else {
    mkdirSync(scriptDir, { recursive: true });
    file = path.join(scriptDir, `inline-${++runId}.mjs`);
    writeFileSync(file, hit[2]);
  }
  await import(/* @vite-ignore */ `${pathToFileURL(file).href}?run=${++runId}`);
}

/** Geometry for the carousel: `visible` cards of 500 px with a 24 px gap, as at md and up (2) or below (1). */
function stubLayout(root: HTMLElement, visible: number) {
  const track = root.querySelector<HTMLElement>('[data-carousel-track]')!;
  const cards = [...track.querySelectorAll<HTMLElement>(':scope > ul > li')];
  const define = (el: object, prop: string, value: number) => Object.defineProperty(el, prop, { value, configurable: true });
  cards.forEach((card, i) => {
    define(card, 'offsetLeft', i * 524);
    define(card, 'offsetWidth', 500);
  });
  define(track, 'scrollWidth', cards.length * 524 - 24);
  define(track, 'clientWidth', visible * 524 - 24);
  return { track, cards };
}

describe.skipIf(!built)('home page scripts, run against the built HTML', () => {
  const html = built ? readFileSync(path.join(client, 'index.html'), 'utf8') : '';
  let problems: string[];

  beforeEach(() => {
    problems = [];
    vi.spyOn(console, 'error').mockImplementation((...a) => void problems.push(`console.error: ${a.join(' ')}`));
    vi.spyOn(console, 'warn').mockImplementation((...a) => void problems.push(`console.warn: ${a.join(' ')}`));
    window.addEventListener('error', (e) => problems.push(`window error: ${e.message}`));
    // the stylesheet is not needed (no layout here), and happy-dom would try to fetch it
    document.documentElement.innerHTML = html.replace(/<link rel="stylesheet"[^>]*>/g, '');
    // the navbar script talks to the legacy app; here it just gets an unreachable endpoint
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    window.sessionStorage.clear();
  });

  afterEach(() => {
    expect(problems).toEqual([]);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('all four scripts of the page run without a console error', async () => {
    for (const marker of ['nav-toggle', 'data-dialog-open', 'data-carousel', 'data-impact-map']) await runScript(html, marker);
    await new Promise((r) => setTimeout(r, 20));
  });

  describe('stat dialog', () => {
    it('opens from its button and closes on a click on the backdrop', async () => {
      await runScript(html, 'data-dialog-open');
      const button = document.querySelector<HTMLElement>('[data-dialog-open]')!;
      const dialog = document.getElementById(button.dataset.dialogOpen!) as HTMLDialogElement;
      expect(dialog.open).toBe(false);
      button.click();
      expect(dialog.open).toBe(true);
      // a click inside the dialog's content keeps it open, a click on the dialog itself (the backdrop) closes it
      dialog.querySelector<HTMLElement>('p')!.click();
      expect(dialog.open).toBe(true);
      dialog.click();
      expect(dialog.open).toBe(false);
    });
  });

  describe('testimonial carousel', () => {
    const root = () => document.querySelector<HTMLElement>('[data-carousel]')!;
    const ui = () => [...root().querySelectorAll<HTMLElement>('[data-carousel-ui]')];
    const dots = () => [...root().querySelectorAll<HTMLElement>('[data-carousel-dot]')];
    const active = () => dots().findIndex((d) => d.getAttribute('aria-current') === 'true');
    const settle = () => new Promise((r) => setTimeout(r, 30));
    /** The stubbed track moves when asked to (as scroll-snap would) and reports it with a scroll event. */
    async function scrollTo(track: HTMLElement, left: number) {
      Object.defineProperty(track, 'scrollLeft', { value: left, configurable: true });
      track.dispatchEvent(new Event('scroll'));
      await settle();
    }
    const press = (selector: string) => root().querySelector<HTMLElement>(selector)!.click();

    it('without the script the controls are hidden; with it they appear', async () => {
      expect(ui().length).toBeGreaterThan(0);
      for (const el of ui()) expect(el.hidden, el.outerHTML.slice(0, 60)).toBe(true);
      stubLayout(root(), 2);
      await runScript(html, 'data-carousel');
      for (const el of ui()) expect(el.hidden).toBe(false);
    });

    it('with two cards in view it has one dot fewer than cards; the first is current', async () => {
      stubLayout(root(), 2);
      await runScript(html, 'data-carousel');
      expect(dots()).toHaveLength(testimonials.length);
      expect(dots().filter((d) => !d.hidden)).toHaveLength(testimonials.length - 1);
      expect(active()).toBe(0);
    });

    it('with one card in view every card has a dot (after a resize)', async () => {
      const { track } = stubLayout(root(), 2);
      await runScript(html, 'data-carousel');
      stubLayout(root(), 1);
      window.dispatchEvent(new Event('resize'));
      expect(dots().filter((d) => !d.hidden)).toHaveLength(testimonials.length);
      expect(track.scrollWidth).toBe(testimonials.length * 524 - 24);
    });

    it('next moves one card, prev moves back, both wrap around; the dot follows', async () => {
      const { track } = stubLayout(root(), 2);
      const scrolled: number[] = [];
      track.scrollTo = ((opts: ScrollToOptions) => void scrolled.push(opts.left as number)) as typeof track.scrollTo;
      await runScript(html, 'data-carousel');

      press('[data-carousel-next]');
      expect(scrolled.at(-1)).toBe(524);
      await scrollTo(track, 524);
      expect(active()).toBe(1);

      press('[data-carousel-prev]');
      expect(scrolled.at(-1)).toBe(0);
      await scrollTo(track, 0);
      expect(active()).toBe(0);

      // at the start, previous wraps to the last position (index 5 of 7 cards with two in view)
      press('[data-carousel-prev]');
      expect(scrolled.at(-1)).toBe(5 * 524);
      await scrollTo(track, 5 * 524);
      expect(active()).toBe(5);

      // at the end, next wraps to the start
      press('[data-carousel-next]');
      expect(scrolled.at(-1)).toBe(0);
    });

    it('a dot goes to its card', async () => {
      const { track } = stubLayout(root(), 2);
      const scrolled: number[] = [];
      track.scrollTo = ((opts: ScrollToOptions) => void scrolled.push(opts.left as number)) as typeof track.scrollTo;
      await runScript(html, 'data-carousel');
      dots()[3].click();
      expect(scrolled.at(-1)).toBe(3 * 524);
      await scrollTo(track, 3 * 524);
      expect(active()).toBe(3);
    });
  });

  describe('lazy map', () => {
    const canvas = () => document.querySelector<HTMLElement>('[data-map-canvas]')!;
    const list = () => document.querySelector<HTMLElement>('[data-map-locations]')!;

    it('does not load Leaflet until the panel is near the viewport', async () => {
      const observed: Element[] = [];
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          observe(el: Element) {
            observed.push(el);
          }
          disconnect() {}
        },
      );
      await runScript(html, 'data-impact-map');
      expect(observed).toHaveLength(1);
      expect(observed[0]).toBe(document.querySelector('[data-impact-map]'));
      expect(canvas().querySelector('.leaflet-container, .leaflet-pane')).toBeNull();
      expect(list().hidden).toBe(false); // the list is what a visitor sees until then
      expect(document.head.querySelectorAll('style').length).toBe(html.match(/<style/g)!.length); // no Leaflet CSS yet
    });

    it('when the panel intersects: loads Leaflet and its CSS, draws one marker per branch, swaps the list for the map', async () => {
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          constructor(private cb: (entries: { isIntersecting: boolean }[]) => void) {}
          observe() {
            this.cb([{ isIntersecting: true }]);
          }
          disconnect() {}
        },
      );
      // Leaflet needs a size to fit the bounds; happy-dom has no layout
      Object.defineProperty(canvas(), 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(canvas(), 'clientHeight', { value: 500, configurable: true });

      await runScript(html, 'data-impact-map');
      await vi.waitFor(() => expect(canvas().querySelectorAll('.leaflet-marker-icon')).toHaveLength(mapLocations.length), { timeout: 5000 });

      const markers = [...canvas().querySelectorAll<HTMLElement>('.leaflet-marker-icon')];
      expect(markers.map((m) => m.title).sort()).toEqual(mapLocations.map((l) => l.name).sort());
      for (const m of markers) {
        expect(m.getAttribute('role')).toBe('button'); // Leaflet's keyboard-operable markers
        expect(m.tabIndex).toBe(0);
      }
      expect(list().hidden).toBe(true);
      expect(document.querySelector<HTMLElement>('[data-map-legend]')!.hidden).toBe(false);
      expect(document.head.textContent).toContain('.leaflet-container');
      expect(document.head.textContent).toContain('map-pulse');
      expect(canvas().textContent).toContain('OpenStreetMap');

      // a marker opens the popup of its branch, built from the same markup as the list
      markers.find((m) => m.title === 'Sakola Kembara Bandung')!.click();
      const popup = canvas().querySelector('.leaflet-popup-content');
      expect(popup?.textContent).toContain('Sakola Kembara Bandung');
      expect(popup?.textContent).toContain('Kota Bandung');
      expect(popup?.textContent).toContain('Bimbel Aktif');
    });

    it('if the map cannot be built, the list stays, the legend stays hidden and nothing is thrown at the page', async () => {
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          constructor(private cb: (entries: { isIntersecting: boolean }[]) => void) {}
          observe() {
            this.cb([{ isIntersecting: true }]);
          }
          disconnect() {}
        },
      );
      // Leaflet reads the container's size while fitting the bounds: make that fail
      Object.defineProperty(canvas(), 'clientWidth', {
        get() {
          throw new Error('no layout');
        },
        configurable: true,
      });
      await runScript(html, 'data-impact-map');
      await new Promise((r) => setTimeout(r, 100));
      expect(list().hidden).toBe(false);
      expect(document.querySelector<HTMLElement>('[data-map-legend]')!.hidden).toBe(true);
    });
  });
});
