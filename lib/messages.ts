import "server-only";
import { count, desc, isNull } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { contactMessages, type ContactMessage } from "@/lib/db/schema";

// Reader for /admin/messages. Cached behind tag "contact-messages" so
// public submissions + admin mark-as-read both flush instantly when they
// call revalidateTag("contact-messages", "max").

export async function getAllMessages(): Promise<ContactMessage[]> {
  return db
    .select()
    .from(contactMessages)
    .orderBy(desc(contactMessages.createdAt));
}

const getCachedUnreadCount = unstable_cache(
  async () => {
    const [row] = await db
      .select({ value: count() })
      .from(contactMessages)
      .where(isNull(contactMessages.readAt));
    return row?.value ?? 0;
  },
  ["contact-messages-unread"],
  { tags: ["contact-messages"] },
);

export async function getUnreadMessageCount(): Promise<number> {
  return Number(await getCachedUnreadCount());
}

export const CONTACT_SUBJECT_LABEL = {
  partnership: "Kerjasama",
  donation: "Donasi",
  other: "Lainnya",
} as const;

export const CONTACT_SUBJECT_PILL = {
  partnership: "bg-purple-50 text-purple-700 border-purple-200",
  donation: "bg-emerald-50 text-emerald-700 border-emerald-200",
  other: "bg-gray-50 text-gray-700 border-gray-200",
} as const;
