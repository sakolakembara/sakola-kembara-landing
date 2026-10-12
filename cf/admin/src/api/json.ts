/**
 * Cookies authenticate this API, and a cookie scoped to the parent domain is
 * also sent from sibling subdomains. Requiring a JSON content type closes the
 * "simple request" route for cross-site writes (a form or text/plain post
 * cannot carry it, and any other content type needs a CORS preflight, which
 * this app never grants). Returns undefined for a wrong content type or a body
 * that is not JSON; callers answer 415.
 */
export async function readJson(c: { req: { header(name: string): string | undefined; json(): Promise<unknown> } }) {
  if (!c.req.header("content-type")?.toLowerCase().startsWith("application/json")) return undefined;
  return c.req.json().catch(() => undefined);
}
