"use server";

import { redirect } from "next/navigation";
import { revalidatePath, revalidateTag } from "next/cache";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-helpers";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { contactMessages } from "@/lib/db/schema";

function invalidate() {
  revalidateTag("contact-messages", "max");
  revalidatePath("/admin");
  revalidatePath("/admin/messages");
}

/**
 * Mark a single message as read. Called from the detail page render so the
 * first time an admin opens it, readAt gets stamped. Idempotent — if already
 * read, this is a no-op.
 */
export async function markMessageAsRead(id: string): Promise<void> {
  const admin = await requireAdmin();
  const existing = await db.query.contactMessages.findFirst({
    where: eq(contactMessages.id, id),
    columns: { id: true, readAt: true },
  });
  if (!existing || existing.readAt) return;

  await db
    .update(contactMessages)
    .set({ readAt: new Date() })
    .where(eq(contactMessages.id, id));

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.userId,
    action: "contact_message.read",
    resourceType: "contact_message",
    resourceId: id,
  });

  invalidate();
}

export async function toggleMessageRead(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("id"));
  const existing = await db.query.contactMessages.findFirst({
    where: eq(contactMessages.id, id),
    columns: { id: true, readAt: true },
  });
  if (!existing) redirect("/admin/messages?error=not-found");

  const nextReadAt = existing.readAt ? null : new Date();
  await db
    .update(contactMessages)
    .set({ readAt: nextReadAt })
    .where(eq(contactMessages.id, id));

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.userId,
    action: nextReadAt ? "contact_message.read" : "contact_message.unread",
    resourceType: "contact_message",
    resourceId: id,
  });

  invalidate();
}

export async function deleteMessage(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("id"));
  const existing = await db.query.contactMessages.findFirst({
    where: eq(contactMessages.id, id),
    columns: { id: true, fullName: true, email: true, subject: true },
  });
  if (!existing) redirect("/admin/messages?error=not-found");

  await db.delete(contactMessages).where(eq(contactMessages.id, id));

  await writeAudit({
    actorEmail: admin.email,
    actorId: admin.userId,
    action: "contact_message.delete",
    resourceType: "contact_message",
    resourceId: id,
    metadata: {
      fullName: existing.fullName,
      email: existing.email,
      subject: existing.subject,
    },
  });

  invalidate();
  redirect("/admin/messages?deleted=1");
}
