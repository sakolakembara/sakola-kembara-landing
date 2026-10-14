import { afterEach, describe, expect, test, vi } from "vitest";
import { LOCAL_DRAFT_MAX_AGE_MS, LOCAL_DRAFT_VERSION } from "../../shared/application-form/draft";
import { clearLocal, loadLocal, saveLocal } from "../src/lib/wizard/persist";

// The wizard's copy in the browser (docs/cloudflare/portal-architecture.md#73): the key, the stamp, the age limit.

const NOW = Date.parse("2026-10-13T03:00:00.000Z");
const KEY = "sakem-portal:v1:user-1:batch-1";
const body = { stepIndex: 3, visited: ["intro", "identity", "household", "housing"] as const, values: { identity: { fullName: "Sari Dewi" } } };

afterEach(() => vi.restoreAllMocks());

describe("what is written", () => {
  test("under a key of two ids and nothing else: no email, no name", () => {
    saveLocal("user-1", "batch-1", { ...body, visited: [...body.visited] }, NOW);
    expect(Object.keys(window.localStorage)).toEqual([KEY]);
  });

  test("with the time it was written as a number of epoch milliseconds (a copy that cannot say when is purged)", () => {
    saveLocal("user-1", "batch-1", { ...body, visited: [...body.visited] }, NOW);
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
    expect(stored).toMatchObject({ version: LOCAL_DRAFT_VERSION, savedAt: NOW, stepIndex: 3 });
    expect(typeof stored.savedAt).toBe("number");
  });

  test("and the next write moves the stamp", () => {
    saveLocal("user-1", "batch-1", { ...body, visited: [...body.visited] }, NOW);
    saveLocal("user-1", "batch-1", { ...body, visited: [...body.visited] }, NOW + 5_000);
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? "null").savedAt).toBe(NOW + 5_000);
  });
});

describe("what is read", () => {
  test("a fresh copy comes back as it was written", () => {
    saveLocal("user-1", "batch-1", { ...body, visited: [...body.visited] }, NOW);
    expect(loadLocal("user-1", "batch-1", NOW + 1000)).toMatchObject({ stepIndex: 3, values: { identity: { fullName: "Sari Dewi" } } });
  });

  test("nothing there is nothing, and nothing is removed", () => {
    expect(loadLocal("user-1", "batch-1", NOW)).toBeNull();
  });

  test("another student's copy, or another batch's, is not this one's", () => {
    saveLocal("user-2", "batch-1", { ...body, visited: [...body.visited] }, NOW);
    saveLocal("user-1", "batch-0", { ...body, visited: [...body.visited] }, NOW);
    expect(loadLocal("user-1", "batch-1", NOW)).toBeNull();
    expect(window.localStorage.length).toBe(2);
  });

  test("a copy of 30 days or more is removed when it is read, one a moment younger is kept", () => {
    saveLocal("user-1", "batch-1", { ...body, visited: [...body.visited] }, NOW);
    expect(loadLocal("user-1", "batch-1", NOW + LOCAL_DRAFT_MAX_AGE_MS - 1)).not.toBeNull();
    expect(window.localStorage.getItem(KEY)).not.toBeNull();
    expect(loadLocal("user-1", "batch-1", NOW + LOCAL_DRAFT_MAX_AGE_MS)).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  test.each([
    ["not JSON", "{oops"],
    ["no time", JSON.stringify({ version: 1, stepIndex: 0, visited: ["intro"], values: {} })],
    ["a time that is text", JSON.stringify({ version: 1, savedAt: "2026-10-13", stepIndex: 0, visited: ["intro"], values: {} })],
    ["another version", JSON.stringify({ version: 2, savedAt: NOW, stepIndex: 0, visited: ["intro"], values: {} })],
    ["a screen that does not exist", JSON.stringify({ version: 1, savedAt: NOW, stepIndex: 99, visited: ["intro"], values: {} })],
    ["a bucket that does not exist", JSON.stringify({ version: 1, savedAt: NOW, stepIndex: 0, visited: ["intro"], values: { other: {} } })],
  ])("%s is not a draft: it is removed on the spot", (_name, text) => {
    window.localStorage.setItem(KEY, text);
    expect(loadLocal("user-1", "batch-1", NOW)).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});

describe("clearing", () => {
  test("removes this student's copy for this batch and no other", () => {
    saveLocal("user-1", "batch-1", { ...body, visited: [...body.visited] }, NOW);
    saveLocal("user-1", "batch-0", { ...body, visited: [...body.visited] }, NOW);
    clearLocal("user-1", "batch-1");
    expect(Object.keys(window.localStorage)).toEqual(["sakem-portal:v1:user-1:batch-0"]);
  });
});

describe("a browser that will not let the page keep anything (a private window, a full disk)", () => {
  test("writing, reading and clearing never throw", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("no", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("no", "SecurityError");
    });
    expect(() => saveLocal("user-1", "batch-1", { ...body, visited: [...body.visited] }, NOW)).not.toThrow();
    expect(loadLocal("user-1", "batch-1", NOW)).toBeNull();
    expect(() => clearLocal("user-1", "batch-1")).not.toThrow();
  });
});
