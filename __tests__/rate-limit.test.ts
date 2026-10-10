import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Request headers seen by the limiter. Tests assign this per case; header
// names are lower-case, as Next's `headers()` returns them.
const requestHeaders = vi.hoisted(() => ({
  current: {} as Record<string, string>,
}));

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (key: string) => requestHeaders.current[key.toLowerCase()] ?? null,
  }),
}));

// In-memory replacement for the postgres row. Keyed by (key, windowStart)
// so we mimic the primary-key semantics of the real table.
const memory = new Map<string, number>();

vi.mock("@/lib/db", () => {
  const insertFn = () => ({
    values: (row: { key: string; windowStart: Date }) => ({
      onConflictDoUpdate: () => ({
        returning: async () => {
          const k = `${row.key}|${row.windowStart.toISOString()}`;
          const next = (memory.get(k) ?? 0) + 1;
          memory.set(k, next);
          return [{ hits: next }];
        },
      }),
    }),
  });
  const deleteFn = () => ({ where: async () => ({ rowCount: 0 }) });
  return {
    db: {
      insert: vi.fn(insertFn),
      delete: vi.fn(deleteFn),
    },
  };
});

import { rateLimit, resolveClientIp } from "@/lib/rate-limit";

beforeEach(() => {
  memory.clear();
  requestHeaders.current = { "cf-connecting-ip": "203.0.113.10" };
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Hit the same bucket and return the running count. */
async function hit(action = "test.ip", limit = 5): Promise<number> {
  const r = await rateLimit({ action, limit, windowSeconds: 60 });
  return r.count;
}

describe("rateLimit", () => {
  test("allows requests up to the limit and rejects the next one", async () => {
    for (let i = 1; i <= 3; i++) {
      const r = await rateLimit({
        action: "test.allow",
        limit: 3,
        windowSeconds: 60,
      });
      expect(r.allowed).toBe(true);
      expect(r.count).toBe(i);
    }
    const overflow = await rateLimit({
      action: "test.allow",
      limit: 3,
      windowSeconds: 60,
    });
    expect(overflow.allowed).toBe(false);
    expect(overflow.count).toBe(4);
  });

  test("keeps buckets isolated per action", async () => {
    await rateLimit({ action: "test.a", limit: 5, windowSeconds: 60 });
    const b = await rateLimit({
      action: "test.b",
      limit: 5,
      windowSeconds: 60,
    });
    expect(b.count).toBe(1);
  });

  test("keeps buckets isolated per extraKey", async () => {
    await rateLimit({
      action: "test.extra",
      limit: 5,
      windowSeconds: 60,
      extraKey: "user-1",
    });
    const other = await rateLimit({
      action: "test.extra",
      limit: 5,
      windowSeconds: 60,
      extraKey: "user-2",
    });
    expect(other.count).toBe(1);
  });

  test("reports resetAt as the next window boundary", async () => {
    const r = await rateLimit({
      action: "test.reset",
      limit: 1,
      windowSeconds: 60,
    });
    // resetAt should be within the next 60 s.
    const now = Date.now();
    expect(r.resetAt).toBeGreaterThan(now);
    expect(r.resetAt - now).toBeLessThanOrEqual(60_000);
  });
});

describe("rateLimit client IP", () => {
  test("a changing x-forwarded-for does not change the bucket", async () => {
    // Same trusted address, a different forwarded-for value on every request.
    expect(await hit()).toBe(1);
    for (let i = 2; i <= 5; i++) {
      requestHeaders.current = {
        "cf-connecting-ip": "203.0.113.10",
        "x-forwarded-for": `198.51.100.${i}, 203.0.113.10, 172.16.0.2`,
      };
      expect(await hit()).toBe(i);
    }
  });

  test("a changing leading x-forwarded-for entry does not change the bucket without Cloudflare", async () => {
    // No CF header: the rightmost entry (added by the nearest proxy) decides.
    for (let i = 1; i <= 4; i++) {
      requestHeaders.current = {
        "x-forwarded-for": `198.51.100.${i}, 203.0.113.10`,
      };
      expect(await hit()).toBe(i);
    }
  });

  test("different trusted addresses get different buckets", async () => {
    expect(await hit()).toBe(1);
    requestHeaders.current = { "cf-connecting-ip": "203.0.113.11" };
    expect(await hit()).toBe(1);
  });

  test("falls back to one shared bucket and warns once when no header is usable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Fresh module so the once-per-process warning flag starts unset.
    vi.resetModules();
    const fresh = await import("@/lib/rate-limit");
    requestHeaders.current = {};
    const opts = { action: "test.none", limit: 5, windowSeconds: 60 };
    expect((await fresh.rateLimit(opts)).count).toBe(1);
    expect((await fresh.rateLimit(opts)).count).toBe(2);
    expect(memory.size).toBe(1);
    expect([...memory.keys()][0]).toMatch(/^test\.none:unknown\|/);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test("perIp: false buckets by extraKey regardless of the client IP", async () => {
    const opts = {
      action: "test.account",
      limit: 5,
      windowSeconds: 60,
      extraKey: "someone@example.com",
      perIp: false,
    } as const;
    expect((await rateLimit(opts)).count).toBe(1);
    requestHeaders.current = { "cf-connecting-ip": "198.51.100.77" };
    expect((await rateLimit(opts)).count).toBe(2);
    requestHeaders.current = {};
    expect((await rateLimit(opts)).count).toBe(3);
    // A different key is a different bucket.
    const other = await rateLimit({ ...opts, extraKey: "other@example.com" });
    expect(other.count).toBe(1);
  });
});

describe("resolveClientIp", () => {
  const read = (headers: Record<string, string>) =>
    resolveClientIp({ get: (name) => headers[name.toLowerCase()] ?? null });

  test("prefers cf-connecting-ip over x-forwarded-for", () => {
    expect(
      read({
        "cf-connecting-ip": "203.0.113.10",
        "x-forwarded-for": "198.51.100.1, 172.16.0.2",
      }),
    ).toBe("203.0.113.10");
  });

  test("uses the rightmost x-forwarded-for entry, never the leftmost", () => {
    expect(
      read({ "x-forwarded-for": "198.51.100.1, 198.51.100.2, 203.0.113.10" }),
    ).toBe("203.0.113.10");
    expect(read({ "x-forwarded-for": "203.0.113.10" })).toBe("203.0.113.10");
  });

  test("accepts IPv6 and normalizes case", () => {
    expect(read({ "cf-connecting-ip": "2001:DB8::1" })).toBe("2001:db8::1");
    expect(read({ "x-forwarded-for": "198.51.100.1, 2001:db8::2" })).toBe(
      "2001:db8::2",
    );
  });

  test("ignores values that are not IP addresses", () => {
    expect(
      read({
        "cf-connecting-ip": "not-an-ip",
        "x-forwarded-for": "198.51.100.1, 203.0.113.10",
      }),
    ).toBe("203.0.113.10");
    expect(read({ "cf-connecting-ip": "1.2.3.4, 5.6.7.8" })).toBeNull();
    expect(read({ "x-forwarded-for": "198.51.100.1, garbage" })).toBeNull();
    expect(read({ "x-forwarded-for": "" })).toBeNull();
  });

  test("does not read x-real-ip", () => {
    expect(read({ "x-real-ip": "198.51.100.5" })).toBeNull();
  });

  test("returns null when no header is present", () => {
    expect(read({})).toBeNull();
  });
});
