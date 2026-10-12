import { beforeEach, describe, expect, test, vi } from "vitest";

// The on-site form shares its validation and write path with the public API
// (lib/contact.ts). These cases pin the form's behaviour across that move.
const { findFirst, returning, insertValues, rateLimitMock, writeAuditMock } =
  vi.hoisted(() => {
    const returning = vi.fn();
    return {
      findFirst: vi.fn(),
      returning,
      insertValues: vi.fn(() => ({ returning })),
      rateLimitMock: vi.fn(),
      writeAuditMock: vi.fn(),
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
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

import { submitContactMessage } from "@/app/(public)/kontak/actions";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const valid = {
  fullName: "Budi Santoso",
  email: "budi@example.com",
  subject: "partnership",
  message: "Halo, kami ingin bekerja sama.",
};

const idle = { status: "idle" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMock.mockResolvedValue({ allowed: true, count: 1, limit: 5, resetAt: 0 });
  findFirst.mockResolvedValue(undefined);
  returning.mockResolvedValue([{ id: "id-1" }]);
});

describe("submitContactMessage", () => {
  test("saves a valid message and reports success", async () => {
    const state = await submitContactMessage(idle, form(valid));
    expect(state).toEqual({
      status: "success",
      message: "Pesan kamu sudah kami terima. Tim kami akan menghubungi via email.",
    });
    expect(insertValues).toHaveBeenCalledTimes(1);
    // Rate limit keyed by the request's own client IP (no ip override).
    expect(rateLimitMock).toHaveBeenCalledWith({
      action: "contact.submit",
      limit: 5,
      windowSeconds: 60,
    });
  });

  test("a filled honeypot answers success without saving", async () => {
    const state = await submitContactMessage(
      idle,
      form({ ...valid, website: "http://spam.example" }),
    );
    expect(state).toEqual({ status: "success", message: "OK" });
    expect(insertValues).not.toHaveBeenCalled();
  });

  test("returns per-field errors for invalid input", async () => {
    const state = await submitContactMessage(
      idle,
      form({ ...valid, fullName: "B", message: "pendek" }),
    );
    expect(state.status).toBe("error");
    expect(state.message).toBe("Silakan periksa kembali isian formulir.");
    expect(state.fieldErrors).toEqual({
      fullName: ["Nama lengkap minimal 2 karakter"],
      message: ["Tulis minimal 10 karakter"],
    });
    expect(insertValues).not.toHaveBeenCalled();
  });

  test("rejects over-limit visitors before validating", async () => {
    rateLimitMock.mockResolvedValue({ allowed: false, count: 6, limit: 5, resetAt: 0 });
    const state = await submitContactMessage(idle, form(valid));
    expect(state.status).toBe("error");
    expect(state.message).toMatch(/Terlalu banyak percobaan pengiriman/);
    expect(findFirst).not.toHaveBeenCalled();
  });

  test("rejects the same email within 5 minutes", async () => {
    findFirst.mockResolvedValue({ id: "earlier" });
    const state = await submitContactMessage(idle, form(valid));
    expect(state.status).toBe("error");
    expect(state.message).toMatch(/baru saja dikirim/);
    expect(insertValues).not.toHaveBeenCalled();
  });
});
