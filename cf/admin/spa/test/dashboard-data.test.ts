import { describe, expect, test } from "vitest";
import { activityHref, activityLabel } from "~/lib/audit";
import { parseDashboard } from "~/lib/dashboard";

const attention = { pendingApplications: 7, underReviewApplications: 3, unreadMessages: 4, batch: null };
const batch = {
  id: "b1",
  year: 2026,
  phase: "awaiting_decisions",
  opensAt: "2026-08-01T00:00:00.000Z",
  closesAt: "2026-09-30T00:00:00.000Z",
  undecided: 10,
};
const item = { id: "a1", actorEmail: "x@contoh.test", action: "announcement.create", resourceType: "announcement", resourceId: "r1", createdAt: "2026-10-12T05:30:00.000Z" };

describe("parseDashboard", () => {
  test("reads the documented shape", () => {
    expect(parseDashboard({ attention: { ...attention, batch }, recentActivity: [item] })).toEqual({
      attention: { ...attention, batch },
      recentActivity: [item],
    });
  });

  test("recentActivity is optional and stays absent (the role may not read the log)", () => {
    const data = parseDashboard({ attention });
    expect(data).not.toBeNull();
    expect("recentActivity" in (data as object)).toBe(false);
  });

  test("an absent batch is null", () => {
    expect(parseDashboard({ attention: { ...attention, batch: undefined } })?.attention.batch).toBeNull();
  });

  test("an activity row missing a field is dropped, the rest stay", () => {
    const data = parseDashboard({ attention, recentActivity: [item, { id: "broken" }, "text"] });
    expect(data?.recentActivity).toEqual([item]);
  });

  test("optional activity fields default to null", () => {
    const data = parseDashboard({ attention, recentActivity: [{ id: "a", actorEmail: "x", action: "y", createdAt: "z" }] });
    expect(data?.recentActivity?.[0]).toMatchObject({ resourceType: null, resourceId: null });
  });

  test.each([
    ["no body", null],
    ["no attention", {}],
    ["a count that is not a number", { attention: { ...attention, unreadMessages: "4" } }],
    ["a negative count", { attention: { ...attention, pendingApplications: -1 } }],
    ["a missing count", { attention: { pendingApplications: 1, unreadMessages: 1, batch: null } }],
    ["an unknown batch phase", { attention: { ...attention, batch: { ...batch, phase: "soon" } } }],
    ["a batch missing a field", { attention: { ...attention, batch: { ...batch, closesAt: undefined } } }],
    ["activity that is not a list", { attention, recentActivity: "x" }],
  ])("%s is malformed", (_, body) => {
    expect(parseDashboard(body)).toBeNull();
  });

  test("counts are whole numbers", () => {
    expect(parseDashboard({ attention: { ...attention, pendingApplications: 7.9 } })?.attention.pendingApplications).toBe(7);
  });
});

describe("activity labels and links", () => {
  test("labels are the legacy ones", () => {
    expect(activityLabel("announcement.create")).toBe("Pengumuman dibuat");
    expect(activityLabel("application.accepted")).toBe("Pendaftar diterima");
  });
  test("an action with no label shows as it is", () => {
    expect(activityLabel("something.new")).toBe("something.new");
  });
  test("links point at the new routes", () => {
    expect(activityHref("announcement.update", "announcement", "r1")).toBe("/announcements/r1/edit");
    expect(activityHref("application.accepted", "application", "r2")).toBe("/applications/r2");
    expect(activityHref("batch.update", "batch", "r3")).toBe("/batches/r3");
    expect(activityHref("contact_message.read", "contact_message", "r4")).toBe("/messages/r4");
    expect(activityHref("resource.update", "site_resource", "r5")).toBe("/resources");
  });
  test("deletions, missing targets and unknown types have no link", () => {
    expect(activityHref("announcement.delete", "announcement", "r1")).toBeNull();
    expect(activityHref("announcement.update", null, "r1")).toBeNull();
    expect(activityHref("announcement.update", "announcement", null)).toBeNull();
    expect(activityHref("x.y", "mystery", "r1")).toBeNull();
  });
  test("an id is encoded, never put in the path raw", () => {
    expect(activityHref("batch.update", "batch", "../x?y")).toBe("/batches/..%2Fx%3Fy");
  });
});
