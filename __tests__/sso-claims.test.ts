import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      users: {
        findFirst: vi.fn(),
      },
    },
  },
}));

const getAcceptedPublishedBatchIdsMock = vi.fn();
vi.mock("@/lib/student-applications", () => ({
  getAcceptedPublishedBatchIds: (...args: unknown[]) =>
    getAcceptedPublishedBatchIdsMock(...args),
}));

import { db } from "@/lib/db";
import { buildSsoClaims } from "@/lib/sso-claims";

const dbMock = db as unknown as {
  query: { users: { findFirst: ReturnType<typeof vi.fn> } };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildSsoClaims", () => {
  test("returns null when the user was deleted between auth + build", async () => {
    dbMock.query.users.findFirst.mockResolvedValueOnce(null);
    expect(await buildSsoClaims("ghost")).toBeNull();
  });

  test("shapes claims for an accepted, verified student", async () => {
    dbMock.query.users.findFirst.mockResolvedValueOnce({
      id: "u-1",
      email: "budi@example.com",
      name: "Budi Santoso",
      role: "student",
      emailVerifiedAt: new Date("2026-01-05T00:00:00Z"),
    });
    getAcceptedPublishedBatchIdsMock.mockResolvedValueOnce(["batch-gen-7"]);

    expect(await buildSsoClaims("u-1")).toEqual({
      sub: "u-1",
      email: "budi@example.com",
      name: "Budi Santoso",
      emailVerified: true,
      landingRole: "student",
      acceptedInBatches: ["batch-gen-7"],
    });
  });

  test("reports an unverified email as unverified", async () => {
    dbMock.query.users.findFirst.mockResolvedValueOnce({
      id: "u-4",
      email: "belum@example.com",
      name: null,
      role: "student",
      emailVerifiedAt: null,
    });
    getAcceptedPublishedBatchIdsMock.mockResolvedValueOnce([]);

    expect((await buildSsoClaims("u-4"))?.emailVerified).toBe(false);
  });

  test("treats a missing emailVerifiedAt as unverified, not verified", async () => {
    // Regression guard. `!== null` would let undefined through as `true`,
    // which is the dangerous direction: an unverified account would be
    // announced to the LMS as verified.
    dbMock.query.users.findFirst.mockResolvedValueOnce({
      id: "u-5",
      email: "partial@example.com",
      name: null,
      role: "student",
    });
    getAcceptedPublishedBatchIdsMock.mockResolvedValueOnce([]);

    expect((await buildSsoClaims("u-5"))?.emailVerified).toBe(false);
  });

  test("carries landing admin role through as landingRole (advisory)", async () => {
    dbMock.query.users.findFirst.mockResolvedValueOnce({
      id: "u-2",
      email: "editor@example.com",
      name: "Editor",
      role: "editor",
      emailVerifiedAt: new Date("2026-01-05T00:00:00Z"),
    });
    getAcceptedPublishedBatchIdsMock.mockResolvedValueOnce([]);

    const claims = await buildSsoClaims("u-2");
    expect(claims?.landingRole).toBe("editor");
    expect(claims?.acceptedInBatches).toEqual([]);
  });

  test("event-only user has empty acceptedInBatches", async () => {
    dbMock.query.users.findFirst.mockResolvedValueOnce({
      id: "u-3",
      email: "prospect@example.com",
      name: null,
      role: "student",
      emailVerifiedAt: new Date("2026-01-05T00:00:00Z"),
    });
    getAcceptedPublishedBatchIdsMock.mockResolvedValueOnce([]);

    const claims = await buildSsoClaims("u-3");
    expect(claims?.acceptedInBatches).toEqual([]);
    expect(claims?.name).toBeNull();
  });
});
