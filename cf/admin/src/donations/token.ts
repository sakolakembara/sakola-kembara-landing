// The capability of one donation (SAKEM-128): a random token the site's Worker keeps in the donor's browser (an HttpOnly
// cookie) and sends back as `X-Sakem-Donation-Token`. Only its SHA-256 is stored, so a copy of the database cannot add a
// receipt to anyone's donation. It opens one row, for the few things the donor may do with it (read their own summary,
// change step 1 before it is checked, add the receipt, answer the optional question), and nothing else.

export const DONATION_TOKEN_HEADER = "x-sakem-donation-token";

/** 32 random bytes, base64url without padding: 43 characters. */
export function newDonationToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** The shape `newDonationToken` makes; anything else is refused before any hashing or lookup. */
export function isDonationToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** Lowercase hex SHA-256: what `donations.token_hash` holds. */
export async function hashDonationToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
