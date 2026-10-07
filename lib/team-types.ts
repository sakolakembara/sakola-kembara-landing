// Client-safe team display helpers. Constants + pure functions only; the
// db reader stays in lib/team.ts (server-only) so importing these from
// a "use client" component doesn't drag drizzle into the browser bundle.

import type { TeamCategory } from "@/lib/db/schema";
import type { TagTone } from "@/components/ui/tag";

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

export const TEAM_CATEGORY_TONE: Record<TeamCategory, TagTone> = {
  dewan_pembina: "amber",
  dewan_pengawas: "purple",
  pengurus: "blue",
};
