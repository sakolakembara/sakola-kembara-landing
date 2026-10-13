// The admin's API client is the shared one (cf/admin/shared/spa/api.ts, also used by the student portal's SPA).
// This file keeps its old path, so every admin import and the Worker's contract tests stay as they were, and holds
// the one thing only the admin uses.
export * from "../../../shared/spa/api";

export type Severity = "info" | "warning" | "urgent";

export interface Announcement {
  id: string;
  title: string;
  body: string;
  severity: Severity;
  ctaLabel: string | null;
  ctaUrl: string | null;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
}
