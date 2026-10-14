import { CAPTCHA_FAILED_MESSAGE, CAPTCHA_UNAVAILABLE_MESSAGE, EMAIL_UNAVAILABLE_MESSAGE, NETWORK_ERROR } from "@shared/spa/auth-errors";
import { describe, expect, test } from "vitest";
import { EMAIL_QUOTA_MESSAGE, registerFailure, validateRegister } from "~/lib/register";
import { RESENT_MESSAGE, resendFailureMessage } from "~/lib/verification";

const valid = { name: "Sari Dewi", email: "Sari@Contoh.test", password: "rahasia123", confirm: "rahasia123" };

describe("validateRegister (the legacy rules, the Worker's bounds)", () => {
  test("a good form is normalised: name trimmed, email trimmed and lower-cased, the password as typed", () => {
    expect(validateRegister({ ...valid, name: "  Sari Dewi  ", email: "  Sari@Contoh.test " })).toEqual({
      ok: true,
      values: { name: "Sari Dewi", email: "sari@contoh.test", password: "rahasia123", confirmPassword: "rahasia123" },
    });
  });

  test("an empty form names every field", () => {
    expect(validateRegister({ name: "", email: "", password: "", confirm: "" })).toEqual({
      ok: false,
      errors: { name: "Nama wajib diisi", email: "Email wajib diisi", password: "Password wajib diisi", confirm: "Ulangi password kamu" },
    });
  });

  test("the name: 2 to 120 characters after trimming", () => {
    expect(validateRegister({ ...valid, name: "A" })).toMatchObject({ errors: { name: "Nama minimal 2 karakter" } });
    expect(validateRegister({ ...valid, name: " A " })).toMatchObject({ errors: { name: "Nama minimal 2 karakter" } });
    expect(validateRegister({ ...valid, name: "Al" }).ok).toBe(true);
    expect(validateRegister({ ...valid, name: "x".repeat(120) }).ok).toBe(true);
    expect(validateRegister({ ...valid, name: "x".repeat(121) })).toMatchObject({ errors: { name: "Maksimal 120 karakter" } });
  });

  test("the email: the same message as the sign-in", () => {
    expect(validateRegister({ ...valid, email: "bukan-email" })).toMatchObject({ errors: { email: "Format email belum benar" } });
  });

  test("the password: 8 to 128 characters (the Worker's bound, not the legacy 200)", () => {
    expect(validateRegister({ ...valid, password: "1234567", confirm: "1234567" })).toMatchObject({ errors: { password: "Password minimal 8 karakter" } });
    expect(validateRegister({ ...valid, password: "12345678", confirm: "12345678" }).ok).toBe(true);
    expect(validateRegister({ ...valid, password: "x".repeat(128), confirm: "x".repeat(128) }).ok).toBe(true);
    expect(validateRegister({ ...valid, password: "x".repeat(129), confirm: "x".repeat(129) })).toMatchObject({ errors: { password: "Password maksimal 128 karakter" } });
  });

  test("the confirmation must match; a short password does not also scold the confirmation", () => {
    expect(validateRegister({ ...valid, confirm: "lain" })).toMatchObject({ errors: { confirm: "Konfirmasi password tidak cocok" } });
    const short = validateRegister({ ...valid, password: "abc", confirm: "xyz" });
    expect(short).toMatchObject({ errors: { password: "Password minimal 8 karakter" } });
    expect(short.ok === false && short.errors.confirm).toBeFalsy();
  });
});

describe("registerFailure: the same line for every address", () => {
  test("no answer at all", () => {
    expect(registerFailure({ status: 0 })).toEqual({ message: NETWORK_ERROR });
  });

  test("429 says how long, from Retry-After", () => {
    expect(registerFailure({ status: 429, retryAfter: 60 }).message).toBe("Terlalu banyak percobaan pendaftaran. Silakan tunggu 1 menit lalu coba lagi.");
    expect(registerFailure({ status: 429 }).message).toBe("Terlalu banyak percobaan pendaftaran. Silakan tunggu beberapa menit lalu coba lagi.");
  });

  test("the security check and the email service", () => {
    expect(registerFailure({ status: 403, code: "captcha_failed" }).message).toBe(CAPTCHA_FAILED_MESSAGE);
    expect(registerFailure({ status: 503, code: "captcha_unavailable" }).message).toBe(CAPTCHA_UNAVAILABLE_MESSAGE);
    expect(registerFailure({ status: 503, code: "email_unavailable" }).message).toBe(EMAIL_UNAVAILABLE_MESSAGE);
  });

  test("the day's emails are spent: the Worker's own sentence (a function of the day, not of the address)", () => {
    expect(registerFailure({ status: 503, code: "email_quota" }).message).toBe("Pendaftaran akun hari ini sudah penuh. Coba lagi besok, atau masuk dengan Google.");
    expect(EMAIL_QUOTA_MESSAGE).toBe("Pendaftaran akun hari ini sudah penuh. Coba lagi besok, atau masuk dengan Google.");
  });

  test("400 invalid puts the Worker's first message of each field on that field; `confirmPassword` is the form's `confirm`", () => {
    expect(
      registerFailure({
        status: 400,
        code: "invalid",
        fieldErrors: { name: ["Nama minimal 2 karakter", "x"], confirmPassword: ["Konfirmasi password tidak cocok"], email: [], website: ["spam"], password: [""] },
      }),
    ).toEqual({ message: "Periksa kembali isian formulir.", fields: { name: "Nama minimal 2 karakter", confirm: "Konfirmasi password tidak cocok" } });
  });

  test("anything else is the generic line, never a code or a server message", () => {
    expect(registerFailure({ status: 500, code: "internal" }).message).toBe("Gagal mendaftar. Silakan coba lagi.");
    expect(registerFailure({ status: 403, code: "forbidden" }).message).toBe("Gagal mendaftar. Silakan coba lagi.");
  });
});

describe("resendFailureMessage", () => {
  test("the lines", () => {
    expect(RESENT_MESSAGE).toBe("Tautan baru sudah dikirim. Cek folder spam jika belum muncul.");
    expect(resendFailureMessage({ status: 0 })).toBe(NETWORK_ERROR);
    expect(resendFailureMessage({ status: 429, retryAfter: 60 })).toBe("Terlalu banyak permintaan. Coba lagi sekitar 1 menit lagi.");
    expect(resendFailureMessage({ status: 403, code: "captcha_failed" })).toBe(CAPTCHA_FAILED_MESSAGE);
    expect(resendFailureMessage({ status: 503, code: "email_unavailable" })).toBe(EMAIL_UNAVAILABLE_MESSAGE);
    expect(resendFailureMessage({ status: 503, code: "email_quota" })).toBe(EMAIL_QUOTA_MESSAGE);
    expect(resendFailureMessage({ status: 500 })).toBe("Gagal mengirim. Coba lagi beberapa saat lagi.");
  });
});
