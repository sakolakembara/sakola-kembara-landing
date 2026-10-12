// Who is calling, as far as the platform can tell us. Shared by the rate
// limiter, Turnstile and the auth routes. No imports from the app, so another
// worker in this repo can copy or import it as is.

/**
 * The visitor's address, from `CF-Connecting-IP` only.
 *
 * Cloudflare's edge overwrites that header with the address it accepted the
 * connection from, so a client cannot choose it. `X-Forwarded-For` and
 * `X-Real-IP` are never read: the left side of X-Forwarded-For is whatever the
 * client typed (legacy bug SAKEM-008: the old limiter keyed on it, so a script
 * could pick a fresh bucket per request).
 *
 * A missing or malformed value gives "unknown": every such request shares one
 * bucket. That over-throttles instead of under-throttling, which is the safe
 * failure; it only happens locally, where there is no edge.
 */
export function clientIp(headers: Pick<Headers, "get">): string {
  const value = headers.get("cf-connecting-ip")?.trim().toLowerCase();
  if (!value || value.length > 45) return "unknown";
  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/;
  const ipv6 = /^[0-9a-f:]*:[0-9a-f:.]*$/;
  return ipv4.test(value) || ipv6.test(value) ? value : "unknown";
}

/** SHA-256 as lowercase hex. WebCrypto: runs natively, no JS CPU to speak of. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Lowercased, trimmed and capped like the sign-up and sign-in forms do. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase().slice(0, 254);
}

/**
 * A fixed-length stand-in for an email address, for rate limit keys: the
 * address itself never leaves the request, and the key length is bounded.
 * Callers must not use it for an empty address (all of them would share one key).
 */
export async function emailKey(email: string): Promise<string> {
  return (await sha256Hex(normalizeEmail(email))).slice(0, 32);
}
