import { createHmac, timingSafeEqual } from "node:crypto";

// Request signing for the server-to-server endpoints under /api/public that
// change state (today: POST /api/public/contact). The caller is the Astro
// Worker, which shares PUBLIC_API_SHARED_SECRET with this app. Algorithm and
// a signing example: docs/cloudflare/content-api.md.
//
//   signature = hex( HMAC-SHA256( key = UTF-8 bytes of the secret,
//                                 data = timestamp + "." + rawBody ) )
//
// `timestamp` is Unix seconds as a decimal string, `rawBody` the exact bytes
// sent. The receiver recomputes the MAC over the bytes it received, compares
// in constant time, and rejects timestamps more than MAX_CLOCK_SKEW_SECONDS
// away from its own clock (past or future).

export const TIMESTAMP_HEADER = "x-sakem-timestamp";
export const SIGNATURE_HEADER = "x-sakem-signature";
/** Visitor IP; trusted only once the signature verified (see rate-limit.ts). */
export const CLIENT_IP_HEADER = "x-sakem-client-ip";

/** Replay window: a signed request is accepted for 5 minutes either side. */
export const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

const TIMESTAMP_PATTERN = /^\d{1,12}$/;
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/i;

export function signRequest(
  secret: string,
  timestamp: string,
  rawBody: string | Uint8Array,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest("hex");
}

export type SignatureFailure =
  | "missing_headers"
  | "timestamp_out_of_window"
  | "signature_mismatch";

export type SignatureVerdict = { ok: true } | { ok: false; reason: SignatureFailure };

export function verifyRequestSignature(opts: {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  rawBody: string | Uint8Array;
  /** Injectable clock for tests; Unix seconds. */
  nowSeconds?: number;
}): SignatureVerdict {
  const { secret, timestamp, signature, rawBody } = opts;
  if (!timestamp || !signature) return { ok: false, reason: "missing_headers" };

  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (
    !TIMESTAMP_PATTERN.test(timestamp) ||
    Math.abs(now - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS
  ) {
    return { ok: false, reason: "timestamp_out_of_window" };
  }

  // timingSafeEqual throws on unequal lengths; a well-formed signature is
  // always 64 hex chars, so reject anything else up front.
  if (!SIGNATURE_PATTERN.test(signature)) {
    return { ok: false, reason: "signature_mismatch" };
  }
  const expected = Buffer.from(signRequest(secret, timestamp, rawBody), "hex");
  const provided = Buffer.from(signature, "hex");
  if (!timingSafeEqual(expected, provided)) {
    return { ok: false, reason: "signature_mismatch" };
  }
  return { ok: true };
}
