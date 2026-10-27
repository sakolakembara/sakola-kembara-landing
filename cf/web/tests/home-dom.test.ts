// @vitest-environment happy-dom
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The built home page, in a DOM, with its own scripts run for real: the navbar (and its floating mode,
// SAKEM-111), the alumni stories and the hero video. This is the check that the markup and the
// scripts agree (selectors, hidden/un-hidden controls) and that rendering the page logs no console
// errors. It is NOT a browser: there is no layout and no media playback (play() is stubbed), and no
// pixel was looked at.
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

  it('the five scripts of the page run without a console error', async () => {
    for (const marker of ['nav-toggle', 'data-chart', 'data-steps', 'data-stories', 'hero-video']) await runScript(html, marker);
    await new Promise((r) => setTimeout(r, 20));
  });

  describe('problem charts', () => {
    it('a click opens a chart\'s popover and closes the others; a click elsewhere or Escape closes it', async () => {
      await runScript(html, 'data-chart');
      const charts = [...document.querySelectorAll<HTMLElement>('[data-chart]')];
      const button = (i: number) => charts[i].querySelector('button')!;
      expect(charts).toHaveLength(3);
      button(0).click();
      expect(charts.map((c) => c.hasAttribute('data-open'))).toEqual([true, false, false]);
      expect(button(0).getAttribute('aria-expanded')).toBe('true');
      button(1).click();
      expect(charts.map((c) => c.hasAttribute('data-open'))).toEqual([false, true, false]);
      charts[1].querySelector<HTMLElement>('.problem-pop')!.click(); // a click inside the popover keeps it open
      expect(charts[1].hasAttribute('data-open')).toBe(true);
      document.body.click();
      expect(charts.some((c) => c.hasAttribute('data-open'))).toBe(false);
      button(2).click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(charts[2].hasAttribute('data-open')).toBe(false);
    });
  });

  describe('program steps', () => {
    const shown = () => [...document.querySelectorAll<HTMLElement>('[data-steps] [role="region"]')].filter((p) => !p.hidden).map((p) => p.id);
    it('the bar ending opens the next step (wrapping), a click on a header opens that step', async () => {
      await runScript(html, 'data-steps');
      const tiles = [...document.querySelectorAll<HTMLElement>('.step')];
      expect(shown()).toEqual(['tahap-prapembinaan']);
      tiles[0].querySelector('.step-bar')!.dispatchEvent(new Event('animationend'));
      expect(shown()).toEqual(['tahap-pembinaan']);
      expect(tiles.map((t) => t.querySelector('button')!.getAttribute('aria-expanded'))).toEqual(['false', 'true', 'false']);
      tiles[2].querySelector('button')!.click();
      expect(shown()).toEqual(['tahap-pasca-pembinaan']);
      tiles[2].querySelector('.step-bar')!.dispatchEvent(new Event('animationend'));
      expect(shown()).toEqual(['tahap-prapembinaan']);
    });
  });

  describe('hero video', () => {
    /** Stubs what happy-dom lacks: playback, and the reduced-motion query. */
    function stubMedia(reducedMotion: boolean) {
      const video = document.getElementById('hero-video') as HTMLVideoElement;
      const play = vi.fn(() => Promise.resolve());
      video.play = play;
      vi.stubGlobal('matchMedia', (q: string) => ({ matches: reducedMotion && q.includes('reduce') }));
      return { video, play };
    }

    it('plays the loop', async () => {
      const { video, play } = stubMedia(false);
      await runScript(html, 'hero-video');
      expect(play).toHaveBeenCalledTimes(1);
      expect(video.preload).toBe('auto');
    });

    it('with reduced motion the video never starts and the poster stays', async () => {
      const { video, play } = stubMedia(true);
      await runScript(html, 'hero-video');
      expect(play).not.toHaveBeenCalled();
      expect(video.preload).toBe('none');
    });
  });

  describe('stories', () => {
    const shown = () => [...document.querySelectorAll<HTMLElement>('#cerita .story')].filter((s) => !s.hidden).map((s) => s.id);
    const cards = () => [...document.querySelectorAll<HTMLElement>('#cerita [data-story]')];
    it('a small card shows its story large (and leaves the cards); the bar ending shows the next story, wrapping', async () => {
      await runScript(html, 'data-stories');
      const ids = [...document.querySelectorAll<HTMLElement>('#cerita .story')].map((s) => s.id);
      expect(shown()).toEqual([ids[0]]);
      expect(cards().map((c) => c.parentElement!.hidden)).toEqual(ids.map((_, i) => i === 0));
      cards()[3].click();
      expect(shown()).toEqual([ids[3]]);
      expect(cards()[3].parentElement!.hidden).toBe(true);
      expect(cards()[0].parentElement!.hidden).toBe(false);
      const last = document.getElementById(ids.at(-1)!)!;
      cards()[ids.length - 1].click();
      last.querySelector('.story-bar')!.dispatchEvent(new Event('animationend'));
      expect(shown()).toEqual([ids[0]]);
    });
  });

  describe('floating navbar', () => {
    it('is transparent at the top, solid once the page scrolls or the mobile menu opens', async () => {
      const nav = document.getElementById('site-nav')!;
      expect(nav.hasAttribute('data-overlay')).toBe(true);
      await runScript(html, 'nav-toggle');
      expect(nav.hasAttribute('data-solid')).toBe(false);
      document.getElementById('nav-toggle')!.click();
      expect(nav.hasAttribute('data-solid')).toBe(true);
      document.getElementById('nav-toggle')!.click();
      expect(nav.hasAttribute('data-solid')).toBe(false);
      Object.defineProperty(window, 'scrollY', { value: 400, configurable: true });
      window.dispatchEvent(new Event('scroll'));
      expect(nav.hasAttribute('data-solid')).toBe(true);
      Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    });

    it('hides while the page scrolls down, shows again on a scroll up, stays while the mobile menu is open', async () => {
      const nav = document.getElementById('site-nav')!;
      await runScript(html, 'nav-toggle');
      const scrollTo = (y: number) => {
        Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
        window.dispatchEvent(new Event('scroll'));
      };
      scrollTo(60);
      expect(nav.hasAttribute('data-hidden')).toBe(false); // near the top
      scrollTo(500);
      expect(nav.hasAttribute('data-hidden')).toBe(true);
      scrollTo(450);
      expect(nav.hasAttribute('data-hidden')).toBe(false);
      document.getElementById('nav-toggle')!.click();
      scrollTo(900);
      expect(nav.hasAttribute('data-hidden')).toBe(false);
      scrollTo(0);
    });
  });
});
