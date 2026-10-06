import { NextResponse } from "next/server";
import { getCurrentAnnouncement } from "@/lib/announcements";

// Runtime-only: the DB lives on the VPS and isn't reachable at build time.
// The Navbar fetches this client-side so no page prerender touches the DB.
export const dynamic = "force-dynamic";

export async function GET() {
  const announcement = await getCurrentAnnouncement();
  return NextResponse.json({ announcement });
}
