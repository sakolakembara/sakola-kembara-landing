// Copy buttons of /gabung-siswa/docs: the only client JS that page adds (974 B as served,
// inlined). A button (`data-copy-text="<id of the <pre>>"`) copies the text of its <pre>; the
// label swaps from "Salin" to "Tersalin" for 1.8 s (the legacy CopyButton's wording and timing)
// and a visually hidden live region says so for screen readers. The buttons ship `hidden`, so
// without the script there is no dead button: the text is still on the page to select and copy.

const COPIED_MS = 1800;

/** navigator.clipboard needs a secure context; elsewhere (and when it refuses) a hidden textarea and execCommand. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;opacity:0';
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      // the user can still select and copy by hand
    }
    area.remove();
    return ok;
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy-text]')) {
  const idle = button.querySelector<HTMLElement>('[data-copy-idle]');
  const done = button.querySelector<HTMLElement>('[data-copy-done]');
  const status = button.parentElement?.querySelector<HTMLElement>('[data-copy-status]');
  let timer: ReturnType<typeof setTimeout> | undefined;
  button.hidden = false;
  button.addEventListener('click', async () => {
    const source = document.getElementById(button.dataset.copyText ?? '');
    if (!source || !(await copyText(source.textContent ?? ''))) return;
    button.toggleAttribute('data-copied', true);
    if (idle) idle.hidden = true;
    if (done) done.hidden = false;
    if (status) status.textContent = 'Teks tersalin ke papan klip.';
    clearTimeout(timer);
    timer = setTimeout(() => {
      button.toggleAttribute('data-copied', false);
      if (idle) idle.hidden = false;
      if (done) done.hidden = true;
      if (status) status.textContent = '';
    }, COPIED_MS);
  });
}

// Marks the file as a module (so the page's import and the tests' import type-check); the bundler drops it.
export {};
