import { describe, expect, test } from "vitest";
import { emailError, PASSWORD_MAX, PASSWORD_MIN, validateForgot, validateLogin, validateReset } from "~/lib/validation";

describe("emailError", () => {
  test("accepts ordinary addresses", () => {
    for (const email of ["a@b.co", "nama.belakang+tag@contoh.test", "  spasi@contoh.test  "]) {
      expect(emailError(email)).toBeNull();
    }
  });
  test("asks for an email when empty", () => {
    expect(emailError("")).toBe("Email wajib diisi");
    expect(emailError("   ")).toBe("Email wajib diisi");
  });
  test("rejects a wrong shape", () => {
    for (const email of ["nama", "nama@", "@contoh.test", "nama@contoh", "na ma@contoh.test", "a@b@c.test"]) {
      expect(emailError(email), email).toBe("Format email belum benar");
    }
  });
  test("rejects an address longer than 254 characters", () => {
    expect(emailError(`${"a".repeat(250)}@b.co`)).toBe("Format email belum benar");
  });
});

describe("validateLogin", () => {
  test("normalizes the email and keeps the password exactly as typed", () => {
    expect(validateLogin({ email: "  Ani@Contoh.TEST ", password: " rahasia " })).toEqual({
      ok: true,
      values: { email: "ani@contoh.test", password: " rahasia " },
    });
  });
  test("reports both fields at once", () => {
    expect(validateLogin({ email: "", password: "" })).toEqual({
      ok: false,
      errors: { email: "Email wajib diisi", password: "Password wajib diisi" },
    });
  });
  test("does not apply the new-password rules to an existing one", () => {
    expect(validateLogin({ email: "a@b.co", password: "x" }).ok).toBe(true);
  });
});

describe("validateForgot", () => {
  test("accepts and normalizes", () => {
    expect(validateForgot({ email: " A@B.co " })).toEqual({ ok: true, values: { email: "a@b.co" } });
  });
  test("rejects", () => {
    expect(validateForgot({ email: "x" })).toEqual({ ok: false, errors: { email: "Format email belum benar" } });
  });
});

describe("validateReset", () => {
  const ok = "kata sandi panjang";
  test("accepts matching passwords of a valid length", () => {
    expect(validateReset({ password: ok, confirm: ok })).toEqual({ ok: true, values: { password: ok } });
  });
  test("asks for both when empty", () => {
    expect(validateReset({ password: "", confirm: "" })).toEqual({
      ok: false,
      errors: { password: "Password baru wajib diisi", confirm: "Ulangi password baru" },
    });
  });
  test(`needs ${PASSWORD_MIN} characters`, () => {
    expect(validateReset({ password: "x".repeat(PASSWORD_MIN - 1), confirm: "x".repeat(PASSWORD_MIN - 1) })).toEqual({
      ok: false,
      errors: { password: `Password minimal ${PASSWORD_MIN} karakter` },
    });
    expect(validateReset({ password: "x".repeat(PASSWORD_MIN), confirm: "x".repeat(PASSWORD_MIN) }).ok).toBe(true);
  });
  test(`allows at most ${PASSWORD_MAX} characters`, () => {
    const long = "x".repeat(PASSWORD_MAX + 1);
    expect(validateReset({ password: long, confirm: long })).toEqual({
      ok: false,
      errors: { password: `Password maksimal ${PASSWORD_MAX} karakter` },
    });
    expect(validateReset({ password: "x".repeat(PASSWORD_MAX), confirm: "x".repeat(PASSWORD_MAX) }).ok).toBe(true);
  });
  test("flags a mismatch on the confirmation", () => {
    expect(validateReset({ password: ok, confirm: `${ok}!` })).toEqual({
      ok: false,
      errors: { confirm: "Konfirmasi password tidak cocok" },
    });
  });
  test("a too-short password reports the length, not a mismatch", () => {
    expect(validateReset({ password: "abc", confirm: "abd" })).toEqual({
      ok: false,
      errors: { password: `Password minimal ${PASSWORD_MIN} karakter` },
    });
  });
});
