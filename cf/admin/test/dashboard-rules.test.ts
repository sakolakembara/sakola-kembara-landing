import { describe, expect, test } from "vitest";
import { batchLink, batchPhase, buildDashboard, DASHBOARD_LINKS, pickBatch, type BatchRow, type UndecidedRow } from "../src/dashboard/payload";

// The rules behind GET /api/dashboard, without a database: which phase a batch
// is in, which batch the tile is about, and what is left out of the payload.

const NOW = new Date("2026-10-12T05:00:00.000Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

let counter = 0;
function batch(over: Partial<BatchRow> & { opens?: number; closes?: number } = {}): BatchRow {
  counter += 1;
  const { opens = -60, closes = -10, ...rest } = over;
  return { id: `b${counter}`, year: 2000 + counter, opensAt: day(opens), closesAt: day(closes), resultsPublishedAt: null, hasApplications: true, ...rest };
}

describe("batchPhase: the batch list's reading, with the closed state split in two", () => {
  test("before the window opens: upcoming", () => {
    expect(batchPhase(batch({ opens: 1, closes: 30 }), 0, NOW)).toBe("upcoming");
    expect(batchPhase(batch({ opens: 1, closes: 30 }), 99, NOW)).toBe("upcoming"); // undecided does not matter yet
  });

  test("inside the window: open, and both ends are inside it", () => {
    expect(batchPhase(batch({ opens: -1, closes: 5 }), 0, NOW)).toBe("open");
    expect(batchPhase({ opensAt: NOW, closesAt: day(5), resultsPublishedAt: null, hasApplications: true }, 0, NOW)).toBe("open"); // exactly at the opening
    expect(batchPhase({ opensAt: day(-5), closesAt: NOW, resultsPublishedAt: null, hasApplications: true }, 0, NOW)).toBe("open"); // exactly at the closing
    expect(batchPhase({ opensAt: day(-5), closesAt: new Date(NOW.getTime() - 1), resultsPublishedAt: null, hasApplications: true }, 0, NOW)).not.toBe("open"); // one millisecond later
  });

  test("an open or upcoming batch nobody has applied to yet is still open or upcoming", () => {
    expect(batchPhase(batch({ opens: -1, closes: 5, hasApplications: false }), 0, NOW)).toBe("open");
    expect(batchPhase(batch({ opens: 1, closes: 30, hasApplications: false }), 0, NOW)).toBe("upcoming");
  });

  test("closed with applications still undecided: awaiting_decisions", () => {
    expect(batchPhase(batch(), 1, NOW)).toBe("awaiting_decisions");
    expect(batchPhase(batch(), 120, NOW)).toBe("awaiting_decisions");
  });

  test("closed, nothing undecided, not published: ready_to_publish", () => {
    expect(batchPhase(batch(), 0, NOW)).toBe("ready_to_publish");
  });

  test("closed, not published, and nobody ever applied: closed_empty (publishing is refused for it, so it is not ready to publish)", () => {
    expect(batchPhase(batch({ hasApplications: false }), 0, NOW)).toBe("closed_empty");
    expect(batchPhase(batch({ hasApplications: true }), 0, NOW)).toBe("ready_to_publish");
  });

  test("a published batch is published, even one that has no application row any more", () => {
    expect(batchPhase(batch({ resultsPublishedAt: day(-3), hasApplications: false }), 0, NOW)).toBe("published");
  });

  test("closed and published: published, whatever is undecided", () => {
    expect(batchPhase(batch({ resultsPublishedAt: day(-3) }), 0, NOW)).toBe("published");
    expect(batchPhase(batch({ resultsPublishedAt: day(-3) }), 4, NOW)).toBe("published");
  });

  test("a batch published while still open is open (the batch list says Buka too)", () => {
    expect(batchPhase(batch({ opens: -5, closes: 5, resultsPublishedAt: day(-1) }), 0, NOW)).toBe("open");
  });
});

describe("pickBatch: the one batch the tile is about", () => {
  const none = new Map<string, number>();

  test("nothing to pick from", () => {
    expect(pickBatch([], none, NOW)).toBeNull();
  });

  test("a batch waiting for decisions beats an open one, even when the open one is newer", () => {
    const last = batch({ opens: -400, closes: -300 });
    const current = batch({ opens: -10, closes: 20 });
    const picked = pickBatch([current, last], new Map([[last.id, 12]]), NOW);
    expect(picked).toMatchObject({ batch: { id: last.id }, phase: "awaiting_decisions", undecided: 12 });
  });

  test("ready to publish ranks with awaiting decisions, and the newer of the two wins", () => {
    const older = batch({ opens: -500, closes: -400 });
    const newer = batch({ opens: -200, closes: -100 });
    expect(pickBatch([newer, older], new Map([[older.id, 3]]), NOW)?.batch.id).toBe(newer.id); // newer is ready_to_publish, older awaits: both need a person, newest first
  });

  test("open beats upcoming, upcoming beats published", () => {
    const published = batch({ opens: -400, closes: -300, resultsPublishedAt: day(-290) });
    const upcoming = batch({ opens: 30, closes: 90 });
    const open = batch({ opens: -5, closes: 5 });
    expect(pickBatch([upcoming, published], none, NOW)?.phase).toBe("upcoming");
    expect(pickBatch([upcoming, open, published], none, NOW)?.batch.id).toBe(open.id);
  });

  test("a closed batch nobody applied to ranks with the published ones: the newest of them, after anything that needs a look", () => {
    const empty = batch({ opens: -200, closes: -100, hasApplications: false });
    const published = batch({ opens: -500, closes: -400, resultsPublishedAt: day(-390) });
    expect(pickBatch([empty, published], none, NOW)?.batch.id).toBe(empty.id); // the newer of the two
    expect(pickBatch([empty, published], none, NOW)?.phase).toBe("closed_empty");
    const waiting = batch({ opens: -900, closes: -800 });
    expect(pickBatch([empty, published, waiting], new Map([[waiting.id, 1]]), NOW)?.batch.id).toBe(waiting.id);
    const upcoming = batch({ opens: 40, closes: 100 });
    expect(pickBatch([upcoming, empty], none, NOW)?.batch.id).toBe(upcoming.id);
  });

  test("of several upcoming batches the soonest to open wins", () => {
    const far = batch({ opens: 400, closes: 460 });
    const soon = batch({ opens: 20, closes: 80 });
    expect(pickBatch([far, soon], none, NOW)?.batch.id).toBe(soon.id);
  });

  test("of several published batches the newest wins", () => {
    const old = batch({ opens: -800, closes: -700, resultsPublishedAt: day(-690) });
    const recent = batch({ opens: -400, closes: -300, resultsPublishedAt: day(-290) });
    expect(pickBatch([old, recent], none, NOW)?.batch.id).toBe(recent.id);
  });

  test("the order the candidates come in does not matter", () => {
    const a = batch({ opens: -400, closes: -300 });
    const b = batch({ opens: -10, closes: 20 });
    const c = batch({ opens: 100, closes: 160 });
    const counts = new Map([[a.id, 2]]);
    for (const order of [[a, b, c], [c, b, a], [b, a, c], [c, a, b]]) {
      expect(pickBatch(order, counts, NOW)?.batch.id).toBe(a.id);
    }
  });
});

describe("buildDashboard: only what the rows say, nothing else", () => {
  const undecided = (batchId: string, status: UndecidedRow["status"], n: number): UndecidedRow => ({ batchId, status, n });

  test("no rows at all (a caller who may see no area): an empty attention", () => {
    expect(buildDashboard({}, NOW)).toEqual({ attention: {} });
  });

  test("the applicant counts add up across batches, per status, each with its link", () => {
    const b = batch();
    const dashboard = buildDashboard(
      { undecided: [undecided(b.id, "pending", 4), undecided("other", "pending", 3), undecided(b.id, "under_review", 3)], batches: [b] },
      NOW,
    );
    expect(dashboard.attention.pendingApplications).toEqual({ count: 7, to: "/applications?status=pending" });
    expect(dashboard.attention.underReviewApplications).toEqual({ count: 3, to: "/applications?status=under_review" });
    // The batch's own number only counts that batch.
    expect(dashboard.attention.batch).toMatchObject({ id: b.id, phase: "awaiting_decisions", undecided: 7 });
  });

  test("a count of zero is still reported (the tile is quiet, not missing); no batch means no batch key", () => {
    const dashboard = buildDashboard({ undecided: [], batches: [], unreadMessages: 0 }, NOW);
    expect(dashboard.attention).toEqual({
      pendingApplications: { count: 0, to: DASHBOARD_LINKS.pendingApplications },
      underReviewApplications: { count: 0, to: DASHBOARD_LINKS.underReviewApplications },
      unreadMessages: { count: 0, to: DASHBOARD_LINKS.unreadMessages },
    });
    expect("batch" in dashboard.attention).toBe(false);
  });

  test("messages alone: only the message item", () => {
    expect(buildDashboard({ unreadMessages: 4 }, NOW)).toEqual({ attention: { unreadMessages: { count: 4, to: "/messages?filter=unread" } } });
  });

  test("admission alone: no message item", () => {
    const dashboard = buildDashboard({ undecided: [], batches: [] }, NOW);
    expect("unreadMessages" in dashboard.attention).toBe(false);
  });

  test("a closed batch nobody applied to reads closed_empty in the payload, with its link", () => {
    const b = batch({ id: "kosong", hasApplications: false });
    expect(buildDashboard({ undecided: [], batches: [b] }, NOW).attention.batch).toMatchObject({ id: "kosong", phase: "closed_empty", undecided: 0, to: "/batches/kosong" });
  });

  test("the batch is described by its state and dates, with the dates as ISO strings and a link that encodes the id", () => {
    const b = batch({ id: "a/b c", year: 2026, opens: -60, closes: -10 });
    const dashboard = buildDashboard({ undecided: [], batches: [b] }, NOW);
    expect(dashboard.attention.batch).toEqual({
      id: "a/b c",
      year: 2026,
      phase: "ready_to_publish",
      opensAt: day(-60).toISOString(),
      closesAt: day(-10).toISOString(),
      undecided: 0,
      to: "/batches/a%2Fb%20c",
    });
    expect(batchLink("a/b c")).toBe("/batches/a%2Fb%20c");
  });
});
