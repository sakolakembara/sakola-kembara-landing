"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signIn } from "@/auth";
import { rateLimit } from "@/lib/rate-limit";
import {
  ACCOUNT_MIN_PASSWORD_LENGTH,
  resetPasswordByToken,
} from "@/lib/account-service";
import { writeAudit } from "@/lib/audit";

export type ResetFormState = {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
};

const schema = z
  .object({
    token: z.string().min(1, "Tautan tidak valid"),
    password: z
      .string()
      .min(ACCOUNT_MIN_PASSWORD_LENGTH, `Password minimal ${ACCOUNT_MIN_PASSWORD_LENGTH} karakter`)
      .max(200),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Konfirmasi password tidak cocok",
    path: ["confirmPassword"],
  });

export async function resetPasswordAction(
  _prev: ResetFormState,
  formData: FormData,
): Promise<ResetFormState> {
  // Token-scoped rate limit so a leaked-but-guessed token can't be bruted.
  const limit = await rateLimit({
    action: "account.reset-redeem",
    limit: 5,
    windowSeconds: 60 * 60,
    extraKey: String(formData.get("token") ?? "").slice(0, 32),
  });
  if (!limit.allowed) {
    return {
      status: "error",
      message: "Terlalu banyak percobaan. Coba lagi dalam beberapa menit.",
    };
  }

  const parsed = schema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Periksa kembali isian formulir.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const result = await resetPasswordByToken(
    parsed.data.token,
    parsed.data.password,
  );
  if (!result.ok) {
    const messages: Record<typeof result.reason, string> = {
      invalid_token:
        "Tautan reset tidak valid atau sudah kadaluarsa. Silakan minta tautan baru.",
      user_not_found:
        "Akun terkait sudah tidak ada. Silakan daftar ulang atau hubungi panitia.",
      email_changed:
        "Email akun berubah sejak tautan dibuat. Silakan minta tautan reset yang baru.",
      weak_password: `Password minimal ${ACCOUNT_MIN_PASSWORD_LENGTH} karakter.`,
    };
    return { status: "error", message: messages[result.reason] };
  }

  await writeAudit({
    actorEmail: result.email,
    action: "user.password_reset",
  });

  // Sign the user in with the fresh password — smoother than dumping them
  // back on /login. signIn throws NEXT_REDIRECT internally on success.
  try {
    await signIn("credentials", {
      email: result.email,
      password: parsed.data.password,
      redirectTo: "/portal",
    });
  } catch (err) {
    if (err instanceof AuthError) {
      redirect("/login?error=Default");
    }
    throw err;
  }

  // Unreachable — signIn always redirects or throws above.
  return { status: "idle" };
}
