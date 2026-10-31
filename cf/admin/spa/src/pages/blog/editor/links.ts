/**
 * What a person typed for a link, made into an address the Worker will keep, or null when it cannot be one.
 * A page of this site ("/program/pembinaan") and a place in this page ("#bagian") stay as written; "mailto:" and
 * "tel:" too; an address without a scheme gets "https://" ("sakolakembara.org" is a site, not a page of ours);
 * any other scheme ("javascript:", "data:") is refused, as the Worker's own sanitiser would, so the person is told now.
 */
export function tidyHref(input: string): string | null {
  const text = input.trim();
  if (text === "") return null;
  if (text.startsWith("//")) return null; // another site's address without its scheme: not ours to guess
  if (text.startsWith("/")) return text;
  if (text.startsWith("#")) return text;
  if (/^(mailto|tel):\S+$/i.test(text)) return text;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "http:" || url.protocol === "https:" ? withScheme : null;
  } catch {
    return null;
  }
}
