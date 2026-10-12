import { describe, expect, test } from "vitest";
import { parseDashboard } from "~/lib/dashboard";

const pending = { count: 7, to: "/applications?status=pending" };
const underReview = { count: 3, to: "/applications?status=under_review" };
const unread = { count: 4, to: "/messages?filter=unread" };
const batch = {
  id: "b1",
  year: 2026,
  phase: "awaiting_decisions",
  opensAt: "2026-08-01T00:00:00.000Z",
  closesAt: "2026-09-30T00:00:00.000Z",
  undecided: 10,
  to: "/batches/b1",
};
const full = { pendingApplications: pending, underReviewApplications: underReview, unreadMessages: unread, batch };

describe("parseDashboard: the contract at the top of lib/dashboard.ts", () => {
  test("reads the documented shape", () => {
    expect(parseDashboard({ attention: full })).toEqual({ attention: full });
  });

  test("an item the server left out stays out (the role may not see its area)", () => {
    const data = parseDashboard({ attention: { unreadMessages: unread } });
    expect(data).toEqual({ attention: { unreadMessages: unread } });
    for (const key of ["pendingApplications", "underReviewApplications", "batch"]) expect(key in data!.attention).toBe(false);
  });

  test("every phase of the contract is read, closed_empty included", () => {
    for (const phase of ["upcoming", "open", "awaiting_decisions", "ready_to_publish", "closed_empty", "published"]) {
      expect(parseDashboard({ attention: { batch: { ...batch, phase } } })?.attention.batch?.phase, phase).toBe(phase);
    }
  });

  test("an empty attention is valid: an editor of Konten alone has nothing here", () => {
    expect(parseDashboard({ attention: {} })).toEqual({ attention: {} });
  });

  test("a null item or batch is the same as a missing one", () => {
    expect(parseDashboard({ attention: { ...full, batch: null, unreadMessages: null } })).toEqual({
      attention: { pendingApplications: pending, underReviewApplications: underReview },
    });
  });

  test("anything else the server sends is dropped, so no other block can sneak in (no activity, no recent rows)", () => {
    const data = parseDashboard({
      attention: { ...full, extra: 1 },
      recentActivity: [{ id: "a", actorEmail: "x@contoh.test", action: "y", createdAt: "z" }],
      recentApplications: [{ fullName: "Nama" }],
    });
    expect(data).toEqual({ attention: full });
    expect(JSON.stringify(data)).not.toContain("x@contoh.test");
  });

  test("counts are whole numbers", () => {
    expect(parseDashboard({ attention: { pendingApplications: { ...pending, count: 7.9 } } })?.attention.pendingApplications?.count).toBe(7);
  });

  test.each([
    ["no body", null],
    ["a body that is not an object", "x"],
    ["no attention", {}],
    ["an attention that is a list", { attention: [] }],
    ["a count that is not a number", { attention: { unreadMessages: { ...unread, count: "4" } } }],
    ["a negative count", { attention: { pendingApplications: { ...pending, count: -1 } } }],
    ["an item without a count", { attention: { unreadMessages: { to: "/messages" } } }],
    ["an item that is a bare number (the old shape)", { attention: { pendingApplications: 7 } }],
    ["an unknown batch phase", { attention: { batch: { ...batch, phase: "soon" } } }],
    ["a batch missing a field", { attention: { batch: { ...batch, closesAt: undefined } } }],
    ["a batch without a link", { attention: { batch: { ...batch, to: undefined } } }],
  ])("%s is malformed", (_, body) => {
    expect(parseDashboard(body)).toBeNull();
  });

  describe("a link must be a path of this app", () => {
    test.each([
      ["another site", "https://elsewhere.example/applications"],
      ["a protocol-relative address", "//elsewhere.example/applications"],
      ["a script", "javascript:alert(1)"],
      ["a path with a backslash", "/\\elsewhere.example"],
      ["no link", ""],
      ["a sign-in page", "/login"],
      ["something that is not a string", 7],
    ])("%s is refused", (_, to) => {
      expect(parseDashboard({ attention: { unreadMessages: { count: 1, to } } })).toBeNull();
      expect(parseDashboard({ attention: { batch: { ...batch, to } } })).toBeNull();
    });

    test("the lists' filters in the query are kept, an encoded id too", () => {
      const data = parseDashboard({ attention: { pendingApplications: pending, batch: { ...batch, to: "/batches/a%2Fb%20c" } } });
      expect(data?.attention.pendingApplications?.to).toBe("/applications?status=pending");
      expect(data?.attention.batch?.to).toBe("/batches/a%2Fb%20c");
    });
  });
});
