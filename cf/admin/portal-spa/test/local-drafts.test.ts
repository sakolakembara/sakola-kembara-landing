import { describe, expect, test, vi } from "vitest";
import { LOCAL_DRAFT_MAX_AGE_MS, LOCAL_DRAFT_PREFIX, localDraftKey, purgeStaleLocalDrafts, wipeLocalDrafts } from "~/lib/local-drafts";

// docs/cloudflare/portal-architecture.md#73-the-draft-per-step-saving-and-local-persistence: the browser keeps what a
// student has typed under sakem-portal:v1:<user id>:<batch id>, and it must go when they sign out.

const NOW = Date.parse("2026-10-13T03:00:00.000Z");
const put = (key: string, savedAt: number | null = NOW) => window.localStorage.setItem(key, JSON.stringify(savedAt === null ? { steps: {} } : { savedAt, steps: {} }));
const keys = () => Object.keys(window.localStorage).sort();

describe("the key", () => {
  test("is the user's id and the batch's, never the email", () => {
    expect(localDraftKey("u1", "b1")).toBe("sakem-portal:v1:u1:b1");
    expect(localDraftKey("u1", "b1").startsWith(LOCAL_DRAFT_PREFIX)).toBe(true);
  });
});

describe("wiping at sign-out", () => {
  test("removes every batch of that student and nobody else's", () => {
    put(localDraftKey("u1", "b1"));
    put(localDraftKey("u1", "b2"));
    put(localDraftKey("u2", "b1"));
    expect(wipeLocalDrafts("u1")).toBe(2);
    expect(keys()).toEqual([localDraftKey("u2", "b1")]);
  });

  test("a user id that is a prefix of another's does not take the other's with it", () => {
    put(localDraftKey("u1", "b1"));
    put(localDraftKey("u10", "b1"));
    wipeLocalDrafts("u1");
    expect(keys()).toEqual([localDraftKey("u10", "b1")]);
  });

  test("without a user id (a 401 for someone not known) removes every student's", () => {
    put(localDraftKey("u1", "b1"));
    put(localDraftKey("u2", "b1"));
    expect(wipeLocalDrafts(null)).toBe(2);
    expect(keys()).toEqual([]);
  });

  test("never touches what is not the portal's", () => {
    window.localStorage.setItem("theme", "dark");
    window.localStorage.setItem("sakem-portal:v0:u1:b1", "{}");
    put(localDraftKey("u1", "b1"));
    wipeLocalDrafts("u1");
    expect(keys()).toEqual(["sakem-portal:v0:u1:b1", "theme"]);
  });

  test("a browser that refuses storage has nothing to wipe and does not throw", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    put(localDraftKey("u1", "b1"));
    expect(() => wipeLocalDrafts("u1")).not.toThrow();
    expect(wipeLocalDrafts("u1")).toBe(0);
  });
});

describe("purging what is old", () => {
  test("a copy older than 30 days goes, a fresher one stays", () => {
    put(localDraftKey("u1", "old"), NOW - LOCAL_DRAFT_MAX_AGE_MS - 1);
    put(localDraftKey("u1", "edge"), NOW - LOCAL_DRAFT_MAX_AGE_MS);
    put(localDraftKey("u1", "new"), NOW - 1000);
    expect(purgeStaleLocalDrafts(NOW)).toBe(1);
    expect(keys()).toEqual([localDraftKey("u1", "edge"), localDraftKey("u1", "new")]);
  });

  test("a value that cannot say when it was written cannot be told to be fresh: it goes", () => {
    put(localDraftKey("u1", "no-time"), null);
    window.localStorage.setItem(localDraftKey("u1", "junk"), "not json");
    window.localStorage.setItem(localDraftKey("u1", "text-time"), JSON.stringify({ savedAt: "yesterday" }));
    expect(purgeStaleLocalDrafts(NOW)).toBe(3);
    expect(keys()).toEqual([]);
  });

  test("never touches what is not the portal's", () => {
    window.localStorage.setItem("theme", "dark");
    window.localStorage.setItem("something-else", JSON.stringify({ savedAt: 1 }));
    expect(purgeStaleLocalDrafts(NOW)).toBe(0);
    expect(keys()).toEqual(["something-else", "theme"]);
  });

  test("a browser that refuses to read storage does not throw", () => {
    put(localDraftKey("u1", "b1"), NOW - LOCAL_DRAFT_MAX_AGE_MS * 2);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(() => purgeStaleLocalDrafts(NOW)).not.toThrow();
  });
});
