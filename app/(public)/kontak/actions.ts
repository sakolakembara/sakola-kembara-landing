"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { and, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { contactMessages, contactSubject } from "@/lib/db/schema";

const schema = z.object({
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
  website: z.string().max(0, { message: "spam" }),
});

export type ContactFormState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<keyof z.infer<typeof schema>, string[]>>;
};

export async function submitContactMessage(
  _prev: ContactFormState,
  formData: FormData,
): Promise<ContactFormState> {
  // 5 submissions per minute per IP — generous enough for a legit user
  // fixing typos, tight enough to blunt scripted spam.
  const limit = await rateLimit({
    action: "contact.submit",
    limit: 5,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    return {
      status: "error",
      message:
        "Terlalu banyak percobaan pengiriman. Silakan tunggu satu menit lalu coba lagi.",
    };
  }

  const parsed = schema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    subject: formData.get("subject"),
    message: formData.get("message"),
    website: formData.get("website") ?? "",
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten()
      .fieldErrors as ContactFormState["fieldErrors"];
    // Silently drop honeypot hits — don't tell the bot why it failed.
    if (fieldErrors?.website) {
      return { status: "success", message: "OK" };
    }
    return {
      status: "error",
      message: "Silakan periksa kembali isian formulir.",
      fieldErrors,
    };
  }

  const data = parsed.data;

  // Soft anti-duplicate: reject same email submitted within the last 5 min.
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const recent = await db.query.contactMessages.findFirst({
    where: and(
      eq(contactMessages.email, data.email),
      gte(contactMessages.createdAt, fiveMinAgo),
    ),
    columns: { id: true },
  });
  if (recent) {
    return {
      status: "error",
      message:
        "Pesan dari email ini baru saja dikirim. Mohon tunggu beberapa menit sebelum mengirim ulang.",
    };
  }

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

  return {
    status: "success",
    message:
      "Pesan kamu sudah kami terima. Tim kami akan menghubungi via email.",
  };
}
