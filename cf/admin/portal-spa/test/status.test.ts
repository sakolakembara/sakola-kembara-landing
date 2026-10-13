import { describe, expect, test } from "vitest";
import { announcedAt, parseResult, parseStatusItems, statusView } from "~/lib/status";

const AT = "2026-12-01T01:00:00.000Z";
const batch = { id: "b1", year: 2026, name: "Gen 6 - 2026/2027" };

describe("the privacy promise in the SPA: a verdict only when the API says the batch is announced", () => {
  test("processing says nothing about the outcome", () => {
    const view = statusView({ state: "processing" });
    expect(view).toMatchObject({ tone: "pending", eyebrow: "Sedang Diproses", headline: "Pendaftaran kamu sedang diproses" });
    expect(view.body).not.toMatch(/diterima|lolos/i);
  });

  test("a verdict the API put next to `processing` is never read", () => {
    const result = parseResult({ state: "processing", decision: "accepted", status: "accepted", notes: "Selamat!", announcedAt: AT });
    expect(result).toEqual({ state: "processing" });
    expect(statusView(result).headline).not.toBe("Kamu diterima");
  });

  test.each([
    ["no result", undefined],
    ["null", null],
    ["a string", "accepted"],
    ["a state nobody knows", { state: "withdrawn", announcedAt: AT }],
    ["decided without a decision", { state: "decided", announcedAt: AT, notes: null }],
    ["decided with a misspelt decision", { state: "decided", decision: "Accepted", announcedAt: AT, notes: null }],
    ["decided with a decision the API does not have", { state: "decided", decision: "waitlist", announcedAt: AT, notes: null }],
    ["decided without the announcement time", { state: "decided", decision: "accepted", notes: null }],
    ["awaiting a decision without the announcement time", { state: "awaiting_decision" }],
  ])("%s reads as processing, never as a verdict", (_name, raw) => {
    expect(parseResult(raw)).toEqual({ state: "processing" });
  });

  test("the three real shapes are read as they are", () => {
    expect(parseResult({ state: "awaiting_decision", announcedAt: AT })).toEqual({ state: "awaiting_decision", announcedAt: AT });
    expect(parseResult({ state: "decided", decision: "accepted", announcedAt: AT, notes: null })).toEqual({ state: "decided", decision: "accepted", announcedAt: AT, notes: null });
    expect(parseResult({ state: "decided", decision: "rejected", announcedAt: AT, notes: "Catatan." })).toEqual({ state: "decided", decision: "rejected", announcedAt: AT, notes: "Catatan." });
  });

  test("a blank note is no note", () => {
    expect(parseResult({ state: "decided", decision: "accepted", announcedAt: AT, notes: "   " })).toMatchObject({ notes: null });
  });
});

describe("the words (the legacy status page's)", () => {
  test("accepted: the default paragraph, or the committee's note", () => {
    expect(statusView({ state: "decided", decision: "accepted", announcedAt: AT, notes: null })).toEqual({
      tone: "accepted",
      eyebrow: "Selamat",
      headline: "Kamu diterima",
      body: "Selamat, kamu diterima sebagai calon siswa Sakola Kembara. Panitia akan menghubungi kamu lewat WhatsApp untuk langkah selanjutnya.",
    });
    expect(statusView({ state: "decided", decision: "accepted", announcedAt: AT, notes: "Datang ke Cililin." }).body).toBe("Datang ke Cililin.");
  });

  test("rejected: the default paragraph, or the committee's note", () => {
    expect(statusView({ state: "decided", decision: "rejected", announcedAt: AT, notes: null })).toEqual({
      tone: "rejected",
      eyebrow: "Terima Kasih",
      headline: "Belum lolos tahun ini",
      body: "Terima kasih atas kesediaan kamu mendaftar. Untuk batch ini, panitia belum bisa menerima pendaftaran kamu. Kamu boleh mencoba lagi di batch berikutnya.",
    });
    expect(statusView({ state: "decided", decision: "rejected", announcedAt: AT, notes: "Kuota penuh." }).body).toBe("Kuota penuh.");
  });

  test("announced but undecided: the odd state, with the way to the committee", () => {
    const view = statusView({ state: "awaiting_decision", announcedAt: AT });
    expect(view).toMatchObject({ tone: "pending", headline: "Menunggu keputusan" });
    expect(view.body).toContain("1×24 jam");
  });

  test("the announcement time exists only once it is announced", () => {
    expect(announcedAt({ state: "processing" })).toBeNull();
    expect(announcedAt({ state: "awaiting_decision", announcedAt: AT })).toBe(AT);
  });
});

describe("parseStatusItems", () => {
  test("reads the items, newest first as the API sent them", () => {
    const items = parseStatusItems({ items: [{ id: "a1", batch, submittedAt: AT, result: { state: "processing" } }] });
    expect(items).toEqual([{ id: "a1", batch, submittedAt: AT, result: { state: "processing" } }]);
  });

  test("an empty list is the 'belum ada pendaftaran' state, not an error", () => {
    expect(parseStatusItems({ items: [] })).toEqual([]);
  });

  test("only `result` is read: a status, a review note or a review time the API sends by mistake is dropped", () => {
    const items = parseStatusItems({
      items: [{ id: "a1", batch, submittedAt: AT, status: "accepted", reviewNotes: "Diterima", reviewedAt: AT, result: { state: "processing" } }],
    });
    expect(items?.[0]).toEqual({ id: "a1", batch, submittedAt: AT, result: { state: "processing" } });
    expect(JSON.stringify(items)).not.toMatch(/accepted|Diterima|reviewed/);
  });

  test("an item without an id, a batch or a send time is skipped", () => {
    expect(parseStatusItems({ items: [{ batch, submittedAt: AT }, { id: "a2", submittedAt: AT }, { id: "a3", batch }, null] })).toEqual([]);
  });

  test.each([null, "x", {}, { items: "no" }])("%j is an error", (raw) => {
    expect(parseStatusItems(raw)).toBeNull();
  });
});
