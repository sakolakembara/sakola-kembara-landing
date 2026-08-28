import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/db", () => {
  const chain = {
    query: {
      users: {
        findFirst: vi.fn(),
      },
    },
    insert: vi.fn(),
  };
  return { db: chain };
});

import { db } from "@/lib/db";
import { createStudentAccount } from "@/lib/student-signup-service";

const dbMock = db as unknown as {
  query: { users: { findFirst: ReturnType<typeof vi.fn> } };
  insert: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createStudentAccount", () => {
  test("returns email_taken when the account already has a password", async () => {
    dbMock.query.users.findFirst.mockResolvedValueOnce({
      id: "u-1",
      passwordHash: "$2b$10$abc",
    });
    const r = await createStudentAccount({
      email: "taken@example.com",
      name: "Nama",
      password: "supersecret",
    });
    expect(r).toEqual({ ok: false, reason: "email_taken" });
  });

  test("returns email_taken_no_password when the account is Google-only", async () => {
    dbMock.query.users.findFirst.mockResolvedValueOnce({
      id: "u-2",
      passwordHash: null,
    });
    const r = await createStudentAccount({
      email: "google@example.com",
      name: "Nama",
      password: "supersecret",
    });
    // Distinct reason so the UI can nudge to "Masuk dengan Google" instead
    // of "email sudah dipakai — daftar lagi".
    expect(r).toEqual({ ok: false, reason: "email_taken_no_password" });
  });

  test("creates a fresh account with bcrypt hash and role=student", async () => {
    dbMock.query.users.findFirst.mockResolvedValueOnce(null);
    dbMock.insert.mockImplementationOnce(() => ({
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: "new-user" }]),
    }));

    const r = await createStudentAccount({
      email: "  New@Example.com  ",
      name: "Siti Aminah",
      password: "brand-new-pass",
    });
    expect(r).toEqual({ ok: true, id: "new-user" });

    const inserted = (dbMock.insert.mock.results[0]!.value as {
      values: ReturnType<typeof vi.fn>;
    }).values.mock.calls[0][0];
    expect(inserted.email).toBe("new@example.com");
    expect(inserted.name).toBe("Siti Aminah");
    expect(inserted.role).toBe("student");
    expect(inserted.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  test("maps a concurrent-insert unique violation to email_taken", async () => {
    // A double-submitted signup form races two inserts past the existence
    // check; only users_email_unique stops the second. That must read as
    // "already taken", not a 500.
    dbMock.query.users.findFirst.mockResolvedValueOnce(null);
    dbMock.insert.mockReturnValueOnce({
      values: () => ({
        returning: async () => {
          const err: Error & { code?: string } = new Error(
            'duplicate key value violates unique constraint "users_email_unique"',
          );
          err.code = "23505";
          throw err;
        },
      }),
    });

    const r = await createStudentAccount({
      email: "race@example.com",
      name: "Nama",
      password: "supersecret",
    });
    expect(r).toEqual({ ok: false, reason: "email_taken" });
  });

  test("still propagates a non-unique-violation database error", async () => {
    dbMock.query.users.findFirst.mockResolvedValueOnce(null);
    dbMock.insert.mockReturnValueOnce({
      values: () => ({
        returning: async () => {
          const err: Error & { code?: string } = new Error("connection lost");
          err.code = "08006";
          throw err;
        },
      }),
    });

    await expect(
      createStudentAccount({
        email: "boom@example.com",
        name: "Nama",
        password: "supersecret",
      }),
    ).rejects.toThrow("connection lost");
  });
});
