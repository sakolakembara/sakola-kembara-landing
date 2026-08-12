import { beforeEach, describe, expect, test, vi } from "vitest";

// Mock the DB layer so we test the domain logic in isolation. The service
// module imports `db` from "@/lib/db" — we replace it before importing the
// service so its top-level `db` binding picks up the mock.
vi.mock("@/lib/db", () => {
  const chain: Record<string, unknown> = {};
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn(),
  };
  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn(),
  };
  const deleteChain = {
    where: vi.fn(),
  };
  chain.query = {
    users: {
      findFirst: vi.fn(),
    },
  };
  chain.insert = vi.fn(() => insertChain);
  chain.update = vi.fn(() => updateChain);
  chain.delete = vi.fn(() => deleteChain);
  return {
    db: chain,
    __chains: { insertChain, updateChain, deleteChain },
  };
});

// countSuperAdmins is used by the service to guard the last super-admin.
vi.mock("@/lib/users", () => ({
  countSuperAdmins: vi.fn(),
}));

import { db } from "@/lib/db";
import { countSuperAdmins } from "@/lib/users";
import {
  createAdmin,
  deleteAdmin,
  updateAdmin,
} from "@/lib/admin-users-service";

// Type-narrowed handle onto the mocked db so tests can arrange behavior
// per-call. Every `db.insert(...)` / `db.update(...)` / `db.delete(...)`
// pushes a chain object onto `.mock.results[i].value` — tests set up their
// return values by re-mocking the top-level method for the next call.
const dbMock = db as unknown as {
  query: { users: { findFirst: ReturnType<typeof vi.fn> } };
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createAdmin", () => {
  test("returns duplicate_email when email already exists", async () => {
    dbMock.query.users.findFirst.mockResolvedValueOnce({ id: "existing" });
    const r = await createAdmin({
      email: "taken@example.com",
      name: "Taken",
      role: "editor",
    });
    expect(r).toEqual({ ok: false, reason: "duplicate_email" });
  });

  test("hashes password when supplied and inserts the row", async () => {
    dbMock.query.users.findFirst.mockResolvedValueOnce(null);
    // Set up the insert chain to return an id.
    dbMock.insert.mockImplementationOnce(() => ({
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: "new-id" }]),
    }));

    const r = await createAdmin({
      email: "  New@Example.com  ",
      name: "Nurul",
      role: "editor",
      password: "strong-pass-123",
    });
    expect(r).toEqual({ ok: true, id: "new-id" });

    // Confirm the insert was called with a normalized (trimmed + lowercased)
    // email and a bcrypt-shaped password_hash.
    const inserted = (dbMock.insert.mock.results[0]!.value as {
      values: ReturnType<typeof vi.fn>;
    }).values.mock.calls[0][0];
    expect(inserted.email).toBe("new@example.com");
    expect(inserted.name).toBe("Nurul");
    expect(inserted.role).toBe("editor");
    expect(inserted.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  test("leaves passwordHash null when no password supplied", async () => {
    dbMock.query.users.findFirst.mockResolvedValueOnce(null);
    dbMock.insert.mockImplementationOnce(() => ({
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: "google-only" }]),
    }));
    await createAdmin({
      email: "google@example.com",
      name: null,
      role: "viewer",
    });
    const inserted = (dbMock.insert.mock.results[0]!.value as {
      values: ReturnType<typeof vi.fn>;
    }).values.mock.calls[0][0];
    expect(inserted.passwordHash).toBeNull();
  });
});

describe("updateAdmin", () => {
  test("returns not_found when target user missing", async () => {
    dbMock.query.users.findFirst.mockResolvedValueOnce(null);
    const r = await updateAdmin({
      id: "missing",
      name: "x",
      role: "editor",
    });
    expect(r).toEqual({ ok: false, reason: "not_found" });
  });

  test("blocks demoting the last super_admin", async () => {
    dbMock.query.users.findFirst.mockResolvedValueOnce({
      id: "u1",
      email: "only@example.com",
      role: "super_admin",
    });
    (countSuperAdmins as ReturnType<typeof vi.fn>).mockResolvedValueOnce(0);
    const r = await updateAdmin({
      id: "u1",
      name: "x",
      role: "editor",
    });
    expect(r).toEqual({ ok: false, reason: "last_super_admin" });
  });

  test("succeeds and does NOT touch password when password blank", async () => {
    dbMock.query.users.findFirst.mockResolvedValueOnce({
      id: "u2",
      email: "x@example.com",
      role: "editor",
    });
    dbMock.update.mockImplementationOnce(() => ({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
    }));
    const r = await updateAdmin({
      id: "u2",
      name: "New Name",
      role: "editor",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.passwordChanged).toBe(false);

    const setCall = (dbMock.update.mock.results[0]!.value as {
      set: ReturnType<typeof vi.fn>;
    }).set.mock.calls[0][0];
    expect(setCall.passwordHash).toBeUndefined();
  });

  test("hashes password when supplied", async () => {
    dbMock.query.users.findFirst.mockResolvedValueOnce({
      id: "u3",
      email: "x@example.com",
      role: "editor",
    });
    dbMock.update.mockImplementationOnce(() => ({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
    }));
    const r = await updateAdmin({
      id: "u3",
      name: "Name",
      role: "editor",
      password: "brand-new-pass",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.passwordChanged).toBe(true);
    const setCall = (dbMock.update.mock.results[0]!.value as {
      set: ReturnType<typeof vi.fn>;
    }).set.mock.calls[0][0];
    expect(setCall.passwordHash).toMatch(/^\$2[aby]\$/);
  });
});

describe("deleteAdmin", () => {
  test("returns not_found when target missing", async () => {
    dbMock.query.users.findFirst.mockResolvedValueOnce(null);
    const r = await deleteAdmin("missing", "actor");
    expect(r).toEqual({ ok: false, reason: "not_found" });
  });

  test("returns self when actor tries to delete themselves", async () => {
    dbMock.query.users.findFirst.mockResolvedValueOnce({
      id: "same",
      email: "me@example.com",
      role: "super_admin",
    });
    const r = await deleteAdmin("same", "same");
    expect(r).toEqual({ ok: false, reason: "self" });
  });

  test("returns last_super_admin when deleting the only super", async () => {
    dbMock.query.users.findFirst.mockResolvedValueOnce({
      id: "only",
      email: "only@example.com",
      role: "super_admin",
    });
    (countSuperAdmins as ReturnType<typeof vi.fn>).mockResolvedValueOnce(0);
    const r = await deleteAdmin("only", "other-actor");
    expect(r).toEqual({ ok: false, reason: "last_super_admin" });
  });

  test("succeeds when deleting a non-super_admin", async () => {
    dbMock.query.users.findFirst.mockResolvedValueOnce({
      id: "editor-id",
      email: "editor@example.com",
      role: "editor",
    });
    dbMock.delete.mockImplementationOnce(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    }));
    const r = await deleteAdmin("editor-id", "actor");
    expect(r).toEqual({
      ok: true,
      email: "editor@example.com",
      role: "editor",
    });
  });
});
