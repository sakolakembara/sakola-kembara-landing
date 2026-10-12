// The body of `GET /api/dashboard` and the rules that fill it. Pure: no I/O, so
// every rule is tested without a database (test/dashboard-rules.test.ts); the
// queries that feed it are in ./queries.ts and the route in src/api/dashboard.ts.
//
// The dashboard has two blocks (decided by Dzul, SAKEM-082): "Perlu perhatian",
// which this payload is, and "Tindakan Cepat", which the SPA draws from
// `areas.writable` of `/api/me` (nothing to send). What is in the payload is
// counts, a link target and the state of one batch: never a name, an address or
// a message. An item is only there when the caller may see its area.

/** Where a tile leads, as a route of the SPA (spa/src/lib/nav.ts). The filters are the ones those lists already read from the URL. */
export const DASHBOARD_LINKS = {
  pendingApplications: "/applications?status=pending",
  underReviewApplications: "/applications?status=under_review",
  unreadMessages: "/messages?filter=unread",
} as const;

export const batchLink = (id: string) => `/batches/${encodeURIComponent(id)}`;

export type BatchPhase = "upcoming" | "open" | "awaiting_decisions" | "ready_to_publish" | "published";

export interface DashboardItem {
  count: number;
  to: string;
}

export interface DashboardBatch {
  id: string;
  year: number;
  phase: BatchPhase;
  opensAt: string;
  closesAt: string;
  /** pending + under_review in this batch. */
  undecided: number;
  to: string;
}

export interface Dashboard {
  attention: {
    /** `pendaftaran` only. All batches. */
    pendingApplications?: DashboardItem;
    /** `pendaftaran` only. All batches. */
    underReviewApplications?: DashboardItem;
    /** `komunikasi` only. */
    unreadMessages?: DashboardItem;
    /** `pendaftaran` only, and only when a batch exists. */
    batch?: DashboardBatch;
  };
}

export interface BatchRow {
  id: string;
  year: number;
  opensAt: Date;
  closesAt: Date;
  resultsPublishedAt: Date | null;
}

/** Applications still waiting for a decision, counted per batch and status. */
export interface UndecidedRow {
  batchId: string;
  status: "pending" | "under_review";
  n: number;
}

/**
 * Where a batch stands, worked out here so the browser's clock is never used.
 * The same reading as the legacy batch list (`batchState`): the window is
 * inclusive at both ends, and once it has closed a batch is published or
 * waiting. "Waiting" is split in two: still undecided applications, or all
 * decided and ready to publish.
 */
export function batchPhase(batch: Pick<BatchRow, "opensAt" | "closesAt" | "resultsPublishedAt">, undecided: number, now: Date): BatchPhase {
  if (now < batch.opensAt) return "upcoming";
  if (now <= batch.closesAt) return "open";
  if (batch.resultsPublishedAt) return "published";
  return undecided > 0 ? "awaiting_decisions" : "ready_to_publish";
}

/** What a batch asks of the admin: closed and waiting for something to be done comes first. */
const PHASE_RANK: Record<BatchPhase, number> = {
  awaiting_decisions: 0,
  ready_to_publish: 0,
  open: 1,
  upcoming: 2,
  published: 3,
};

/**
 * The one batch the tile is about, out of the newest few. A batch that is
 * waiting for decisions or for its results to be published beats one that is
 * merely open (that is what needs a person), an open one beats one that has
 * not opened, and a published one comes last. Within a kind the newest wins,
 * except for upcoming ones, where the soonest to open does. Admission is yearly,
 * so a few candidates are enough to see last year's unfinished batch next to
 * this year's.
 */
export function pickBatch(candidates: readonly BatchRow[], undecidedByBatch: ReadonlyMap<string, number>, now: Date): { batch: BatchRow; phase: BatchPhase; undecided: number } | null {
  const ranked = candidates.map((batch) => {
    const undecided = undecidedByBatch.get(batch.id) ?? 0;
    return { batch, undecided, phase: batchPhase(batch, undecided, now) };
  });
  ranked.sort((a, b) => {
    if (PHASE_RANK[a.phase] !== PHASE_RANK[b.phase]) return PHASE_RANK[a.phase] - PHASE_RANK[b.phase];
    const byOpening = a.batch.opensAt.getTime() - b.batch.opensAt.getTime();
    return a.phase === "upcoming" ? byOpening : -byOpening;
  });
  return ranked[0] ?? null;
}

export interface DashboardRows {
  /** Present when `pendaftaran` is visible. */
  undecided?: readonly UndecidedRow[];
  batches?: readonly BatchRow[];
  /** Present when `komunikasi` is visible. */
  unreadMessages?: number;
}

/** Puts the rows the caller was allowed to read into the payload. A part with no rows is left out. */
export function buildDashboard(rows: DashboardRows, now: Date): Dashboard {
  const attention: Dashboard["attention"] = {};

  if (rows.undecided && rows.batches) {
    const byBatch = new Map<string, number>();
    let pending = 0;
    let underReview = 0;
    for (const row of rows.undecided) {
      byBatch.set(row.batchId, (byBatch.get(row.batchId) ?? 0) + row.n);
      if (row.status === "pending") pending += row.n;
      else underReview += row.n;
    }
    attention.pendingApplications = { count: pending, to: DASHBOARD_LINKS.pendingApplications };
    attention.underReviewApplications = { count: underReview, to: DASHBOARD_LINKS.underReviewApplications };

    const picked = pickBatch(rows.batches, byBatch, now);
    if (picked) {
      attention.batch = {
        id: picked.batch.id,
        year: picked.batch.year,
        phase: picked.phase,
        opensAt: picked.batch.opensAt.toISOString(),
        closesAt: picked.batch.closesAt.toISOString(),
        undecided: picked.undecided,
        to: batchLink(picked.batch.id),
      };
    }
  }

  if (rows.unreadMessages !== undefined) {
    attention.unreadMessages = { count: rows.unreadMessages, to: DASHBOARD_LINKS.unreadMessages };
  }

  return { attention };
}
