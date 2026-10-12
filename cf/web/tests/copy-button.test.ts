// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The copy script of /gabung-siswa/docs (src/scripts/copy-button.ts), run for real in a DOM against
// markup shaped like src/components/ResourceCard.astro. The same script is also run against the
// HTML the built Worker serves (scripts/e2e.mjs, group "resources"); this file is the fast, exact
// version of it. It is not a browser: there is no layout and no real clipboard.
// (helpers.ts is not imported: its `new URL(.., import.meta.url)` is rewritten by Vite in a DOM test environment)

const card = (id: string, text: string) => `
  <article>
    <div>
      <button type="button" hidden data-copy-text="resource-text-${id}" aria-label="Salin teks ${id}">
        <span data-copy-idle>Salin</span>
        <span data-copy-done hidden>Tersalin</span>
      </button>
      <span class="sr-only" role="status" data-copy-status></span>
    </div>
    <pre id="resource-text-${id}">${text}</pre>
  </article>`;

const state = (button: HTMLElement) => ({
  copied: button.hasAttribute('data-copied'),
  idle: button.querySelector<HTMLElement>('[data-copy-idle]')!.hidden,
  done: button.querySelector<HTMLElement>('[data-copy-done]')!.hidden,
  said: button.parentElement!.querySelector('[data-copy-status]')!.textContent,
});

let problems: string[];
let written: string[];

/** Fresh copy of the module each time: it binds its listeners when it is imported. */
async function runScript() {
  vi.resetModules();
  await import('~/scripts/copy-button');
}
const flush = () => vi.advanceTimersByTimeAsync(0);
/** document.execCommand is deprecated (the script only uses it as a fallback); tests replace it by name. */
const setExecCommand = (fn: () => boolean) => Object.defineProperty(document, 'execCommand', { configurable: true, value: fn });

beforeEach(() => {
  vi.useFakeTimers();
  problems = [];
  written = [];
  vi.spyOn(console, 'error').mockImplementation((...a) => void problems.push(`console.error: ${a.join(' ')}`));
  vi.spyOn(console, 'warn').mockImplementation((...a) => void problems.push(`console.warn: ${a.join(' ')}`));
  window.addEventListener('error', (e) => problems.push(`window error: ${e.message}`));
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (t: string) => void written.push(t) },
  });
  document.body.innerHTML = card('a', 'Halo!\n\n#SakolaKembara') + card('b', 'Pesan &lt;siaran&gt; &amp; lainnya');
});

afterEach(() => {
  expect(problems).toEqual([]);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('copy-button script', () => {
  it('the buttons ship hidden and appear when the script runs', async () => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-copy-text]')];
    expect(buttons).toHaveLength(2);
    for (const b of buttons) expect(b.hidden).toBe(true);
    await runScript();
    for (const b of buttons) expect(b.hidden).toBe(false);
  });

  it('copies the text of its own <pre>, exactly as shown (entities decoded, line breaks kept)', async () => {
    await runScript();
    const [a, b] = [...document.querySelectorAll<HTMLButtonElement>('[data-copy-text]')];
    a.click();
    await flush();
    b.click();
    await flush();
    expect(written).toEqual(['Halo!\n\n#SakolaKembara', 'Pesan <siaran> & lainnya']);
  });

  it('shows "Tersalin", says so in the live region, and returns to "Salin" after 1.8 s', async () => {
    await runScript();
    const button = document.querySelector<HTMLButtonElement>('[data-copy-text]')!;
    expect(state(button)).toEqual({ copied: false, idle: false, done: true, said: '' });
    button.click();
    await flush();
    expect(state(button)).toEqual({ copied: true, idle: true, done: false, said: 'Teks tersalin ke papan klip.' });
    await vi.advanceTimersByTimeAsync(1799);
    expect(state(button).copied).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(state(button)).toEqual({ copied: false, idle: false, done: true, said: '' });
  });

  it('another click while "Tersalin" is showing restarts the 1.8 s', async () => {
    await runScript();
    const button = document.querySelector<HTMLButtonElement>('[data-copy-text]')!;
    button.click();
    await flush();
    await vi.advanceTimersByTimeAsync(1500);
    button.click();
    await flush();
    await vi.advanceTimersByTimeAsync(1500);
    expect(state(button).copied).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(state(button).copied).toBe(false);
  });

  it('every hook the script looks for is in src/components/ResourceCard.astro, on a native <button type="button"> with an Indonesian aria-label', () => {
    const cardSource = readFileSync(path.resolve(import.meta.dirname, '../src/components/ResourceCard.astro'), 'utf8');
    const scriptSource = readFileSync(path.resolve(import.meta.dirname, '../src/scripts/copy-button.ts'), 'utf8');
    for (const hook of ['data-copy-text', 'data-copy-idle', 'data-copy-done', 'data-copy-status']) {
      expect(scriptSource, hook).toContain(hook);
      expect(cardSource, hook).toContain(hook);
    }
    expect(cardSource).toMatch(/<button\s+type="button"\s+hidden\s+data-copy-text=\{textId\}\s+aria-label=\{`Salin teks \$\{item\.title\}`\}/);
    expect(cardSource).toMatch(/<pre\s+id=\{textId\}/);
    expect(cardSource).toContain('role="status"');
  });

  describe('when the browser refuses the clipboard', () => {
    beforeEach(() => {
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async () => Promise.reject(new Error('denied')) },
      });
    });

    it('falls back to a hidden textarea and execCommand, and removes the textarea again', async () => {
      let selected = '';
      setExecCommand(() => {
        selected = (document.querySelector('textarea') as HTMLTextAreaElement).value;
        return true;
      });
      await runScript();
      const button = document.querySelector<HTMLButtonElement>('[data-copy-text]')!;
      button.click();
      await flush();
      expect(selected).toBe('Halo!\n\n#SakolaKembara');
      expect(state(button).copied).toBe(true);
      expect(document.querySelectorAll('textarea')).toHaveLength(0);
    });

    it('shows no success when the fallback fails too, and does not throw', async () => {
      setExecCommand(() => false);
      await runScript();
      const button = document.querySelector<HTMLButtonElement>('[data-copy-text]')!;
      button.click();
      await flush();
      expect(state(button)).toEqual({ copied: false, idle: false, done: true, said: '' });
      expect(document.querySelectorAll('textarea')).toHaveLength(0);
    });

    it('shows no success when execCommand throws or does not exist', async () => {
      setExecCommand(() => {
        throw new Error('not allowed');
      });
      await runScript();
      const button = document.querySelector<HTMLButtonElement>('[data-copy-text]')!;
      button.click();
      await flush();
      expect(state(button).copied).toBe(false);
    });
  });

  it('a button whose <pre> is gone does nothing; a page without buttons runs without an error', async () => {
    await runScript();
    document.getElementById('resource-text-a')!.remove();
    const button = document.querySelector<HTMLButtonElement>('[data-copy-text="resource-text-a"]')!;
    button.click();
    await flush();
    expect(written).toEqual([]);
    expect(state(button).copied).toBe(false);

    document.body.innerHTML = '<main>no snippets here</main>';
    await runScript();
  });
});
