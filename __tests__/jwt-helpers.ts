/**
 * Changes one bit of a JWT's signature. It edits the signature's first
 * character, which carries six real bits. The last character would not do:
 * an HS256 signature is 32 bytes, so its base64url form ends in a character
 * whose low two bits are padding, and swapping "A" for "B" there decodes to
 * the same bytes, leaving the token valid about one run in sixteen.
 */
export function tamperSignature(token: string): string {
  const [header, payload, signature] = token.split(".");
  const flipped = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
  return [header, payload, flipped].join(".");
}
