import { afterEach, describe, expect, test, vi } from "vitest";
import { daysLeft, parseOverview } from "~/lib/overview";
import { NOW, openBatch, overviewBody } from "./helpers";

describe("parseOverview", () => {
  test("reads what the Worker answers", () => {
    const overview = parseOverview(
      overviewBody({
        openBatch: openBatch({ description: "Catatan panitia" }),
        current: { state: "draft", updatedAt: "2026-10-12T00:00:00.000Z" },
        history: [{ id: "a1", batch: { year: 2025, name: "Gen 5" }, submittedAt: "2025-11-01T00:00:00.000Z", published: true }],
      }),
    );
    expect(overview).toEqual({
      now: NOW,
      student: { name: "Sari Dewi", firstName: "Sari" },
      openBatch: { ...openBatch(), description: "Catatan panitia" },
      current: { state: "draft", updatedAt: "2026-10-12T00:00:00.000Z" },
      history: [{ id: "a1", batch: { year: 2025, name: "Gen 5" }, submittedAt: "2025-11-01T00:00:00.000Z", published: true }],
    });
  });

  test("no open batch is null, not an error", () => {
    expect(parseOverview(overviewBody({ openBatch: null }))?.openBatch).toBeNull();
  });

  test("a blank description is no description; a missing first name is the legacy greeting", () => {
    expect(parseOverview(overviewBody({ openBatch: openBatch({ description: "  " }) }))?.openBatch?.description).toBeNull();
    expect(parseOverview(overviewBody({ student: { name: "", firstName: "" } }))?.student.firstName).toBe("Sakemers");
  });

  test("history is verdict-free: only whether the results are out", () => {
    const overview = parseOverview(
      overviewBody({ history: [{ id: "a1", batch: { year: 2026, name: "Gen 6" }, submittedAt: NOW, published: true, status: "accepted", result: { decision: "accepted" } }] }),
    );
    expect(overview?.history[0]).toEqual({ id: "a1", batch: { year: 2026, name: "Gen 6" }, submittedAt: NOW, published: true });
  });

  test("a history item that is not complete is skipped, not shown half", () => {
    const overview = parseOverview(overviewBody({ history: [{ id: "a1" }, null, "x", { id: "a2", batch: { year: 2026, name: "Gen 6" }, submittedAt: NOW, published: false }] }));
    expect(overview?.history.map((item) => item.id)).toEqual(["a2"]);
  });

  test.each([
    ["not an object", "x"],
    ["no clock", overviewBody({ now: "soon" })],
    ["no student", overviewBody({ student: null })],
    ["a batch without dates", overviewBody({ openBatch: openBatch({ closesAt: "later" }) })],
    ["a batch that is not an object", overviewBody({ openBatch: 5 })],
    ["an unknown state", overviewBody({ current: { state: "withdrawn" } })],
    ["a draft without its time", overviewBody({ current: { state: "draft" } })],
    ["a submission without its time", overviewBody({ current: { state: "submitted" } })],
  ])("%s is an error, not a page of blanks", (_name, body) => {
    expect(parseOverview(body)).toBeNull();
  });
});

describe("daysLeft", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("the phone's clock is never consulted: a phone set years ahead or behind changes nothing", () => {
    for (const phone of ["2020-01-01T00:00:00.000Z", "2040-01-01T00:00:00.000Z"]) {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(phone));
      expect(daysLeft("2026-10-23T03:00:00.000Z", NOW), phone).toBe(10);
      vi.useRealTimers();
    }
  });

  test("whole days until the batch closes, counted from the server's clock (the legacy rule: ceil)", () => {
    expect(daysLeft("2026-10-23T03:00:00.000Z", NOW)).toBe(10);
    expect(daysLeft("2026-10-23T03:00:01.000Z", NOW)).toBe(11);
    expect(daysLeft("2026-10-13T04:00:00.000Z", NOW)).toBe(1);
  });

  test("never below 0", () => {
    expect(daysLeft(NOW, NOW)).toBe(0);
    expect(daysLeft("2026-10-01T00:00:00.000Z", NOW)).toBe(0);
  });
});
