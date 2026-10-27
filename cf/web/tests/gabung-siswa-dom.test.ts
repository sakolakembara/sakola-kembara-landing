// @vitest-environment happy-dom
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The built /gabung-siswa page in a DOM, with its own script (the navbar one: it is the only one) run
// for real: the page renders and the script runs without a console error, and the in-page link
// "Pelajari Program" has a target. It is NOT a browser: no layout, no pixel was looked at.
// Needs `pnpm build`; skipped without dist/.
// (helpers.ts is not imported: its `new URL(.., import.meta.url)` is rewritten by Vite in a DOM test environment)
const webRoot = path.resolve(import.meta.dirname, '..');
const client = path.join(webRoot, 'dist/client');
const built = existsSync(path.join(client, 'gabung-siswa.html'));
const scriptDir = path.join(webRoot, 'dist/.dom-test');
let runId = 0;

async function runInlineScripts(html: string) {
  // inline ones only: the shared motion loader (src=, SAKEM-112) is a file of its own
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !m[1].includes('ld+json') && !/\ssrc=/.test(m[1]));
  mkdirSync(scriptDir, { recursive: true });
  for (const m of scripts) {
    const file = path.join(scriptDir, `gabung-siswa-${++runId}.mjs`);
    writeFileSync(file, m[2]);
    await import(/* @vite-ignore */ `${pathToFileURL(file).href}?run=${++runId}`);
  }
  return scripts.length;
}

describe.skipIf(!built)('/gabung-siswa page, scripts run against the built HTML', () => {
  const html = built ? readFileSync(path.join(client, 'gabung-siswa.html'), 'utf8') : '';
  let problems: string[];

  beforeEach(() => {
    problems = [];
    vi.spyOn(console, 'error').mockImplementation((...a) => void problems.push(`console.error: ${a.join(' ')}`));
    vi.spyOn(console, 'warn').mockImplementation((...a) => void problems.push(`console.warn: ${a.join(' ')}`));
    window.addEventListener('error', (e) => problems.push(`window error: ${e.message}`));
    document.documentElement.innerHTML = html.replace(/<link rel="stylesheet"[^>]*>/g, '');
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline'))); // the navbar script asks the legacy app
    window.sessionStorage.clear();
  });

  afterEach(() => {
    expect(problems).toEqual([]);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders, and its one script runs without a console error', async () => {
    expect(await runInlineScripts(html)).toBe(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelectorAll('h1')).toHaveLength(1);
  });

  it('every in-page link has its target: #manfaat is the benefits section', () => {
    const anchors = [...document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')].map((a) => a.getAttribute('href')!).filter((h) => h.length > 1);
    expect(anchors).toContain('#manfaat');
    for (const href of anchors) expect(document.getElementById(href.slice(1)), href).not.toBeNull();
  });

  it('the page has no form and no button of its own (the CTAs are links to the portal)', () => {
    const main = document.getElementById('konten-utama')!;
    expect(main.querySelectorAll('form, button')).toHaveLength(0);
  });
});
