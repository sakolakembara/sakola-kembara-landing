import { getAllTeamMembers } from "@/lib/team";
import { TimContent } from "./_tim-content";

// Reads the DB, which is only reachable at runtime (on the VPS), not during
// the CI build. Render per-request instead of prerendering.
export const dynamic = "force-dynamic";

export default async function TimPage() {
  const members = await getAllTeamMembers();
  return <TimContent members={members} />;
}
