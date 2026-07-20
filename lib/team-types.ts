// Client-safe team display helpers. Constants + pure functions only; the
// db reader stays in lib/team.ts (server-only) so importing these from
// a "use client" component doesn't drag drizzle into the browser bundle.

import type { TeamCategory } from "@/lib/db/schema";

export const TEAM_CATEGORY_ORDER: readonly TeamCategory[] = [
  "dewan_pembina",
  "dewan_pengawas",
  "pengurus",
] as const;

export const TEAM_CATEGORY_LABEL: Record<TeamCategory, string> = {
  dewan_pembina: "Dewan Pembina",
  dewan_pengawas: "Dewan Pengawas",
  pengurus: "Pengurus",
};

export const TEAM_CATEGORY_PILL: Record<TeamCategory, string> = {
  dewan_pembina: "bg-amber-50 text-amber-700 border-amber-200",
  dewan_pengawas: "bg-purple-50 text-purple-700 border-purple-200",
  pengurus: "bg-blue-50 text-blue-700 border-blue-200",
};
