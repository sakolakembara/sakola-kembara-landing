import { type ApiFailure } from "@shared/spa/api";
import { captchaMessage, EMAIL_UNAVAILABLE_MESSAGE, NETWORK_ERROR } from "@shared/spa/auth-errors";
import { formatWait } from "@shared/spa/format";
import { emailError, type FieldErrors, normalizeEmail, PASSWORD_MAX, PASSWORD_MIN, type Validation } from "@shared/spa/validation";

// The registration page's rules and texts: pure (no DOM, no React), so the Worker's contract tests can read them.
// The rules are the legacy ones (app/(auth)/register/actions.ts) and the Worker's (docs/cloudflare/auth.md#registration-contract);
// the Worker validates again, this only saves a round trip and names the field.

const NAME_MIN = 2;
const NAME_MAX = 120;

export type RegisterField = "name" | "email" | "password" | "confirm";

export interface RegisterValues {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export function validateRegister(input: {
  name: string;
  email: string;
  password: string;
  confirm: string;
}): Validation<RegisterValues, RegisterField> {
  const errors: FieldErrors<RegisterField> = {};

  const name = input.name.trim();
  if (!name) errors.name = "Nama wajib diisi";
  else if (name.length < NAME_MIN) errors.name = `Nama minimal ${NAME_MIN} karakter`;
  else if (name.length > NAME_MAX) errors.name = `Maksimal ${NAME_MAX} karakter`;

  const email = emailError(input.email);
  if (email) errors.email = email;

  if (!input.password) errors.password = "Password wajib diisi";
  else if (input.password.length < PASSWORD_MIN) errors.password = `Password minimal ${PASSWORD_MIN} karakter`;
  else if (input.password.length > PASSWORD_MAX) errors.password = `Password maksimal ${PASSWORD_MAX} karakter`;

  if (!input.confirm) errors.confirm = "Ulangi password kamu";
  else if (!errors.password && input.confirm !== input.password) errors.confirm = "Konfirmasi password tidak cocok";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: { name, email: normalizeEmail(input.email), password: input.password, confirmPassword: input.confirm } };
}

/** Shown after a registration the Worker accepted. It reads the same for an address that already has an account (the Worker answers every address alike). */
export const REGISTERED_HEADLINE = "Cek email kamu";
export const REGISTERED_MESSAGE =
  "Pendaftaran diterima. Kami sudah mengirim tautan verifikasi ke email kamu (periksa juga folder spam). Tautan berlaku 24 jam, dan kamu bisa masuk setelah email diverifikasi.";

/** `email_quota` (503): the day's allowance of emails is spent. A function of the day, not of the address. */
export const EMAIL_QUOTA_MESSAGE = "Pendaftaran akun hari ini sudah penuh. Coba lagi besok, atau masuk dengan Google.";

export interface RegisterFailure {
  /** The line for the whole form. */
  message: string;
  /** Lines for fields the Worker named (`400 invalid`, `fieldErrors` of the registration contract). */
  fields?: FieldErrors<RegisterField>;
}

/** Where the Worker's `fieldErrors` names go on the form (`confirmPassword` is the form's "confirm"). */
const FIELD_OF: Record<string, RegisterField> = { name: "name", email: "email", password: "password", confirmPassword: "confirm" };

/** The failure of `POST /portal/api/auth/register`. Identical for every address: it never says whether one has an account. */
export function registerFailure(failure: Pick<ApiFailure, "status" | "code" | "retryAfter" | "fieldErrors">): RegisterFailure {
  if (failure.status === 0) return { message: NETWORK_ERROR };
  if (failure.status === 429) {
    const wait = failure.retryAfter !== undefined && failure.retryAfter > 0 ? formatWait(failure.retryAfter) : "beberapa menit";
    return { message: `Terlalu banyak percobaan pendaftaran. Silakan tunggu ${wait} lalu coba lagi.` };
  }
  const captcha = captchaMessage(failure.code);
  if (captcha) return { message: captcha };
  if (failure.code === "email_unavailable") return { message: EMAIL_UNAVAILABLE_MESSAGE };
  if (failure.code === "email_quota") return { message: EMAIL_QUOTA_MESSAGE };
  if (failure.status === 400 && failure.code === "invalid") {
    const fields: FieldErrors<RegisterField> = {};
    for (const [name, messages] of Object.entries(failure.fieldErrors ?? {})) {
      const field = Object.hasOwn(FIELD_OF, name) ? FIELD_OF[name] : undefined;
      const first = Array.isArray(messages) ? messages.find((text) => typeof text === "string" && text !== "") : undefined;
      if (field && first) fields[field] = first;
    }
    return { message: "Periksa kembali isian formulir.", fields };
  }
  return { message: "Gagal mendaftar. Silakan coba lagi." };
}
