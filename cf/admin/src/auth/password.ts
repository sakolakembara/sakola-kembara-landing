// Password hashing for Cloudflare Workers Free (10 ms CPU per request).
//
// Why not Better Auth's default (scrypt) or bcrypt: both measured above 10 ms
// of CPU on this budget. PBKDF2-SHA256 runs inside the runtime's native
// WebCrypto, which is cheap in JS CPU terms. Workers is understood to cap
// PBKDF2 at 100,000 iterations (the local runtime does not enforce it; confirm
// on a real account), so that is both the setting and the ceiling.
//
// Stored format, one self-describing string:
//
//   pbkdf2-sha256$<iterations>$<salt, base64>$<hash, base64>
//
// Verification reads the iteration count from the string, so hashes made with
// a lower count keep working if the default changes. Rehash-on-login is a
// follow-up (Better Auth has no hook for it in the sign-in path).

const ALGORITHM = "pbkdf2-sha256";
export const PBKDF2_ITERATIONS = 100_000;
/** Ceiling for a stored count: above the platform cap it cannot verify, and an absurd value must not become a CPU bomb. */
const MAX_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  // NFKC like Better Auth's own hash, so the same typed password always maps to the same bytes.
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/** Compares two byte arrays without stopping at the first difference. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return [ALGORITHM, PBKDF2_ITERATIONS, toBase64(salt), toBase64(hash)].join("$");
}

/** Never throws: a malformed or tampered hash is simply "does not match". */
export async function verifyPassword({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  const [algorithm, iterationsText, saltText, hashText, ...extra] = hash.split("$");
  if (algorithm !== ALGORITHM || !iterationsText || !saltText || !hashText || extra.length > 0) return false;
  if (!/^[1-9]\d{0,6}$/.test(iterationsText)) return false;
  const iterations = Number(iterationsText);
  if (iterations > MAX_ITERATIONS) return false;
  const salt = fromBase64(saltText);
  const expected = fromBase64(hashText);
  if (!salt || salt.length === 0 || !expected || expected.length !== HASH_BYTES) return false;
  try {
    return timingSafeEqual(await derive(password, salt, iterations), expected);
  } catch {
    return false;
  }
}
