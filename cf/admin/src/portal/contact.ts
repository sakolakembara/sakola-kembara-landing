// The two deployment-specific contact values of the wizard, kept OUT of the public repository: the admissions desk's
// WhatsApp number and the invitation link of the participants' WhatsApp group. They are optional PUBLIC variables of
// the portal Worker (`PORTAL_CONTACT_WHATSAPP`, `PORTAL_WHATSAPP_GROUP_URL`, set per deploy like `SITE_URL`), and
// `GET /portal/api/config` hands them to the SPA only when they are configured AND valid (docs/cloudflare/portal-api.md,
// 4.1). Unset, empty or invalid means "not configured": the key is absent from the answer, the wizard shows its fallback
// ("Kontak"), and the invalid value is never echoed, logged or turned into an error (an operator's typo must not put a
// script in a link or leak into a log).
//
// Pure functions, no environment, no logging: the route reads the variables and calls them.

/** A WhatsApp number as `wa.me` wants it: the country code and the number, digits only, no `+`, no spaces, no leading zero (8 to 15 digits, the length of an international number). */
const NUMBER = /^[1-9]\d{7,14}$/;

/** The number, or `undefined` when the variable is unset or not exactly that (the SPA applies the same 8 to 15 digits). */
export function contactWhatsapp(value: string | undefined | null): string | undefined {
  const text = (value ?? "").trim();
  return NUMBER.test(text) ? text : undefined;
}

/** Longest invitation address accepted. A WhatsApp group link is about 60 characters. */
export const GROUP_URL_MAX_LENGTH = 300;

/**
 * The invitation address, or `undefined`. Only `https:`, with a host, no user name or password in it, no whitespace,
 * control character, quote, angle bracket, backtick or backslash anywhere, and at most 300 characters: what survives
 * is safe to put in an `href`. It is returned as the URL parser writes it (`href`).
 */
export function whatsappGroupUrl(value: string | undefined | null): string | undefined {
  const text = (value ?? "").trim();
  if (text === "" || text.length > GROUP_URL_MAX_LENGTH) return undefined;
  if (!/^https:\/\/[^/\s]/i.test(text)) return undefined;
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f"'<>`\\]/.test(text)) return undefined;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.hostname === "" || url.username !== "" || url.password !== "") return undefined;
  return url.href;
}
