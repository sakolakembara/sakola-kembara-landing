import { describe, expect, test } from "vitest";
import { NO_CONFIG, parsePublicConfig, TURNSTILE_HEADER, TURNSTILE_ROUTES } from "~/lib/captcha";

describe("parsePublicConfig", () => {
  test("reads what the Worker answers", () => {
    expect(parsePublicConfig({ google: true, turnstileSiteKey: "1x00000000000000000000AA" })).toEqual({
      google: true,
      turnstileSiteKey: "1x00000000000000000000AA",
    });
    expect(parsePublicConfig({ google: false, turnstileSiteKey: null })).toEqual({ google: false, turnstileSiteKey: null });
  });

  test("a key that is missing, empty, blank or not a string means no Turnstile here", () => {
    for (const turnstileSiteKey of [undefined, null, "", "   ", 42, true, {}, []]) {
      expect(parsePublicConfig({ google: true, turnstileSiteKey }).turnstileSiteKey, String(turnstileSiteKey)).toBeNull();
    }
  });

  test("the key is trimmed", () => {
    expect(parsePublicConfig({ turnstileSiteKey: "  abc  " }).turnstileSiteKey).toBe("abc");
  });

  test("Google needs exactly true", () => {
    for (const google of [undefined, null, "true", 1, "yes"]) expect(parsePublicConfig({ google }).google).toBe(false);
  });

  test("anything that is not an object means nothing is configured", () => {
    for (const raw of [null, undefined, "x", 1, [], true]) expect(parsePublicConfig(raw), String(raw)).toEqual(NO_CONFIG);
  });
});

describe("what the pages send", () => {
  test("the header is the one the Worker reads", () => {
    expect(TURNSTILE_HEADER).toBe("X-Turnstile-Token");
  });

  test("one action per protected route, all different (a token minted for one form is refused by another)", () => {
    expect(TURNSTILE_ROUTES).toEqual({
      login: "/api/auth/sign-in/email",
      "forgot-password": "/api/auth/request-password-reset",
      "resend-verification": "/api/auth/send-verification-email",
    });
    expect(new Set(Object.values(TURNSTILE_ROUTES)).size).toBe(3);
  });
});
