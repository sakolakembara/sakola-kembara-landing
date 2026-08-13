"use server";

import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { requestPasswordReset } from "@/lib/account-service";

export type ForgotFormState = {
  status: "idle" | "success" | "error";
  message?: string;
};

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Format email belum benar").max(254),
  /** Honeypot — bots fill this; humans never see it. */
  website: z.string().max(0, { message: "spam" }),
});

// Every code path here returns generic-success (or the rate-limit error).
// Never leak which emails exist — enumeration is one of the more
// impactful bits of intel an attacker can farm from a password-reset UX.

const GENERIC_SUCCESS: ForgotFormState = {
  status: "success",
  message:
    "Kalau email tersebut terdaftar, kami sudah mengirim tautan reset password. Cek inbox atau folder spam dalam beberapa menit.",
};

export async function requestPasswordResetAction(
  _prev: ForgotFormState,
  formData: FormData,
): Promise<ForgotFormState> {
  const limit = await rateLimit({
    action: "account.reset-request",
    limit: 3,
    windowSeconds: 60 * 60, // 3 per hour per IP
  });
  if (!limit.allowed) {
    return {
      status: "error",
      message:
        "Terlalu banyak permintaan. Silakan tunggu sekitar satu jam lalu coba lagi.",
    };
  }

  const parsed = schema.safeParse({
    email: formData.get("email"),
    website: formData.get("website") ?? "",
  });
  if (!parsed.success) {
    // Honeypot hit → still generic success (don't tell the bot).
    return GENERIC_SUCCESS;
  }

  // Best-effort — the service is silent on unknown / Google-only /
  // unverified emails. We always return the same success message.
  try {
    await requestPasswordReset(parsed.data.email);
  } catch (err) {
    console.error("[reset] request failed:", err);
    // Still return success to avoid leaking backend errors.
  }
  return GENERIC_SUCCESS;
}
