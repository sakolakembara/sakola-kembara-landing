import { describe, expect, test } from "vitest";
import {
  MAX_CLOCK_SKEW_SECONDS,
  signRequest,
  verifyRequestSignature,
} from "@/lib/public-api/signing";

const SECRET = "0123456789abcdef0123456789abcdef";
const TS = "1760000000";
const BODY =
  '{"fullName":"Budi Santoso","email":"budi@example.com","subject":"other","message":"Halo, saya ingin bertanya soal program.","website":""}';
// Computed outside this code base:
//   printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex
// The same vector is in docs/cloudflare/content-api.md for the Astro side.
const KNOWN_SIGNATURE =
  "100be0a7675a05a0ce1be2619094b68d1bd9a269f233f58248cd01a6afa030e4";

const NOW = Number(TS);

function verify(
  over: Partial<Parameters<typeof verifyRequestSignature>[0]> = {},
) {
  return verifyRequestSignature({
    secret: SECRET,
    timestamp: TS,
    signature: KNOWN_SIGNATURE,
    rawBody: BODY,
    nowSeconds: NOW,
    ...over,
  });
}

describe("signRequest", () => {
  test("matches the reference HMAC-SHA256 over `${timestamp}.${body}`", () => {
    expect(signRequest(SECRET, TS, BODY)).toBe(KNOWN_SIGNATURE);
  });

  test("signs the same for a string body and its UTF-8 bytes", () => {
    const body = '{"message":"Halo, apa kabar? é ü 你好"}';
    expect(signRequest(SECRET, TS, Buffer.from(body, "utf8"))).toBe(
      signRequest(SECRET, TS, body),
    );
  });
});

describe("verifyRequestSignature", () => {
  test("accepts a valid signature", () => {
    expect(verify()).toEqual({ ok: true });
  });

  test("accepts an upper-case hex signature", () => {
    expect(verify({ signature: KNOWN_SIGNATURE.toUpperCase() })).toEqual({
      ok: true,
    });
  });

  test("rejects a missing timestamp or signature", () => {
    expect(verify({ timestamp: null })).toEqual({
      ok: false,
      reason: "missing_headers",
    });
    expect(verify({ signature: null })).toEqual({
      ok: false,
      reason: "missing_headers",
    });
  });

  test("rejects a signature made with another secret", () => {
    const other = signRequest("another-secret-that-is-32-chars-long", TS, BODY);
    expect(verify({ signature: other })).toEqual({
      ok: false,
      reason: "signature_mismatch",
    });
  });

  test("rejects a tampered body", () => {
    expect(verify({ rawBody: BODY.replace("Budi", "Budo") })).toEqual({
      ok: false,
      reason: "signature_mismatch",
    });
  });

  test("rejects a signature that was made for another timestamp", () => {
    // Moving the timestamp inside the window must not reuse the old MAC.
    expect(verify({ timestamp: String(NOW + 1) })).toEqual({
      ok: false,
      reason: "signature_mismatch",
    });
  });

  test("rejects malformed signatures without throwing", () => {
    for (const signature of ["", "abc", "z".repeat(64), KNOWN_SIGNATURE + "00"]) {
      expect(verify({ signature })).toMatchObject({ ok: false });
    }
  });

  test("rejects a timestamp older than the window (replay)", () => {
    const old = String(NOW - MAX_CLOCK_SKEW_SECONDS - 1);
    expect(
      verify({ timestamp: old, signature: signRequest(SECRET, old, BODY) }),
    ).toEqual({ ok: false, reason: "timestamp_out_of_window" });
  });

  test("rejects a timestamp too far in the future", () => {
    const future = String(NOW + MAX_CLOCK_SKEW_SECONDS + 1);
    expect(
      verify({ timestamp: future, signature: signRequest(SECRET, future, BODY) }),
    ).toEqual({ ok: false, reason: "timestamp_out_of_window" });
  });

  test("accepts timestamps exactly on the window edge", () => {
    for (const ts of [NOW - MAX_CLOCK_SKEW_SECONDS, NOW + MAX_CLOCK_SKEW_SECONDS]) {
      const timestamp = String(ts);
      expect(
        verify({ timestamp, signature: signRequest(SECRET, timestamp, BODY) }),
      ).toEqual({ ok: true });
    }
  });

  test("rejects a non-numeric timestamp even with a matching MAC", () => {
    for (const timestamp of ["abc", "1.5e9", "-1", "1760000000 ", "0x10"]) {
      expect(
        verify({ timestamp, signature: signRequest(SECRET, timestamp, BODY) }),
      ).toEqual({ ok: false, reason: "timestamp_out_of_window" });
    }
  });
});
