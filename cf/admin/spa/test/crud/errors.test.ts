import { describe, expect, test } from "vitest";
import type { ApiFailure } from "~/lib/api";
import { describeFailure, MESSAGES } from "~/lib/crud/errors";

const failure = (status: number, extra: Partial<ApiFailure> = {}): ApiFailure => ({ ok: false, status, ...extra });

describe("describeFailure", () => {
  test("the Worker's own message wins, and its fields come through", () => {
    const described = describeFailure(failure(400, { code: "invalid", message: "Periksa kembali isian formulir.", fields: { title: "Judul minimal 3 karakter" } }));
    expect(described).toEqual({ message: "Periksa kembali isian formulir.", fields: { title: "Judul minimal 3 karakter" }, stale: false });
    expect(describeFailure(failure(409, { code: "in_use", message: "Masih dipakai di: Blog. Lepaskan dulu dari sana." })).message).toBe("Masih dipakai di: Blog. Lepaskan dulu dari sana.");
    expect(describeFailure(failure(409, { code: "conflict", message: "Data bentrok.", fields: { slug: "Slug sudah dipakai" } })).fields).toEqual({ slug: "Slug sudah dipakai" });
  });

  test("a stale save is flagged, and says what happens to the form", () => {
    const described = describeFailure(failure(409, { code: "stale", message: "kalimat lain dari Worker" }));
    expect(described.stale).toBe(true);
    expect(described.message).toBe(MESSAGES.stale);
    expect(described.message).toContain("Perubahan yang belum disimpan akan hilang");
    // A 409 that is not "stale" is not one.
    expect(describeFailure(failure(409, { code: "conflict" })).stale).toBe(false);
  });

  test("every code the CRUD API answers without a message has a line of its own, never the raw code", () => {
    const cases: [ApiFailure, string][] = [
      [failure(0), MESSAGES.offline],
      [failure(401, { code: "unauthenticated" }), MESSAGES.unauthenticated],
      [failure(403, { code: "forbidden" }), MESSAGES.forbidden],
      [failure(404, { code: "not_found" }), MESSAGES.notFound],
      [failure(409, { code: "stale" }), MESSAGES.stale],
      [failure(413, { code: "too_large" }), MESSAGES.tooLarge],
      [failure(428, { code: "precondition_required" }), MESSAGES.preconditionRequired],
      [failure(400, { code: "invalid" }), MESSAGES.invalid],
      [failure(400, { code: "invalid_json" }), MESSAGES.invalid],
      [failure(400, { code: "invalid_query" }), MESSAGES.invalid],
      [failure(429, { code: "rate_limited" }), MESSAGES.rateLimited],
      [failure(500, { code: "internal" }), MESSAGES.server],
      [failure(503), MESSAGES.server],
      [failure(418, { code: "teapot" }), MESSAGES.generic],
    ];
    for (const [input, expected] of cases) {
      const { message } = describeFailure(input);
      expect(message, `${input.status} ${input.code}`).toBe(expected);
      expect(message).not.toMatch(/[a-z]+_[a-z]+/); // no snake_case code
    }
  });

  test("by status alone, when the body had no code (a proxy's error page)", () => {
    expect(describeFailure(failure(401)).message).toBe(MESSAGES.unauthenticated);
    expect(describeFailure(failure(403)).message).toBe(MESSAGES.forbidden);
    expect(describeFailure(failure(404)).message).toBe(MESSAGES.notFound);
    expect(describeFailure(failure(502)).message).toBe(MESSAGES.server);
  });

  test("a rate limit says how long to wait when the server said", () => {
    expect(describeFailure(failure(429, { code: "rate_limited", retryAfter: 60 })).message).toBe("Terlalu banyak permintaan. Coba lagi dalam 1 menit.");
    expect(describeFailure(failure(429, { retryAfter: 30 })).message).toBe("Terlalu banyak permintaan. Coba lagi dalam 30 detik.");
  });

  test("a failure that is not about fields has none", () => {
    expect(describeFailure(failure(500)).fields).toEqual({});
  });

  test("every line is Indonesian text for a person: a full sentence ending in a period", () => {
    for (const message of Object.values(MESSAGES)) expect(message).toMatch(/^[A-Z].*\.$/);
  });
});
