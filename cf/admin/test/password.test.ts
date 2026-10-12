import { describe, expect, test } from "vitest";
import { hashPassword, PBKDF2_ITERATIONS, verifyPassword } from "../src/auth/password";

describe("PBKDF2 password hash", () => {
  test("verifies the password it was made from", async () => {
    const hash = await hashPassword("s3cret-pass");
    expect(await verifyPassword({ hash, password: "s3cret-pass" })).toBe(true);
  });

  test("rejects a wrong password", async () => {
    const hash = await hashPassword("s3cret-pass");
    expect(await verifyPassword({ hash, password: "s3cret-pasS" })).toBe(false);
    expect(await verifyPassword({ hash, password: "" })).toBe(false);
  });

  test("is versioned and salted: same password, different strings", async () => {
    const [a, b] = await Promise.all([hashPassword("same"), hashPassword("same")]);
    expect(a).not.toBe(b);
    const [algorithm, iterations, salt, hash] = a.split("$");
    expect(algorithm).toBe("pbkdf2-sha256");
    expect(Number(iterations)).toBe(PBKDF2_ITERATIONS);
    expect(atob(salt!).length).toBe(16);
    expect(atob(hash!).length).toBe(32);
  });

  test("normalizes unicode (NFKC), so the same typed text always verifies", async () => {
    const hash = await hashPassword("ｐａｓｓｗｏｒｄ-１２３");
    expect(await verifyPassword({ hash, password: "password-123" })).toBe(true);
  });

  test("rejects a tampered hash without throwing", async () => {
    const hash = await hashPassword("s3cret-pass");
    const [algorithm, iterations, salt, digest] = hash.split("$") as [string, string, string, string];
    // Flip one bit of the digest.
    const bytes = Uint8Array.from(atob(digest), (c) => c.charCodeAt(0));
    bytes[0] = bytes[0]! ^ 1;
    const flipped = btoa(String.fromCharCode(...bytes));

    const tampered = [
      [algorithm, iterations, salt, flipped].join("$"), // digest changed
      [algorithm, iterations, btoa("another-salt-123!"), digest].join("$"), // salt changed
      [algorithm, String(Number(iterations) - 1), salt, digest].join("$"), // iterations changed
      ["pbkdf2-sha1", iterations, salt, digest].join("$"), // algorithm changed
      hash.slice(0, -4), // truncated digest
      hash + "$extra", // extra segment
      "", // empty
      "not-a-hash",
      `${algorithm}$${iterations}$%%%$${digest}`, // not base64
      `${algorithm}$0$${salt}$${digest}`, // zero iterations
      `${algorithm}$-5$${salt}$${digest}`, // negative iterations
      `${algorithm}$100001$${salt}$${digest}`, // above the Workers ceiling
      `${algorithm}$99999999999$${salt}$${digest}`, // absurd, would be a CPU bomb if honored
    ];
    for (const candidate of tampered) {
      expect(await verifyPassword({ hash: candidate, password: "s3cret-pass" }), candidate).toBe(false);
    }
  });

  test("hashes made with a lower iteration count keep verifying (versioned string)", async () => {
    // Build a 50,000-iteration hash by hand, as if the default had been lowered before.
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("old-password"), "PBKDF2", false, ["deriveBits"]);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 50_000, hash: "SHA-256" }, key, 256));
    const hash = ["pbkdf2-sha256", 50_000, btoa(String.fromCharCode(...salt)), btoa(String.fromCharCode(...bits))].join("$");
    expect(await verifyPassword({ hash, password: "old-password" })).toBe(true);
    expect(await verifyPassword({ hash, password: "wrong" })).toBe(false);
  });
});
