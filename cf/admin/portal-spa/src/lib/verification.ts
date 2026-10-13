import type { ApiFailure } from "@shared/spa/api";
import { captchaMessage, EMAIL_UNAVAILABLE_MESSAGE, NETWORK_ERROR } from "@shared/spa/auth-errors";
import { formatWait } from "@shared/spa/format";
import { EMAIL_QUOTA_MESSAGE } from "./register";

// "Kirim ulang tautan": a fresh verification email (`POST /portal/api/auth/send-verification-email`, Turnstile action
// `resend-verification`). Pure texts, like auth-errors: the Worker's contract tests can read them.

/** The line after a resend the Worker accepted (the legacy banner's). The Worker answers 200 for every address. */
export const RESENT_MESSAGE = "Tautan baru sudah dikirim. Cek folder spam jika belum muncul.";

/** The failure of a resend. Identical for every address. */
export function resendFailureMessage(failure: Pick<ApiFailure, "status" | "code" | "retryAfter">): string {
  if (failure.status === 0) return NETWORK_ERROR;
  if (failure.status === 429) {
    const wait = failure.retryAfter !== undefined && failure.retryAfter > 0 ? formatWait(failure.retryAfter) : "beberapa menit";
    return `Terlalu banyak permintaan. Coba lagi sekitar ${wait} lagi.`;
  }
  const captcha = captchaMessage(failure.code);
  if (captcha) return captcha;
  if (failure.code === "email_unavailable") return EMAIL_UNAVAILABLE_MESSAGE;
  if (failure.code === "email_quota") return EMAIL_QUOTA_MESSAGE;
  return "Gagal mengirim. Coba lagi beberapa saat lagi.";
}
