"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { studentApplications } from "@/lib/db/schema";

const schema = z.object({
  fullName: z
    .string()
    .trim()
    .min(3, "Nama lengkap minimal 3 karakter")
    .max(120, "Maksimal 120 karakter"),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Format email belum benar")
    .max(254),
  whatsapp: z
    .string()
    .trim()
    .min(8, "Minimal 8 digit")
    .max(20)
    .regex(/^[\d\s+()-]+$/, "Hanya angka dan simbol +()- diperbolehkan"),
  schoolName: z.string().trim().min(2, "Wajib diisi").max(200),
  graduationYear: z.coerce
    .number({ invalid_type_error: "Wajib diisi" })
    .int()
    .min(2020, "Tahun lulus tidak valid")
    .max(2030, "Tahun lulus tidak valid"),
  branchPreference: z.string().trim().max(80).optional().or(z.literal("")),
  motivation: z
    .string()
    .trim()
    .min(20, "Tulis minimal 20 karakter")
    .max(2000, "Maksimal 2000 karakter"),
  economicBackground: z.string().trim().max(2000).optional().or(z.literal("")),
  // Honeypot — bots fill this; humans never see it.
  website: z.string().max(0, { message: "spam" }),
});

export type ApplicationFormState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<keyof z.infer<typeof schema>, string[]>>;
};

export async function submitApplication(
  _prev: ApplicationFormState,
  formData: FormData,
): Promise<ApplicationFormState> {
  const parsed = schema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    whatsapp: formData.get("whatsapp"),
    schoolName: formData.get("schoolName"),
    graduationYear: formData.get("graduationYear"),
    branchPreference: formData.get("branchPreference"),
    motivation: formData.get("motivation"),
    economicBackground: formData.get("economicBackground"),
    website: formData.get("website") ?? "",
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten()
      .fieldErrors as ApplicationFormState["fieldErrors"];
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

  // Soft anti-duplicate: reject same email submitted within the last hour.
  // Multi-instance-safe (DB-backed); cheap enough at MVP volume.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await db.query.studentApplications.findFirst({
    where: and(
      eq(studentApplications.email, data.email),
      gte(studentApplications.submittedAt, oneHourAgo),
    ),
    columns: { id: true },
  });
  if (recent) {
    return {
      status: "error",
      message:
        "Pendaftaran dari email ini baru saja dikirim. Mohon tunggu sebelum mencoba lagi.",
    };
  }

  const [inserted] = await db
    .insert(studentApplications)
    .values({
      fullName: data.fullName,
      email: data.email,
      whatsapp: data.whatsapp,
      schoolName: data.schoolName,
      graduationYear: data.graduationYear,
      branchPreference: data.branchPreference || null,
      motivation: data.motivation,
      economicBackground: data.economicBackground || null,
    })
    .returning({ id: studentApplications.id });

  await writeAudit({
    actorEmail: data.email,
    action: "application.submit",
    resourceType: "application",
    resourceId: inserted.id,
    metadata: {
      schoolName: data.schoolName,
      graduationYear: data.graduationYear,
      branchPreference: data.branchPreference || null,
    },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/applications");

  return {
    status: "success",
    message:
      "Pendaftaran kamu sudah kami terima. Tim akademik akan menghubungi via email.",
  };
}
