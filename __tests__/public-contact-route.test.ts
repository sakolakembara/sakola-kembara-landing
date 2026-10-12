import { beforeEach, describe, expect, test, vi } from "vitest";

// lib/env is frozen at import time; mock it so each test picks the secret.
const { envMock } = vi.hoisted(() => ({
  envMock: { PUBLIC_API_SHARED_SECRET: undefined as string | undefined },
}));
vi.mock("@/lib/env", () => ({ env: envMock }));

// Same boundaries as the other route/service tests: the DB, the limiter, the
// audit writer and Next's cache invalidation are mocked; lib/contact (the
// validation and write logic shared with the on-site form) and the signature
// check run for real.
const { findFirst, returning, insertValues, rateLimitMock, writeAuditMock, revalidateTagMock, revalidatePathMock } =
  vi.hoisted(() => {
    const returning = vi.fn();
    return {
      findFirst: vi.fn(),
      returning,
      insertValues: vi.fn(() => ({ returning })),
      rateLimitMock: vi.fn(),
      writeAuditMock: vi.fn(),
      revalidateTagMock: vi.fn(),
      revalidatePathMock: vi.fn(),
    };
  });
vi.mock("@/lib/db", () => ({
  db: {
    query: { contactMessages: { findFirst } },
    insert: vi.fn(() => ({ values: insertValues })),
  },
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: rateLimitMock }));
vi.mock("@/lib/audit", () => ({ writeAudit: writeAuditMock }));
vi.mock("next/cache", () => ({
  revalidateTag: revalidateTagMock,
  revalidatePath: revalidatePathMock,
}));

import { POST } from "@/app/api/public/contact/route";
import { signRequest } from "@/lib/public-api/signing";

const SECRET = "0123456789abcdef0123456789abcdef";
const VISITOR_IP = "203.0.113.7";

const validPayload = {
  fullName: "  Budi Santoso ",
  email: "Budi@Example.com",
  subject: "other",
  message: "Halo, saya ingin bertanya soal program.",
  website: "",
};

function nowSeconds(): string {
  return String(Math.floor(Date.now() / 1000));
}

interface SignedOptions {
  body?: string;
  timestamp?: string;
  /** Sign with this timestamp but send `timestamp` (or vice versa). */
  signature?: string;
  clientIp?: string | null;
  headers?: Record<string, string>;
}

/** A correctly signed request unless an option overrides a part of it. */
function signed(opts: SignedOptions = {}): Request {
  const body = opts.body ?? JSON.stringify(validPayload);
  const timestamp = opts.timestamp ?? nowSeconds();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-sakem-timestamp": timestamp,
    "x-sakem-signature": opts.signature ?? signRequest(SECRET, timestamp, body),
    // What the request itself looks like to the origin: a Cloudflare address.
    "cf-connecting-ip": "198.51.100.200",
    ...opts.headers,
  };
  if (opts.clientIp !== null) {
    headers["x-sakem-client-ip"] = opts.clientIp ?? VISITOR_IP;
  }
  return new Request("https://origin.example/api/public/contact", {
    method: "POST",
    headers,
    body,
  });
}

async function call(req: Request) {
  const res = await POST(req);
  return { res, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  envMock.PUBLIC_API_SHARED_SECRET = SECRET;
  rateLimitMock.mockResolvedValue({
    allowed: true,
    count: 1,
    limit: 5,
    resetAt: Date.now() + 60_000,
  });
  findFirst.mockResolvedValue(undefined);
  returning.mockResolvedValue([{ id: "11111111-1111-1111-1111-111111111111" }]);
});

describe("POST /api/public/contact: configuration", () => {
  test("answers 503 when the shared secret is not set, touching nothing", async () => {
    envMock.PUBLIC_API_SHARED_SECRET = undefined;
    const { res, body } = await call(signed());
    expect(res.status).toBe(503);
    expect(body).toEqual({ error: "service_unavailable" });
    expect(rateLimitMock).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });
});

describe("POST /api/public/contact: signature", () => {
  test("201 with a valid signature", async () => {
    const { res, body } = await call(signed());
    expect(res.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("401 without signature headers", async () => {
    const req = new Request("https://origin.example/api/public/contact", {
      method: "POST",
      body: JSON.stringify(validPayload),
      headers: { "x-sakem-client-ip": VISITOR_IP },
    });
    const { res, body } = await call(req);
    expect(res.status).toBe(401);
    expect(body).toEqual({ error: "unauthorized", reason: "missing_headers" });
    expect(insertValues).not.toHaveBeenCalled();
  });

  test("401 for a signature made with another secret", async () => {
    const timestamp = nowSeconds();
    const wrong = signRequest("another-secret-that-is-32-chars-long", timestamp, JSON.stringify(validPayload));
    const { res, body } = await call(signed({ timestamp, signature: wrong }));
    expect(res.status).toBe(401);
    expect(body.reason).toBe("signature_mismatch");
  });

  test("401 when the body was tampered with after signing", async () => {
    const timestamp = nowSeconds();
    const original = JSON.stringify(validPayload);
    const tampered = JSON.stringify({ ...validPayload, email: "attacker@example.com" });
    const { res, body } = await call(
      signed({
        body: tampered,
        timestamp,
        signature: signRequest(SECRET, timestamp, original),
      }),
    );
    expect(res.status).toBe(401);
    expect(body.reason).toBe("signature_mismatch");
    expect(insertValues).not.toHaveBeenCalled();
  });

  test("401 for an expired timestamp (replay of an old signed request)", async () => {
    const stale = String(Math.floor(Date.now() / 1000) - 6 * 60);
    const { res, body } = await call(signed({ timestamp: stale }));
    expect(res.status).toBe(401);
    expect(body.reason).toBe("timestamp_out_of_window");
    expect(insertValues).not.toHaveBeenCalled();
  });

  test("401 for a timestamp edited after signing", async () => {
    const original = nowSeconds();
    const sig = signRequest(SECRET, original, JSON.stringify(validPayload));
    const { res, body } = await call(
      signed({ timestamp: String(Number(original) + 10), signature: sig }),
    );
    expect(res.status).toBe(401);
    expect(body.reason).toBe("signature_mismatch");
  });

  test("an unsigned request never reaches the rate limiter or the DB", async () => {
    const { res } = await call(signed({ signature: "0".repeat(64) }));
    expect(res.status).toBe(401);
    expect(rateLimitMock).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });
});

describe("POST /api/public/contact: client IP and rate limit", () => {
  test("buckets by the signed X-Sakem-Client-Ip, not the request's own address", async () => {
    await call(signed({ clientIp: "203.0.113.99" }));
    expect(rateLimitMock).toHaveBeenCalledTimes(1);
    expect(rateLimitMock).toHaveBeenCalledWith({
      action: "contact.submit",
      limit: 5,
      windowSeconds: 60,
      ip: "203.0.113.99",
    });
  });

  test("accepts an IPv6 client address", async () => {
    await call(signed({ clientIp: "2001:db8::1" }));
    expect(rateLimitMock).toHaveBeenCalledWith(
      expect.objectContaining({ ip: "2001:db8::1" }),
    );
  });

  test("400 when the client IP header is missing or not an IP", async () => {
    for (const clientIp of [null, "", "not-an-ip", "203.0.113.7, 10.0.0.1"]) {
      const { res, body } = await call(signed({ clientIp }));
      expect(res.status).toBe(400);
      expect(body.error).toBe("invalid_client_ip");
    }
    expect(rateLimitMock).not.toHaveBeenCalled();
  });

  test("429 with Retry-After when the visitor is over the limit", async () => {
    rateLimitMock.mockResolvedValue({
      allowed: false,
      count: 6,
      limit: 5,
      resetAt: Date.now() + 42_000,
    });
    const { res, body } = await call(signed());
    expect(res.status).toBe(429);
    expect(body.error).toBe("rate_limited");
    expect(body.message).toMatch(/Terlalu banyak percobaan/);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(Number(res.headers.get("retry-after"))).toBeLessThanOrEqual(42);
    expect(insertValues).not.toHaveBeenCalled();
  });
});

describe("POST /api/public/contact: payload", () => {
  test("400 invalid_json for a signed body that is not JSON", async () => {
    const { res, body } = await call(signed({ body: "not json {" }));
    expect(res.status).toBe(400);
    expect(body.error).toBe("invalid_json");
  });

  test("400 validation_failed with field errors in the form's wording", async () => {
    const { res, body } = await call(
      signed({
        body: JSON.stringify({
          fullName: "B",
          email: "bukan-email",
          subject: "unknown",
          message: "pendek",
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect(body.error).toBe("validation_failed");
    expect(body.message).toBe("Silakan periksa kembali isian formulir.");
    expect(body.fieldErrors).toEqual({
      fullName: ["Nama lengkap minimal 2 karakter"],
      email: ["Format email belum benar"],
      subject: ["Pilih salah satu subjek"],
      message: ["Tulis minimal 10 karakter"],
    });
    expect(insertValues).not.toHaveBeenCalled();
  });

  test("400 for a JSON body that is not an object", async () => {
    const { res, body } = await call(signed({ body: "[1,2,3]" }));
    expect(res.status).toBe(400);
    expect(body.error).toBe("validation_failed");
  });

  test("400 body_too_large for an oversized signed body", async () => {
    const big = JSON.stringify({ ...validPayload, message: "x".repeat(40_000) });
    const { res, body } = await call(signed({ body: big }));
    expect(res.status).toBe(400);
    expect(body.error).toBe("body_too_large");
    expect(insertValues).not.toHaveBeenCalled();
  });

  test("the honeypot field is optional", async () => {
    const withoutHoneypot = {
      fullName: validPayload.fullName,
      email: validPayload.email,
      subject: validPayload.subject,
      message: validPayload.message,
    };
    const { res } = await call(signed({ body: JSON.stringify(withoutHoneypot) }));
    expect(res.status).toBe(201);
    expect(insertValues).toHaveBeenCalledTimes(1);
  });

  test("a filled honeypot looks like success but saves nothing", async () => {
    const { res, body } = await call(
      signed({ body: JSON.stringify({ ...validPayload, website: "http://spam.example" }) }),
    );
    expect(res.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(insertValues).not.toHaveBeenCalled();
    expect(writeAuditMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/public/contact: persistence", () => {
  test("writes the normalized message, audits it and refreshes the admin tags", async () => {
    const { res, body } = await call(signed());
    expect(res.status).toBe(201);
    // The new row's id is not echoed.
    expect(body).toEqual({
      ok: true,
      message:
        "Pesan kamu sudah kami terima. Tim kami akan menghubungi via email.",
    });
    expect(insertValues).toHaveBeenCalledWith({
      fullName: "Budi Santoso",
      email: "budi@example.com",
      subject: "other",
      message: "Halo, saya ingin bertanya soal program.",
    });
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorEmail: "budi@example.com",
        action: "contact_message.submit",
        resourceType: "contact_message",
        resourceId: "11111111-1111-1111-1111-111111111111",
      }),
    );
    expect(revalidateTagMock).toHaveBeenCalledWith("contact-messages", "max");
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/messages");
  });

  test("429 duplicate_recent when the same email wrote within 5 minutes", async () => {
    findFirst.mockResolvedValue({ id: "existing" });
    const { res, body } = await call(signed());
    expect(res.status).toBe(429);
    expect(body.error).toBe("duplicate_recent");
    expect(body.message).toMatch(/baru saja dikirim/);
    expect(res.headers.get("retry-after")).not.toBeNull();
    expect(insertValues).not.toHaveBeenCalled();
    expect(revalidateTagMock).not.toHaveBeenCalled();
  });
});
