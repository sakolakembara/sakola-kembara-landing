import "server-only";
import { revalidatePath, revalidateTag } from "next/cache";
import { and, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { contactMessages, contactSubject } from "@/lib/db/schema";

// Contact-form logic shared by the /kontak server action and the
// server-to-server POST /api/public/contact endpoint, so both validate and
// write `contact_messages` the same way.

export const contactSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Nama lengkap minimal 2 karakter")
    .max(120, "Maksimal 120 karakter"),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Format email belum benar")
    .max(254),
  subject: z.enum(contactSubject, {
    errorMap: () => ({ message: "Pilih salah satu subjek" }),
  }),
  message: z
    .string()
    .trim()
    .min(10, "Tulis minimal 10 karakter")
    .max(5000, "Maksimal 5000 karakter"),
  /** Honeypot — bots fill this; humans never see it. */
  website: z.string().max(0, { message: "spam" }).default(""),
});

export type ContactInput = z.infer<typeof contactSchema>;
export type ContactFieldErrors = Partial<Record<keyof ContactInput, string[]>>;

/**
 * 5 submissions per minute per IP — generous enough for a legit user fixing
 * typos, tight enough to blunt scripted spam.
 */
export const CONTACT_RATE_LIMIT = {
  action: "contact.submit",
  limit: 5,
  windowSeconds: 60,
} as const;

export const CONTACT_MESSAGES = {
  rateLimited:
    "Terlalu banyak percobaan pengiriman. Silakan tunggu satu menit lalu coba lagi.",
  invalid: "Silakan periksa kembali isian formulir.",
  duplicate:
    "Pesan dari email ini baru saja dikirim. Mohon tunggu beberapa menit sebelum mengirim ulang.",
  success: "Pesan kamu sudah kami terima. Tim kami akan menghubungi via email.",
} as const;

export type ContactParseResult =
  | { kind: "ok"; data: ContactInput }
  | { kind: "honeypot" }
  | { kind: "invalid"; fieldErrors: ContactFieldErrors };

export function parseContactInput(raw: unknown): ContactParseResult {
  const parsed = contactSchema.safeParse(raw);
  if (parsed.success) return { kind: "ok", data: parsed.data };
  const fieldErrors = parsed.error.flatten().fieldErrors as ContactFieldErrors;
  // Honeypot hits are dropped silently by callers — never tell the bot why.
  if (fieldErrors.website) return { kind: "honeypot" };
  return { kind: "invalid", fieldErrors };
}

/**
 * Persist a validated message. Returns "duplicate" (nothing written) when the
 * same email already submitted within the last 5 minutes.
 */
export async function saveContactMessage(
  data: ContactInput,
): Promise<"saved" | "duplicate"> {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const recent = await db.query.contactMessages.findFirst({
    where: and(
      eq(contactMessages.email, data.email),
      gte(contactMessages.createdAt, fiveMinAgo),
    ),
    columns: { id: true },
  });
  if (recent) return "duplicate";

  const [inserted] = await db
    .insert(contactMessages)
    .values({
      fullName: data.fullName,
      email: data.email,
      subject: data.subject,
      message: data.message,
    })
    .returning({ id: contactMessages.id });

  await writeAudit({
    actorEmail: data.email,
    action: "contact_message.submit",
    resourceType: "contact_message",
    resourceId: inserted.id,
    metadata: { subject: data.subject },
  });

  revalidateTag("contact-messages", "max");
  revalidatePath("/admin");
  revalidatePath("/admin/messages");

  return "saved";
}
