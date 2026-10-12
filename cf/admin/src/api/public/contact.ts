import { Hono } from "hono";
import { CACHE_NONE } from "../../public/cache";
import {
  CONTACT_DUPLICATE_WINDOW_SECONDS,
  CONTACT_MAX_BODY_BYTES,
  CONTACT_MESSAGES,
  isIpLiteral,
  parseContactInput,
  saveContactMessage,
} from "../../public/contact";
import { resolveContactDeps, type ContactDeps } from "../../public/contact-deps";
import type { Bindings } from "../../env";
import { requireServiceBinding, type InternalEnv } from "./internal";

// POST /api/public/contact: the contact form, reachable only through the
// service binding (see ./internal.ts for how that is enforced). Contract:
// docs/cloudflare/content-api.md. Checks run in the contract's order and the
// first failure answers; a message that is refused stores nothing.
//
//   body too large -> client address -> rate limit -> JSON -> fields (honeypot
//   answers 201 and stores nothing) -> bot check -> one message per email -> 201
//
// Personal data: nothing in a log line (no email, name or message text), and
// the audit row carries the subject only.

/** The visitor's address as the Astro Worker saw it. Believed only here, on the internal app. */
export const CLIENT_IP_HEADER = "x-sakem-client-ip";
/** The visitor's Turnstile token, forwarded by the Astro Worker (never part of the JSON body). */
export const TURNSTILE_TOKEN_HEADER = "x-sakem-turnstile-token";

type ContactEnv = InternalEnv;

const headers = { "Cache-Control": CACHE_NONE };

/** Reads at most `max` bytes of the body; `null` when it is longer. Never buffers more than `max` + one chunk. */
async function readCappedText(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** `deps` is a parameter so tests can run the route with their own limiter, bot check and clock. */
export function createContactRoutes(deps: (env: Bindings) => ContactDeps = resolveContactDeps) {
  const routes = new Hono<ContactEnv>();

  routes.onError((error, c) => {
    // The error name only: a D1 or runtime message can echo what was being stored.
    console.error(`[contact] failed (${error.name})`);
    return c.json({ error: "internal" }, 500, headers);
  });

  routes.post("/contact", requireServiceBinding, async (c) => {
    const text = await readCappedText(c.req.raw, CONTACT_MAX_BODY_BYTES);
    if (text === null) return c.json({ error: "body_too_large" }, 400, headers);

    const ip = c.req.header(CLIENT_IP_HEADER)?.trim();
    if (!ip || !isIpLiteral(ip)) return c.json({ error: "invalid_client_ip" }, 400, headers);

    const { rateLimiter, verifyTurnstile, now } = deps(c.env);
    const verdict = await rateLimiter.hit(`contact:${ip.toLowerCase()}`);
    if (!verdict.allowed) {
      const wait = Math.max(1, Math.ceil(verdict.retryAfterSeconds));
      return c.json({ error: "rate_limited", message: CONTACT_MESSAGES.rateLimited, retryAfterSeconds: wait }, 429, { ...headers, "Retry-After": String(wait) });
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return c.json({ error: "invalid_json" }, 400, headers);
    }

    const parsed = parseContactInput(raw);
    // The same answer as a saved message, so a bot learns nothing.
    if (parsed.kind === "honeypot") return c.json({ ok: true, message: CONTACT_MESSAGES.success }, 201, headers);
    if (parsed.kind === "invalid") {
      return c.json({ error: "validation_failed", message: CONTACT_MESSAGES.invalid, fieldErrors: parsed.fieldErrors }, 400, headers);
    }

    // After the field checks, so a typo does not spend a single-use token.
    const token = c.req.header(TURNSTILE_TOKEN_HEADER)?.trim() || null;
    if (!(await verifyTurnstile({ token, ip }))) {
      return c.json({ error: "turnstile_failed", message: CONTACT_MESSAGES.botCheckFailed }, 400, headers);
    }

    if ((await saveContactMessage(c.env.DB, parsed.data, now())) === "duplicate") {
      const wait = CONTACT_DUPLICATE_WINDOW_SECONDS;
      return c.json({ error: "duplicate_recent", message: CONTACT_MESSAGES.duplicate, retryAfterSeconds: wait }, 429, { ...headers, "Retry-After": String(wait) });
    }
    return c.json({ ok: true, message: CONTACT_MESSAGES.success }, 201, headers);
  });

  return routes;
}
