// Form validation for the auth pages: pure functions, Indonesian messages.
// The messages for email and password length are the legacy ones
// (app/(auth)/forgot-password/actions.ts, reset-password/actions.ts). The
// server validates again; this only saves a round trip and names the field.

/** Same bounds as Better Auth's defaults, which the Worker uses. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
const EMAIL_MAX = 254;

export type FieldErrors<K extends string> = Partial<Record<K, string>>;
export type Validation<T, K extends string> = { ok: true; values: T } | { ok: false; errors: FieldErrors<K> };

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns the message, or null when the email is acceptable. */
export function emailError(raw: string): string | null {
  const email = raw.trim();
  if (!email) return "Email wajib diisi";
  if (email.length > EMAIL_MAX || !EMAIL_SHAPE.test(email)) return "Format email belum benar";
  return null;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateLogin(input: { email: string; password: string }): Validation<
  { email: string; password: string },
  "email" | "password"
> {
  const errors: FieldErrors<"email" | "password"> = {};
  const email = emailError(input.email);
  if (email) errors.email = email;
  // Sign-in only checks that something was typed: the rules for choosing a
  // password do not apply to one that already exists.
  if (!input.password) errors.password = "Password wajib diisi";
  if (errors.email || errors.password) return { ok: false, errors };
  return { ok: true, values: { email: normalizeEmail(input.email), password: input.password } };
}

export function validateForgot(input: { email: string }): Validation<{ email: string }, "email"> {
  const email = emailError(input.email);
  return email ? { ok: false, errors: { email } } : { ok: true, values: { email: normalizeEmail(input.email) } };
}

export function validateReset(input: { password: string; confirm: string }): Validation<
  { password: string },
  "password" | "confirm"
> {
  const errors: FieldErrors<"password" | "confirm"> = {};
  if (!input.password) errors.password = "Password baru wajib diisi";
  else if (input.password.length < PASSWORD_MIN) errors.password = `Password minimal ${PASSWORD_MIN} karakter`;
  else if (input.password.length > PASSWORD_MAX) errors.password = `Password maksimal ${PASSWORD_MAX} karakter`;

  if (!input.confirm) errors.confirm = "Ulangi password baru";
  else if (!errors.password && input.confirm !== input.password) errors.confirm = "Konfirmasi password tidak cocok";

  if (errors.password || errors.confirm) return { ok: false, errors };
  return { ok: true, values: { password: input.password } };
}
