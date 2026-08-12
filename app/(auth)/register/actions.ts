"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signIn } from "@/auth";
import { rateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import {
  STUDENT_PASSWORD_MIN_LENGTH,
  createStudentAccount,
} from "@/lib/student-signup-service";

const schema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Nama minimal 2 karakter")
      .max(120, "Maksimal 120 karakter"),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("Format email belum benar")
      .max(254),
    password: z
      .string()
      .min(STUDENT_PASSWORD_MIN_LENGTH, `Password minimal ${STUDENT_PASSWORD_MIN_LENGTH} karakter`)
      .max(200),
    confirmPassword: z.string(),
    /** Honeypot — bots fill this; humans never see it. */
    website: z.string().max(0, { message: "spam" }),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Konfirmasi password tidak cocok",
    path: ["confirmPassword"],
  });

export type RegisterFormState = {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
};

export async function registerStudent(
  _prev: RegisterFormState,
  formData: FormData,
): Promise<RegisterFormState> {
  // Tight throttle — signup should be a one-off per user. Anything more is
  // abuse or a stuck client retrying.
  const limit = await rateLimit({
    action: "student.register",
    limit: 3,
    windowSeconds: 300,
  });
  if (!limit.allowed) {
    return {
      status: "error",
      message:
        "Terlalu banyak percobaan pendaftaran. Silakan tunggu beberapa menit lalu coba lagi.",
    };
  }

  const parsed = schema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    website: formData.get("website") ?? "",
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten()
      .fieldErrors as RegisterFormState["fieldErrors"];
    // Silently drop honeypot hits — don't tell the bot why it failed.
    if (fieldErrors?.website) {
      redirect("/login");
    }
    return {
      status: "error",
      message: "Periksa kembali isian formulir.",
      fieldErrors,
    };
  }

  const data = parsed.data;

  const result = await createStudentAccount({
    email: data.email,
    name: data.name,
    password: data.password,
  });

  if (!result.ok) {
    if (result.reason === "email_taken_no_password") {
      return {
        status: "error",
        message:
          "Email ini sudah terdaftar lewat Google. Silakan masuk dengan tombol Google di halaman masuk.",
        fieldErrors: { email: ["Sudah terdaftar lewat Google"] },
      };
    }
    return {
      status: "error",
      message:
        "Email ini sudah terdaftar. Silakan masuk atau gunakan email lain.",
      fieldErrors: { email: ["Sudah terdaftar"] },
    };
  }

  await writeAudit({
    actorEmail: data.email,
    actorId: result.id,
    action: "student.register",
    resourceType: "user",
    resourceId: result.id,
  });

  const from = String(formData.get("from") ?? "");
  const safeFrom =
    from.startsWith("/") && !from.startsWith("//") ? from : "/portal";

  try {
    await signIn("credentials", {
      email: data.email,
      password: data.password,
      redirectTo: safeFrom,
    });
  } catch (err) {
    // signIn redirects via a special error — re-throw so Next.js handles it.
    // Any AuthError here is unexpected because we just created the account.
    if (err instanceof AuthError) {
      redirect("/login?error=Default");
    }
    throw err;
  }

  // Unreachable — signIn always redirects or throws.
  return { status: "idle" };
}
