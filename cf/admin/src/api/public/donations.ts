import { Hono, type Context } from "hono";
import type { Bindings } from "../../env";
import { CACHE_NONE } from "../../public/cache";
import { isIpLiteral } from "../../public/contact";
import { sharedRateLimiter, sharedTurnstile, type ContactDeps } from "../../public/contact-deps";
import type { LimitEnv } from "../../security/rate-limit";
import { isUuid } from "../../private-files/key";
import { DONATION_MESSAGES, parseDonationInput, parseSource } from "../../donations/rules";
import { createDonation, readDonation, setDonationSource, summaryOf, updateDonation } from "../../donations/store";
import { DONATION_TOKEN_HEADER, hashDonationToken, isDonationToken, newDonationToken } from "../../donations/token";
import { storeProof } from "../../donations/proof";
import { CLIENT_IP_HEADER, TURNSTILE_TOKEN_HEADER } from "./contact";
import { requireServiceBinding, type InternalEnv } from "./internal";

// The donor's side of the /donasi form (SAKEM-128, docs/cloudflare/donations.md), reachable only through the service
// binding, like the contact route next to it. The site's Worker sends what the visitor typed and keeps the token this
// returns in an HttpOnly cookie; every later call carries it in X-Sakem-Donation-Token.
//
//   POST /api/public/donations              step 1: create (Turnstile) or, with { id } and the token, change before a check
//   GET  /api/public/donations/:id          the donor's own summary (token)
//   PUT  /api/public/donations/:id/proof    the receipt of a one-off donation, streamed (token)
//   POST /api/public/donations/:id/source   the optional "how did you hear of us" (token)
//
// Every write is rate limited per visitor address (the contact binding, keys "donation:<address>"). Nothing about a
// person reaches a log line: failures log an error name or a fixed code.

export const DONATION_MAX_BODY_BYTES = 8 * 1024;

const headers = { "Cache-Control": CACHE_NONE };

/** The collaborators, as for the contact route; `deps` is a parameter so tests bring their own limiter, bot check and clock. */
export function resolveDonationDeps(env: Pick<Bindings, "ENVIRONMENT" | "TURNSTILE_SECRET_KEY"> & LimitEnv): ContactDeps {
  return { rateLimiter: sharedRateLimiter(env), verifyTurnstile: sharedTurnstile(env, "donation"), now: Date.now };
}

async function readCappedJson(request: Request, max: number): Promise<{ ok: true; value: unknown } | { ok: false; error: "body_too_large" | "invalid_json" }> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return { ok: false, error: "body_too_large" };
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > max) return { ok: false, error: "body_too_large" };
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(buffer)) };
  } catch {
    return { ok: false, error: "invalid_json" };
  }
}

type DonationContext = Context<InternalEnv>;

/** The visitor address, believed only on the internal app (the binding marked the call). */
function clientIp(c: DonationContext): string | null {
  const ip = c.req.header(CLIENT_IP_HEADER)?.trim();
  return ip && isIpLiteral(ip) ? ip.toLowerCase() : null;
}

/** The token's hash, or null for a missing or malformed token (then the answer is the same 404 as a wrong one). */
async function tokenHashOf(c: DonationContext): Promise<string | null> {
  const token = c.req.header(DONATION_TOKEN_HEADER)?.trim();
  return isDonationToken(token) ? hashDonationToken(token) : null;
}

const notFound = (c: DonationContext) => c.json({ error: "not_found", message: DONATION_MESSAGES.notFound }, 404, headers);

export function createDonationRoutes(deps: (env: Bindings) => ContactDeps = resolveDonationDeps) {
  const routes = new Hono<InternalEnv>();

  routes.onError((error, c) => {
    console.error(`[donation] failed (${error.name})`);
    return c.json({ error: "internal" }, 500, headers);
  });

  /** One hit on the limiter for this address; a refusal is the response to return. */
  async function limited(c: DonationContext, ip: string): Promise<Response | null> {
    const verdict = await deps(c.env).rateLimiter.hit(`donation:${ip}`);
    if (verdict.allowed) return null;
    const wait = Math.max(1, Math.ceil(verdict.retryAfterSeconds));
    return c.json({ error: "rate_limited", message: DONATION_MESSAGES.rateLimited, retryAfterSeconds: wait }, 429, { ...headers, "Retry-After": String(wait) });
  }

  routes.post("/donations", requireServiceBinding, async (c) => {
    const ip = clientIp(c);
    if (!ip) return c.json({ error: "invalid_client_ip" }, 400, headers);
    const refused = await limited(c, ip);
    if (refused) return refused;

    const body = await readCappedJson(c.req.raw, DONATION_MAX_BODY_BYTES);
    if (!body.ok) return c.json({ error: body.error }, 400, headers);
    const parsed = parseDonationInput(body.value);
    if (!parsed.ok) return c.json({ error: "validation_failed", message: DONATION_MESSAGES.invalid, fieldErrors: parsed.fieldErrors }, 400, headers);

    const now = deps(c.env).now();
    const id = (body.value as { id?: unknown }).id;
    if (id !== undefined) {
      // "Ubah data": the same row, opened by its token; no bot check (the token is the proof of a past one).
      const hash = await tokenHashOf(c);
      if (!isUuid(id) || !hash) return notFound(c);
      const outcome = await updateDonation(c.env.DB, id, hash, parsed.data, now);
      if (outcome.ok) return c.json({ donation: outcome.summary }, 200, headers);
      if (outcome.reason === "not_found") return notFound(c);
      const message = outcome.reason === "proof_locked" ? DONATION_MESSAGES.proofLocked : DONATION_MESSAGES.locked;
      return c.json({ error: outcome.reason, message }, 409, headers);
    }

    // After the field checks, so a typo does not spend a single-use token.
    const turnstile = c.req.header(TURNSTILE_TOKEN_HEADER)?.trim() || null;
    if (!(await deps(c.env).verifyTurnstile({ token: turnstile, ip }))) {
      return c.json({ error: "turnstile_failed", message: DONATION_MESSAGES.botCheckFailed }, 400, headers);
    }
    const token = newDonationToken();
    const donation = await createDonation(c.env.DB, parsed.data, await hashDonationToken(token), now);
    return c.json({ donation, token }, 201, headers);
  });

  routes.get("/donations/:id", requireServiceBinding, async (c) => {
    const id = c.req.param("id");
    const hash = await tokenHashOf(c);
    if (!isUuid(id) || !hash) return notFound(c);
    const row = await readDonation(c.env.DB, id, hash);
    return row ? c.json({ donation: summaryOf(row) }, 200, headers) : notFound(c);
  });

  routes.put("/donations/:id/proof", requireServiceBinding, async (c) => {
    const ip = clientIp(c);
    if (!ip) return c.json({ error: "invalid_client_ip" }, 400, headers);
    const refused = await limited(c, ip);
    if (refused) return refused;
    const id = c.req.param("id");
    const hash = await tokenHashOf(c);
    if (!isUuid(id) || !hash) return notFound(c);
    const now = deps(c.env).now();
    const outcome = await storeProof(c.env, { id, tokenHash: hash, contentLength: c.req.header("content-length"), body: c.req.raw.body, now });
    if (!outcome.ok) return c.json({ error: outcome.refusal.error, message: outcome.refusal.message }, outcome.refusal.status, headers);
    const row = await readDonation(c.env.DB, id, hash);
    return row ? c.json({ donation: summaryOf(row) }, 200, headers) : notFound(c);
  });

  routes.post("/donations/:id/source", requireServiceBinding, async (c) => {
    const ip = clientIp(c);
    if (!ip) return c.json({ error: "invalid_client_ip" }, 400, headers);
    const refused = await limited(c, ip);
    if (refused) return refused;
    const id = c.req.param("id");
    const hash = await tokenHashOf(c);
    if (!isUuid(id) || !hash) return notFound(c);
    const body = await readCappedJson(c.req.raw, DONATION_MAX_BODY_BYTES);
    if (!body.ok) return c.json({ error: body.error }, 400, headers);
    const source = parseSource((body.value as { source?: unknown } | null)?.source);
    if (!source) return c.json({ error: "validation_failed", message: DONATION_MESSAGES.invalid }, 400, headers);
    const donation = await setDonationSource(c.env.DB, id, hash, source, deps(c.env).now());
    return donation ? c.json({ donation }, 200, headers) : notFound(c);
  });

  return routes;
}
