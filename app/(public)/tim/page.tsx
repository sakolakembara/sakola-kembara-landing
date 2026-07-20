import { getAllTeamMembers } from "@/lib/team";
import { TimContent } from "./_tim-content";

export default async function TimPage() {
  const members = await getAllTeamMembers();
  return <TimContent members={members} />;
}
