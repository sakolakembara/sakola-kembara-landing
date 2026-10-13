import { formatWait } from "./format";
import { PASSWORD_MAX, PASSWORD_MIN } from "./validation";

// Every failure the auth pages can meet, as Indonesian text. Pages never print
// a server message or a code: those are English and can say too much. Most
// lines are the legacy ones (app/(auth)/login/page.tsx and the reset actions);
// the connection, verification and Google lines are new.

/** The parts of an `ApiFailure` (lib/api.ts) these messages depend on. Kept free of lib/api.ts so the Worker tests can import this file. */
interface Failure {
  status: number;
  code?: string;
  retryAfter?: number;
}

export const NETWORK_ERROR = "Tidak dapat terhubung ke server. Periksa koneksi internet lalu coba lagi.";
export const GENERIC_SIGN_IN_ERROR = "Gagal masuk. Silakan coba lagi.";

function wait(retryAfter: number | undefined, fallback: string): string {
  return retryAfter !== undefined && retryAfter > 0 ? formatWait(retryAfter) : fallback;
}

// The Worker's answers to the security check (src/security/turnstile.ts) and to
// a route that must send an email (src/auth/gate.ts). New text, in the voice of
// the other auth lines. None of them depends on the address typed in the form.

/** `captcha_failed` (403): the token was missing, refused or already used. The widget has been reset, so waiting for it and trying again is the way out. */
export const CAPTCHA_FAILED_MESSAGE = "Verifikasi keamanan gagal. Tunggu pemeriksaan selesai, lalu coba lagi.";
/** `captcha_unavailable` (503): the Worker could not reach Cloudflare to check the token, or has no secret. Not the visitor's doing. */
export const CAPTCHA_UNAVAILABLE_MESSAGE = "Verifikasi keamanan sedang tidak tersedia. Coba lagi beberapa saat lagi.";
/** `email_unavailable` (503): the Worker has no email service configured, so a route that sends a link refused before doing anything. */
export const EMAIL_UNAVAILABLE_MESSAGE = "Layanan email sedang tidak tersedia, jadi tautan belum bisa dikirim. Silakan coba lagi nanti.";
/** The widget itself could not run (its script was blocked or offline, or the challenge errored): no token will come until the page is reloaded. */
export const WIDGET_ERROR_MESSAGE = "Pemeriksaan keamanan tidak dapat dijalankan. Periksa koneksi internet, lalu muat ulang halaman.";

/** The line for a refusal of the security check, or null when `code` is not one (a page that has more routes to explain than the shared ones, such as the portal's registration, uses it). */
export function captchaMessage(code: string | undefined): string | null {
  if (code === "captcha_failed") return CAPTCHA_FAILED_MESSAGE;
  if (code === "captcha_unavailable") return CAPTCHA_UNAVAILABLE_MESSAGE;
  return null;
}

/** Message for a failed `POST /api/auth/sign-in/email`. */
export function signInFailureMessage(failure: Failure): string {
  if (failure.status === 0) return NETWORK_ERROR;
  if (failure.status === 429) {
    return `Terlalu banyak percobaan masuk. Silakan tunggu ${wait(failure.retryAfter, "beberapa menit")} lalu coba lagi.`;
  }
  const captcha = captchaMessage(failure.code);
  if (captcha) return captcha;
  // 403 after a correct password: the Worker also sends a fresh link.
  if (failure.code === "EMAIL_NOT_VERIFIED") {
    return "Email belum diverifikasi. Kami sudah mengirim tautan verifikasi baru ke email kamu.";
  }
  if (failure.status === 401 || failure.code === "INVALID_EMAIL_OR_PASSWORD") return "Email atau password salah.";
  return GENERIC_SIGN_IN_ERROR;
}

/**
 * The line shown once a password reset was requested, whatever the address.
 * The Worker answers the same way for an address it knows and one it does not,
 * and so does this text: it must never say whether the account exists.
 */
export const RESET_REQUESTED_MESSAGE =
  "Kalau email tersebut terdaftar, kami sudah mengirim tautan reset password. Cek inbox atau folder spam dalam beberapa menit.";

/** Message for a failed `POST /api/auth/request-password-reset`. Identical for every address. */
export function resetRequestFailureMessage(failure: Failure): string {
  if (failure.status === 0) return NETWORK_ERROR;
  if (failure.status === 429) {
    return `Terlalu banyak permintaan. Silakan tunggu ${wait(failure.retryAfter, "beberapa menit")} lalu coba lagi.`;
  }
  const captcha = captchaMessage(failure.code);
  if (captcha) return captcha;
  if (failure.code === "email_unavailable") return EMAIL_UNAVAILABLE_MESSAGE;
  return "Gagal mengirim permintaan. Silakan coba lagi.";
}

export const RESET_LINK_INVALID_MESSAGE =
  "Tautan reset tidak valid atau sudah kadaluarsa. Silakan minta tautan baru.";
export const RESET_LINK_MISSING_MESSAGE = "Tautan reset tidak lengkap. Silakan minta tautan baru.";

export interface ResetFailure {
  message: string;
  /** The reset link is spent or expired: offer a new one instead of a retry. */
  linkExpired?: boolean;
  /** Show the message under the password field. */
  field?: "password";
}

/** Failure of `POST /api/auth/reset-password`. */
export function resetFailure(failure: Failure): ResetFailure {
  if (failure.status === 0) return { message: NETWORK_ERROR };
  if (failure.status === 429) {
    return { message: `Terlalu banyak percobaan. Coba lagi dalam ${wait(failure.retryAfter, "beberapa menit")}.` };
  }
  switch (failure.code) {
    case "INVALID_TOKEN":
    case "TOKEN_EXPIRED":
      return { message: RESET_LINK_INVALID_MESSAGE, linkExpired: true };
    case "PASSWORD_TOO_SHORT":
      return { message: `Password minimal ${PASSWORD_MIN} karakter`, field: "password" };
    case "PASSWORD_TOO_LONG":
      return { message: `Password maksimal ${PASSWORD_MAX} karakter`, field: "password" };
    case "USER_NOT_FOUND":
      return { message: "Akun terkait tautan ini sudah tidak ada. Silakan hubungi tim teknis." };
    default:
      return { message: "Gagal mengganti password. Silakan coba lagi." };
  }
}

const QUERY_ERRORS: Record<string, string> = {
  // Better Auth, Google sign-in
  email_not_verified: "Google belum memverifikasi email akun ini. Verifikasi dulu di Google, atau masuk dengan email dan password.",
  access_denied: "Izin masuk dengan Google tidak diberikan. Silakan coba lagi jika itu tidak disengaja.",
  state_mismatch: "Sesi masuk sudah kedaluwarsa. Silakan mulai lagi dari halaman masuk.",
  state_not_found: "Sesi masuk sudah kedaluwarsa. Silakan mulai lagi dari halaman masuk.",
  invalid_callback_request: "Sesi masuk sudah kedaluwarsa. Silakan mulai lagi dari halaman masuk.",
  please_restart_the_process: "Sesi masuk sudah kedaluwarsa. Silakan mulai lagi dari halaman masuk.",
  account_not_linked:
    "Akun dengan email ini sudah ada dan belum bisa ditautkan dengan Google. Silakan masuk dengan email dan password.",
  unable_to_link_account:
    "Akun dengan email ini sudah ada dan belum bisa ditautkan dengan Google. Silakan masuk dengan email dan password.",
};

/**
 * Text for `?error=` on `/login` and `/auth/error`. Only codes in the table
 * above, or in the SPA's own `extra` table (the admin's two legacy codes,
 * `admin-only` and `domain`), produce their own line; any other value,
 * including text a stranger put in a link, gets the generic one and is never
 * echoed.
 */
export function queryErrorMessage(code: string | null | undefined, extra: Readonly<Record<string, string>> = {}): string {
  if (!code) return GENERIC_SIGN_IN_ERROR;
  if (Object.hasOwn(extra, code)) return extra[code] as string;
  return Object.hasOwn(QUERY_ERRORS, code) ? (QUERY_ERRORS[code] as string) : GENERIC_SIGN_IN_ERROR;
}

export interface VerifyOutcome {
  ok: boolean;
  headline: string;
  body: string;
}

/**
 * The result page of an email-verification link. Better Auth verifies on its
 * own endpoint and then sends the browser here: `?status=success` when it
 * worked, `?error=<CODE>` when it did not (the callback URL is set in
 * Login.tsx). No result at all means the page was opened by hand.
 */
export function verifyOutcome(params: { status?: string | null; error?: string | null }): VerifyOutcome {
  if (params.error) {
    const body =
      params.error === "USER_NOT_FOUND"
        ? "Akun yang terkait tautan ini sudah tidak ada. Silakan hubungi tim teknis."
        : "Tautan verifikasi tidak valid atau sudah kadaluarsa. Silakan masuk dengan email dan password; kami akan mengirim tautan baru ke email kamu.";
    return { ok: false, headline: "Tautan verifikasi tidak dapat diproses", body };
  }
  if (params.status === "success") {
    return {
      ok: true,
      headline: "Email kamu berhasil diverifikasi",
      body: "Akun kamu sekarang sudah aktif. Silakan masuk untuk melanjutkan.",
    };
  }
  return {
    ok: false,
    headline: "Tautan verifikasi tidak lengkap",
    body: "Buka tautan verifikasi dari email kamu, atau masuk untuk meminta tautan baru.",
  };
}
