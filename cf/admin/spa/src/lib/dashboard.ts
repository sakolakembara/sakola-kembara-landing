import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

// The dashboard's data, from `GET /api/dashboard`. The Worker does not serve it
// yet: this is the contract the backend work is asked to implement, and the
// mock (src/mock) serves the same shape in local development.
//
//   GET /api/dashboard   (any admin role; 200 JSON)
//   {
//     "attention": {
//       "pendingApplications": 7,        // status = pending, all batches
//       "underReviewApplications": 3,    // status = under_review, all batches
//       "unreadMessages": 4,             // contact messages with no readAt
//       "batch": {                       // the batch to act on, or null
//         "id": "...", "year": 2026,
//         "phase": "awaiting_decisions", // see BatchPhase
//         "opensAt": "2026-08-01T00:00:00.000Z",
//         "closesAt": "2026-09-30T16:59:59.000Z",
//         "undecided": 10                // pending + under_review in this batch
//       } | null
//     },
//     "recentActivity": [                // newest first, at most 8; OPTIONAL
//       { "id": "...", "actorEmail": "...", "action": "announcement.create",
//         "resourceType": "announcement", "resourceId": "...",
//         "createdAt": "2026-10-12T05:30:00.000Z" }
//     ]
//   }
//
// `phase` is worked out by the server (the SPA must not use the browser's
// clock for it): upcoming (opensAt in the future), open, awaiting_decisions
// (closed, some applicants undecided), ready_to_publish (closed, none
// undecided, results not published), published. `recentActivity` is left out
// for roles that may not read the activity log; the SPA then shows no widget.

export type BatchPhase = "upcoming" | "open" | "awaiting_decisions" | "ready_to_publish" | "published";
const PHASES: readonly string[] = ["upcoming", "open", "awaiting_decisions", "ready_to_publish", "published"];

export interface DashboardBatch {
  id: string;
  year: number;
  phase: BatchPhase;
  opensAt: string;
  closesAt: string;
  undecided: number;
}

export interface ActivityItem {
  id: string;
  actorEmail: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  createdAt: string;
}

export interface Dashboard {
  attention: {
    pendingApplications: number;
    underReviewApplications: number;
    unreadMessages: number;
    batch: DashboardBatch | null;
  };
  recentActivity?: ActivityItem[];
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

function parseBatch(value: unknown): DashboardBatch | null | undefined {
  if (value === null || value === undefined) return null;
  const raw = record(value);
  if (!raw) return undefined;
  const undecided = count(raw.undecided);
  if (
    typeof raw.id !== "string" ||
    typeof raw.year !== "number" ||
    typeof raw.phase !== "string" ||
    !PHASES.includes(raw.phase) ||
    typeof raw.opensAt !== "string" ||
    typeof raw.closesAt !== "string" ||
    undecided === null
  ) {
    return undefined;
  }
  return {
    id: raw.id,
    year: raw.year,
    phase: raw.phase as BatchPhase,
    opensAt: raw.opensAt,
    closesAt: raw.closesAt,
    undecided,
  };
}

function parseActivity(value: unknown): ActivityItem | null {
  const raw = record(value);
  if (!raw) return null;
  if (typeof raw.id !== "string" || typeof raw.actorEmail !== "string" || typeof raw.action !== "string" || typeof raw.createdAt !== "string") {
    return null;
  }
  return {
    id: raw.id,
    actorEmail: raw.actorEmail,
    action: raw.action,
    resourceType: typeof raw.resourceType === "string" ? raw.resourceType : null,
    resourceId: typeof raw.resourceId === "string" ? raw.resourceId : null,
    createdAt: raw.createdAt,
  };
}

/** Reads the body of `GET /api/dashboard`; null when it does not have the documented shape. */
export function parseDashboard(body: unknown): Dashboard | null {
  const root = record(body);
  const attention = record(root?.attention);
  if (!root || !attention) return null;

  const pending = count(attention.pendingApplications);
  const underReview = count(attention.underReviewApplications);
  const unread = count(attention.unreadMessages);
  const batch = parseBatch(attention.batch);
  if (pending === null || underReview === null || unread === null || batch === undefined) return null;

  const dashboard: Dashboard = {
    attention: { pendingApplications: pending, underReviewApplications: underReview, unreadMessages: unread, batch },
  };
  if (root.recentActivity !== undefined) {
    if (!Array.isArray(root.recentActivity)) return null;
    dashboard.recentActivity = root.recentActivity.map(parseActivity).filter((item): item is ActivityItem => item !== null);
  }
  return dashboard;
}

export type DashboardState =
  | { status: "loading" }
  | { status: "ready"; data: Dashboard }
  /** The server has no dashboard endpoint (404 or 501): not an error to retry. */
  | { status: "unavailable" }
  | { status: "error" };

export function useDashboard(): { state: DashboardState; reload: () => void } {
  const [state, setState] = useState<DashboardState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    api<unknown>("/api/dashboard").then((result) => {
      if (cancelled) return;
      if (result.ok) {
        const data = parseDashboard(result.data);
        setState(data ? { status: "ready", data } : { status: "error" });
      } else if (result.status === 404 || result.status === 501) {
        setState({ status: "unavailable" });
      } else {
        setState({ status: "error" });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, reload };
}
