import "server-only";
import { asc } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { teamMembers, type TeamMember } from "@/lib/db/schema";

// Reader for the public /tim page + admin list. Cached behind tag "team" so
// admin writes (revalidateTag("team", "max")) flush the public render
// immediately.

async function readAllTeam(): Promise<TeamMember[]> {
  return db
    .select()
    .from(teamMembers)
    .orderBy(asc(teamMembers.displayOrder), asc(teamMembers.createdAt));
}

const getCachedTeam = unstable_cache(
  () => readAllTeam(),
  ["team-all"],
  { tags: ["team"] },
);

// unstable_cache JSON-serializes the value, which turns Date columns into ISO
// strings. Re-hydrate so callers can safely call .toLocaleString() etc.
function hydrateTeamMember(row: TeamMember): TeamMember {
  return {
    ...row,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

export async function getAllTeamMembers(): Promise<TeamMember[]> {
  const rows = await getCachedTeam();
  return rows.map(hydrateTeamMember);
}
