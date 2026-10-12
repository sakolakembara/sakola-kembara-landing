import { getCurrentAnnouncement } from "@/lib/announcements";
import { CACHE_ANNOUNCEMENT, publicJson } from "@/lib/public-api/http";
import { toPublicAnnouncement } from "@/lib/public-api/serializers";
import type { AnnouncementResponse } from "@/lib/public-api/types";

// Runtime-only; see the note in ../../team/route.ts. The older
// /api/announcements/current (full row, used by the Navbar) stays as is.
export const dynamic = "force-dynamic";

export async function GET() {
  const announcement = await getCurrentAnnouncement();
  return publicJson<AnnouncementResponse>(
    { announcement: announcement ? toPublicAnnouncement(announcement) : null },
    CACHE_ANNOUNCEMENT,
  );
}
