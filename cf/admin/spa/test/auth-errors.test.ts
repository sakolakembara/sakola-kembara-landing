import { describe, expect, test } from "vitest";
import {
  CAPTCHA_FAILED_MESSAGE,
  CAPTCHA_UNAVAILABLE_MESSAGE,
  EMAIL_UNAVAILABLE_MESSAGE,
  GENERIC_SIGN_IN_ERROR,
  NETWORK_ERROR,
  queryErrorMessage,
  RESET_REQUESTED_MESSAGE,
  resetFailure,
  resetRequestFailureMessage,
  signInFailureMessage,
  verifyOutcome,
  WIDGET_ERROR_MESSAGE,
} from "~/lib/auth-errors";
import { formatWait } from "~/lib/format";

describe("formatWait", () => {
  test.each([
    [1, "1 detik"],
    [0, "1 detik"],
    [30, "30 detik"],
    [59.2, "60 detik"],
    [60, "1 menit"],
    [61, "2 menit"],
    [300, "5 menit"],
    [3600, "1 jam"],
    [7201, "3 jam"],
  ])("%s seconds is %s", (seconds, text) => {
    expect(formatWait(seconds)).toBe(text);
  });
});

describe("signInFailureMessage", () => {
  test("wrong credentials, by status or by code", () => {
    expect(signInFailureMessage({ status: 401 })).toBe("Email atau password salah.");
    expect(signInFailureMessage({ status: 401, code: "INVALID_EMAIL_OR_PASSWORD" })).toBe("Email atau password salah.");
    expect(signInFailureMessage({ status: 400, code: "INVALID_EMAIL_OR_PASSWORD" })).toBe("Email atau password salah.");
  });
  test("unverified email", () => {
    expect(signInFailureMessage({ status: 403, code: "EMAIL_NOT_VERIFIED" })).toContain("belum diverifikasi");
  });
  test("rate limited, with and without Retry-After", () => {
    expect(signInFailureMessage({ status: 429, retryAfter: 60 })).toBe(
      "Terlalu banyak percobaan masuk. Silakan tunggu 1 menit lalu coba lagi.",
    );
    expect(signInFailureMessage({ status: 429 })).toBe(
      "Terlalu banyak percobaan masuk. Silakan tunggu beberapa menit lalu coba lagi.",
    );
  });
  test("no answer from the server", () => {
    expect(signInFailureMessage({ status: 0 })).toBe(NETWORK_ERROR);
  });
  test("anything else is the generic line", () => {
    expect(signInFailureMessage({ status: 500 })).toBe(GENERIC_SIGN_IN_ERROR);
    expect(signInFailureMessage({ status: 403, code: "INVALID_ORIGIN" })).toBe(GENERIC_SIGN_IN_ERROR);
  });
  test("never repeats a server message", () => {
    const text = signInFailureMessage({ status: 400, code: "<img src=x onerror=alert(1)>" });
    expect(text).toBe(GENERIC_SIGN_IN_ERROR);
  });
});

describe("resetRequestFailureMessage", () => {
  test("is the same for any status that is not a limit or an outage", () => {
    const messages = new Set([400, 403, 404, 500, 503].map((status) => resetRequestFailureMessage({ status })));
    expect(messages.size).toBe(1);
  });
  test("rate limited and offline", () => {
    expect(resetRequestFailureMessage({ status: 429, retryAfter: 60 })).toContain("1 menit");
    expect(resetRequestFailureMessage({ status: 0 })).toBe(NETWORK_ERROR);
  });
  test("the success line does not say whether the account exists", () => {
    expect(RESET_REQUESTED_MESSAGE.startsWith("Kalau email tersebut terdaftar")).toBe(true);
  });
});

// The Worker's answers to the security check and to a route that must send an
// email. The codes are pinned against the real Worker in test/spa-contract.test.ts.
describe("the security check and the email service", () => {
  test("captcha_failed on sign-in and on forgot-password: ask to try again", () => {
    expect(signInFailureMessage({ status: 403, code: "captcha_failed" })).toBe(
      "Verifikasi keamanan gagal. Tunggu pemeriksaan selesai, lalu coba lagi.",
    );
    expect(resetRequestFailureMessage({ status: 403, code: "captcha_failed" })).toBe(CAPTCHA_FAILED_MESSAGE);
    expect(signInFailureMessage({ status: 403, code: "captcha_failed" })).toBe(CAPTCHA_FAILED_MESSAGE);
  });

  test("captcha_unavailable on sign-in and on forgot-password: try again later", () => {
    expect(signInFailureMessage({ status: 503, code: "captcha_unavailable" })).toBe(
      "Verifikasi keamanan sedang tidak tersedia. Coba lagi beberapa saat lagi.",
    );
    expect(resetRequestFailureMessage({ status: 503, code: "captcha_unavailable" })).toBe(CAPTCHA_UNAVAILABLE_MESSAGE);
  });

  test("email_unavailable on forgot-password: the link could not be sent", () => {
    expect(resetRequestFailureMessage({ status: 503, code: "email_unavailable" })).toBe(
      "Layanan email sedang tidak tersedia, jadi tautan belum bisa dikirim. Silakan coba lagi nanti.",
    );
    expect(resetRequestFailureMessage({ status: 503, code: "email_unavailable" })).toBe(EMAIL_UNAVAILABLE_MESSAGE);
  });

  test("the three lines are different, so a person can tell what happened", () => {
    expect(new Set([CAPTCHA_FAILED_MESSAGE, CAPTCHA_UNAVAILABLE_MESSAGE, EMAIL_UNAVAILABLE_MESSAGE, WIDGET_ERROR_MESSAGE]).size).toBe(4);
  });

  test("the code decides, not the status, and a limit still wins", () => {
    // Rate limits are counted before the check, so a 429 never carries a captcha code; if it did, the wait is what matters.
    expect(signInFailureMessage({ status: 429, code: "captcha_failed", retryAfter: 60 })).toContain("1 menit");
    expect(signInFailureMessage({ status: 500, code: "captcha_failed" })).toBe(CAPTCHA_FAILED_MESSAGE);
    expect(signInFailureMessage({ status: 403, code: "CAPTCHA_FAILED" })).toBe(GENERIC_SIGN_IN_ERROR);
  });

  test("email_unavailable says nothing about the account, and sign-in does not claim it", () => {
    expect(resetRequestFailureMessage({ status: 503, code: "email_unavailable" })).not.toMatch(/terdaftar|akun/i);
    expect(signInFailureMessage({ status: 503, code: "email_unavailable" })).toBe(GENERIC_SIGN_IN_ERROR);
  });
});

describe("resetFailure", () => {
  test("a spent or expired link", () => {
    expect(resetFailure({ status: 400, code: "INVALID_TOKEN" }).linkExpired).toBe(true);
    expect(resetFailure({ status: 400, code: "TOKEN_EXPIRED" }).linkExpired).toBe(true);
  });
  test("password length from the server goes under the field", () => {
    expect(resetFailure({ status: 400, code: "PASSWORD_TOO_SHORT" })).toEqual({
      message: "Password minimal 8 karakter",
      field: "password",
    });
    expect(resetFailure({ status: 400, code: "PASSWORD_TOO_LONG" }).field).toBe("password");
  });
  test("limit, offline, missing account, anything else", () => {
    expect(resetFailure({ status: 429, retryAfter: 120 }).message).toBe("Terlalu banyak percobaan. Coba lagi dalam 2 menit.");
    expect(resetFailure({ status: 0 }).message).toBe(NETWORK_ERROR);
    expect(resetFailure({ status: 400, code: "USER_NOT_FOUND" }).message).toContain("sudah tidak ada");
    expect(resetFailure({ status: 500 }).message).toBe("Gagal mengganti password. Silakan coba lagi.");
  });
});

describe("queryErrorMessage", () => {
  test("known codes have their own line", () => {
    expect(queryErrorMessage("admin-only")).toBe("Halaman itu hanya untuk pengurus yayasan.");
    expect(queryErrorMessage("state_mismatch")).toContain("kedaluwarsa");
    expect(queryErrorMessage("email_not_verified")).toContain("Google");
    expect(queryErrorMessage("access_denied")).toContain("Google");
  });
  test("anything else is generic and never echoed", () => {
    for (const code of [undefined, null, "", "<script>alert(1)</script>", "constructor", "__proto__", "toString", "x".repeat(500)]) {
      expect(queryErrorMessage(code as string | null | undefined)).toBe(GENERIC_SIGN_IN_ERROR);
    }
  });
});

describe("verifyOutcome", () => {
  test("success", () => {
    const outcome = verifyOutcome({ status: "success" });
    expect(outcome.ok).toBe(true);
    expect(outcome.headline).toBe("Email kamu berhasil diverifikasi");
  });
  test("an error code means failure, even next to status=success", () => {
    expect(verifyOutcome({ status: "success", error: "TOKEN_EXPIRED" }).ok).toBe(false);
    expect(verifyOutcome({ error: "INVALID_TOKEN" }).body).toContain("kadaluarsa");
  });
  test("a missing account", () => {
    expect(verifyOutcome({ error: "USER_NOT_FOUND" }).body).toContain("sudah tidak ada");
  });
  test("opening the page by hand is not a success", () => {
    const outcome = verifyOutcome({});
    expect(outcome.ok).toBe(false);
    expect(outcome.headline).toBe("Tautan verifikasi tidak lengkap");
  });
});
