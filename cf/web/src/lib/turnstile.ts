// Cloudflare Turnstile on the /kontak form: the constants, the words and the two small pure helpers.
// Nothing here runs in the browser and nothing here verifies a token.
//
//   browser   the form loads Cloudflare's script (TURNSTILE_SCRIPT_URL, on /kontak only), renders the
//             widget explicitly inside the form, and Turnstile adds a hidden field named
//             `cf-turnstile-response` to the form (src/scripts/turnstile-widget.ts)
//   this      the Worker reads that field from the posted form (`turnstileToken`) and forwards it to the
//   Worker    API Worker in the header `X-Sakem-Turnstile-Token`, through the service binding
//   API       the API Worker verifies it with Siteverify (action "contact") and answers 400
//   Worker    `turnstile_failed` for a missing, failed or reused token. With a secret configured (always
//             in production) it fails closed; without one outside production the check is skipped, so
//             this Worker must NOT refuse a post that has no token: the no-JavaScript form still works
//             in local runs and CI (docs/cloudflare/public-api.md, docs/cloudflare/auth.md)
//
// The site key is public by design and comes from the Worker var TURNSTILE_SITE_KEY (set per deploy;
// locally Cloudflare's always-pass test key from dev.vars.example). There is no real key in the repo.

/** Cloudflare's script, with explicit rendering: the widget appears only when turnstile-widget.ts asks for it. Loaded on /kontak and nowhere else. */
export const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/**
 * The one origin Turnstile needs. No page, Worker or `_headers` sets a Content-Security-Policy today, so
 * there is nothing to extend; a policy added later must allow this origin in `script-src` and `frame-src`
 * (and check Cloudflare's CSP page for `connect-src`). tests/turnstile.test.ts pins it to the script URL.
 */
export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

/** The widget's `action`: Siteverify echoes it back and the API refuses a token minted for another form. */
export const TURNSTILE_ACTION = 'contact';

/** The name of the hidden field Turnstile adds to the form. */
export const TURNSTILE_RESPONSE_FIELD = 'cf-turnstile-response';

/** The header the token travels in on its way to the API (`TURNSTILE_TOKEN_HEADER` in cf/admin/src/api/public/contact.ts). */
export const TURNSTILE_TOKEN_HEADER = 'x-sakem-turnstile-token';

/** Cloudflare's documented maximum for a token (the API refuses a longer one anyway). */
export const TURNSTILE_MAX_TOKEN_LENGTH = 2048;

/** What a visitor sees. New copy, no legacy counterpart (the old form had no bot check). */
export const TURNSTILE_MESSAGES = {
  /** The API said `turnstile_failed`: the token was missing, failed or already used. The form is shown again with a fresh widget. */
  failed: 'Verifikasi gagal. Silakan coba lagi.',
  /** Inside <noscript>: the widget cannot run without JavaScript, so the form cannot be sent. */
  noScript: 'Aktifkan JavaScript untuk mengirim pesan.',
} as const;

/**
 * The widget's token from a posted form, or null. Only a value that can travel in a header is returned:
 * printable ASCII without spaces, at most TURNSTILE_MAX_TOKEN_LENGTH (a real token is base64url-like with
 * dots). Anything else is treated as no token, so the API (which decides) answers `turnstile_failed` where
 * it is enforced; nothing a client posts can break the header or the request line.
 */
export function turnstileToken(form: Record<string, unknown>): string | null {
  const value = form[TURNSTILE_RESPONSE_FIELD];
  if (typeof value !== 'string' || value.length === 0 || value.length > TURNSTILE_MAX_TOKEN_LENGTH) return null;
  return /^[\x21-\x7e]+$/.test(value) ? value : null;
}

/**
 * The site key to render the widget with, or null when none is configured (the form then has no widget,
 * no Cloudflare script and no "enable JavaScript" notice: it behaves like the form before the bot check
 * and the API decides whether a post without a token is accepted). A missing key is a deploy mistake in
 * production (the API would then refuse every post), so it is said once per render in the Worker log, in
 * fixed words.
 */
export function turnstileSiteKey(env: { TURNSTILE_SITE_KEY?: string }, warn: (message: string) => void = console.warn): string | null {
  const key = env.TURNSTILE_SITE_KEY?.trim();
  if (key) return key;
  warn('contact: TURNSTILE_SITE_KEY is not set; the form is rendered without the bot-check widget');
  return null;
}
