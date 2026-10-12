import { accessTo } from "./access";
import { safeFrom } from "./guard";
import type { Me } from "./me";

// The dashboard's data, from `GET /api/dashboard` (src/api/dashboard.ts, the
// rules in src/dashboard/). The dashboard has two blocks, decided by Dzul
// (SAKEM-082): "Perlu perhatian", which this is, and "Tindakan Cepat", which
// needs no data: the shortcuts come from `areas.writable` of `/api/me` through
// `accessTo` (lib/nav.ts), so they show while this loads or fails.
//
//   GET /api/dashboard   (any admin role; 200 JSON; never cached)
//   {
//     "attention": {
//       // Each item is there only when the caller may see its area; an editor
//       // of `konten` alone gets `"attention": {}`.
//       "pendingApplications":     { "count": 7, "to": "/applications?status=pending" },       // pendaftaran
//       "underReviewApplications": { "count": 3, "to": "/applications?status=under_review" },  // pendaftaran
//       "unreadMessages":          { "count": 4, "to": "/messages?filter=unread" },            // komunikasi
//       "batch": {                                                                              // pendaftaran, when a batch exists
//         "id": "...", "year": 2026,
//         "phase": "awaiting_decisions",   // see BatchPhase
//         "opensAt": "2026-08-01T00:00:00.000Z",
//         "closesAt": "2026-09-30T16:59:59.000Z",
//         "undecided": 10,                 // pending + under_review in this batch
//         "to": "/batches/<id>"
//       }
//     }
//   }
//
// `to` is a route of this app (a same-site path, filters in the query: the
// lists read them from the URL). Counts and links only: no name, address or
// message text, no recent applicants, messages or activity.
//
// `phase` is worked out by the server (the SPA must not use the browser's
// clock for it): upcoming (opensAt in the future), open, awaiting_decisions
// (closed, some applicants undecided), ready_to_publish (closed, none
// undecided, results not published), published. Which batch is shown when
// there are several is also the server's choice (src/dashboard/payload.ts).

export type BatchPhase = "upcoming" | "open" | "awaiting_decisions" | "ready_to_publish" | "published";
const PHASES: readonly string[] = ["upcoming", "open", "awaiting_decisions", "ready_to_publish", "published"];

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
  undecided: number;
  to: string;
}

export interface Dashboard {
  attention: {
    pendingApplications?: DashboardItem;
    underReviewApplications?: DashboardItem;
    unreadMessages?: DashboardItem;
    batch?: DashboardBatch;
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

/** A link target must be a path of this app: anything else (another site, `//host`, an auth page) is not accepted. */
function target(value: unknown): string | null {
  return typeof value === "string" ? safeFrom(value) : null;
}

/** `undefined` for an item that is not there, `null` for one that is there but malformed. */
function parseItem(value: unknown): DashboardItem | null | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = record(value);
  if (!raw) return null;
  const n = count(raw.count);
  const to = target(raw.to);
  return n === null || to === null ? null : { count: n, to };
}

function parseBatch(value: unknown): DashboardBatch | null | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = record(value);
  if (!raw) return null;
  const undecided = count(raw.undecided);
  const to = target(raw.to);
  if (
    typeof raw.id !== "string" ||
    typeof raw.year !== "number" ||
    typeof raw.phase !== "string" ||
    !PHASES.includes(raw.phase) ||
    typeof raw.opensAt !== "string" ||
    typeof raw.closesAt !== "string" ||
    undecided === null ||
    to === null
  ) {
    return null;
  }
  return { id: raw.id, year: raw.year, phase: raw.phase as BatchPhase, opensAt: raw.opensAt, closesAt: raw.closesAt, undecided, to };
}

/** Reads the body of `GET /api/dashboard`; null when it does not have the documented shape. */
export function parseDashboard(body: unknown): Dashboard | null {
  const attention = record(record(body)?.attention);
  if (!attention) return null;

  const pending = parseItem(attention.pendingApplications);
  const underReview = parseItem(attention.underReviewApplications);
  const unread = parseItem(attention.unreadMessages);
  const batch = parseBatch(attention.batch);
  // One malformed item spoils the answer: better an error with "Coba lagi" than a dashboard that quietly misses a tile.
  if (pending === null || underReview === null || unread === null || batch === null) return null;

  const parsed: Dashboard["attention"] = {};
  if (pending) parsed.pendingApplications = pending;
  if (underReview) parsed.underReviewApplications = underReview;
  if (unread) parsed.unreadMessages = unread;
  if (batch) parsed.batch = batch;
  return { attention: parsed };
}

/**
 * How many tiles the server will send this user: three for Pendaftaran
 * (pending, in review, the batch), one for Komunikasi (unread messages), none
 * for the other areas. Used to size the loading placeholders;
 * test/spa-contract.test.ts checks it against the real answer of the Worker.
 */
export function expectedDashboardTiles(me: Pick<Me, "role" | "areas"> | null | undefined): number {
  return (accessTo(me, "pendaftaran") !== "none" ? 3 : 0) + (accessTo(me, "komunikasi") !== "none" ? 1 : 0);
}
