import { describe, expect, test } from "vitest";
import { activityHref, activityLabel } from "~/lib/audit";

// The label and the link of an audit action, for the Aktivitas page (Sistem).
// The dashboard no longer shows an activity block (decided by Dzul, SAKEM-082).

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
