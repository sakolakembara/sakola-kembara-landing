import { getAllTeamMembers } from "@/lib/team";
import { CACHE_CONTENT, publicJson } from "@/lib/public-api/http";
import { toPublicTeamMember } from "@/lib/public-api/serializers";
import type { TeamResponse } from "@/lib/public-api/types";

// Runtime-only: the DB lives on the VPS and isn't reachable at build time,
// and the cached readers (revalidated by admin saves) must not be frozen into
// a prerendered response. Contract: docs/cloudflare/content-api.md.
export const dynamic = "force-dynamic";

export async function GET() {
  const members = await getAllTeamMembers();
  return publicJson<TeamResponse>(
    { members: members.map(toPublicTeamMember) },
    CACHE_CONTENT,
  );
}
