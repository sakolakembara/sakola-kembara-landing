import { beforeEach, describe, expect, test, vi } from "vitest";

// Mock next/headers so the helper can extract an IP without a real request.
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (key: string) =>
      key === "x-forwarded-for" ? "203.0.113.10, 10.0.0.1" : null,
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

import { rateLimit } from "@/lib/rate-limit";

beforeEach(() => {
  memory.clear();
});

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

  test("uses the first x-forwarded-for entry as the IP key", async () => {
    // First hit under one action, first IP.
    await rateLimit({ action: "test.ip", limit: 5, windowSeconds: 60 });
    // Because the mocked headers() returns "203.0.113.10" as the first
    // entry, this hit should share the bucket with the previous one.
    const r = await rateLimit({
      action: "test.ip",
      limit: 5,
      windowSeconds: 60,
    });
    expect(r.count).toBe(2);
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
