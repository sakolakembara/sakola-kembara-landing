// @vitest-environment happy-dom
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The built home page, in a DOM, with its own scripts run for real: the navbar (and its floating mode,
// SAKEM-111), the stat dialog opener and the hero video. This is the check that the markup and the
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

  it('the three scripts of the page run without a console error', async () => {
    for (const marker of ['nav-toggle', 'data-dialog-open', 'hero-video']) await runScript(html, marker);
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

  describe('hero video', () => {
    /** Stubs what happy-dom lacks: playback, and the reduced-motion query. */
    function stubMedia(reducedMotion: boolean) {
      const video = document.getElementById('hero-video') as HTMLVideoElement;
      let paused = true;
      Object.defineProperty(video, 'paused', { get: () => paused, configurable: true });
      const play = vi.fn(() => ((paused = false), Promise.resolve()));
      video.play = play;
      video.pause = vi.fn(() => void (paused = true));
      vi.stubGlobal('matchMedia', (q: string) => ({ matches: reducedMotion && q.includes('reduce') }));
      return { video, play, toggle: document.getElementById('hero-video-toggle') as HTMLButtonElement };
    }

    it('plays the loop, then shows the pause button, which pauses and resumes it', async () => {
      const { video, play, toggle } = stubMedia(false);
      expect(toggle.hidden).toBe(true);
      await runScript(html, 'hero-video');
      await Promise.resolve();
      expect(play).toHaveBeenCalledTimes(1);
      expect(video.preload).toBe('auto');
      expect(toggle.hidden).toBe(false);
      expect(toggle.getAttribute('aria-label')).toBe('Jeda video');
      toggle.click();
      expect(video.paused).toBe(true);
      expect(toggle.getAttribute('aria-label')).toBe('Putar video');
      toggle.click();
      await Promise.resolve();
      expect(video.paused).toBe(false);
      expect(toggle.getAttribute('aria-label')).toBe('Jeda video');
    });

    it('with reduced motion the video never starts and the poster stays, without a button', async () => {
      const { play, toggle } = stubMedia(true);
      await runScript(html, 'hero-video');
      expect(play).not.toHaveBeenCalled();
      expect(toggle.hidden).toBe(true);
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
  });
});
