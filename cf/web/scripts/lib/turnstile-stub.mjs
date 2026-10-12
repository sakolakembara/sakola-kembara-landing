// A stand-in for Cloudflare's Turnstile script, for the DOM runs of scripts/e2e.mjs and nothing else.
//
// There is no flag in the site that swaps Cloudflare's script for this one, so there is nothing to switch
// on by mistake in production. The tests do it from outside: they take the HTML the built Worker serves,
// strip every <script> tag (so the real script is never requested), put the page in a DOM, evaluate the
// page's own inline scripts and then this file's `source`, which defines `window.turnstile` the way the
// real script does (render, reset, and the hidden `cf-turnstile-response` field in the form). The page's
// widget script (src/scripts/turnstile-widget.ts) sees an ordinary `window.turnstile`.
//
// What the real widget does that this one imitates: `render(container, options)` returns a widget id,
// remembers the options, and appends `<input type="hidden" name="cf-turnstile-response">` to the form that
// contains the container, holding a token; `reset(id)` replaces the token. What it does not do: any
// challenge, any network request, any iframe.

/** The token the stand-in "solves" with; Cloudflare's own dummy token for the test keys has the same shape. */
export const STUB_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

/** Source of the stand-in, to be evaluated in the DOM window (`window.eval`). `window.__turnstileStub` records what the page asked for. */
export const turnstileStubSource = `
(() => {
  const calls = { renders: [], resets: [] };
  let count = 0;
  window.__turnstileStub = calls;
  window.turnstile = {
    render(container, options) {
      const id = 'stub-widget-' + (++count);
      calls.renders.push({ id, options: { ...options } });
      const form = container.closest('form');
      let field = form && form.querySelector('input[name="cf-turnstile-response"]');
      if (form && !field) {
        field = form.ownerDocument.createElement('input');
        field.type = 'hidden';
        field.name = 'cf-turnstile-response';
        form.appendChild(field);
      }
      if (field) field.value = '${STUB_TOKEN}.' + count;
      return id;
    },
    reset(id) {
      calls.resets.push(id);
      const field = document.querySelector('input[name="cf-turnstile-response"]');
      if (field) field.value = '${STUB_TOKEN}.reset' + calls.resets.length;
    },
  };
})();
`;
