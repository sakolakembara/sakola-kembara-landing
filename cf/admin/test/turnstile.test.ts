import { afterEach, describe, expect, test, vi } from "vitest";
import { guardTurnstile, SITEVERIFY_URL, TURNSTILE_TEST_SECRETS, verifyTurnstile } from "../src/security/turnstile";
import { fakeNetwork } from "./helpers";

// src/security/turnstile.ts, called directly: this is the helper the contact
// endpoint reuses.

afterEach(() => {
  vi.restoreAllMocks();
});

const production = { secret: TURNSTILE_TEST_SECRETS.alwaysPass, production: true };

function captureLogs() {
  const lines: string[] = [];
  for (const method of ["error", "warn", "info", "log", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
  }
  return lines;
}

describe("verifyTurnstile", () => {
  test("a token Siteverify accepts passes; the secret, token and address go in the form body", async () => {
    const network = fakeNetwork();
    expect(await verifyTurnstile(production, "XXXX.DUMMY.TOKEN.XXXX", "203.0.113.9")).toEqual({ ok: true });
    expect(network.siteverify).toEqual([{ secret: TURNSTILE_TEST_SECRETS.alwaysPass, response: "XXXX.DUMMY.TOKEN.XXXX", remoteip: "203.0.113.9" }]);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe(SITEVERIFY_URL);
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(URLSearchParams);
    expect(init.signal).toBeInstanceOf(AbortSignal); // there is a timeout
  });

  test("an unknown address is not sent as remoteip", async () => {
    const network = fakeNetwork();
    await verifyTurnstile(production, "token", "unknown");
    await verifyTurnstile(production, "token", undefined);
    expect(network.siteverify.map((call) => call.remoteip)).toEqual([null, null]);
  });

  test("a refused token is 'rejected' and carries Cloudflare's error codes", async () => {
    fakeNetwork();
    expect(await verifyTurnstile({ ...production, secret: TURNSTILE_TEST_SECRETS.alwaysFail }, "token", "1.2.3.4")).toEqual({
      ok: false,
      reason: "rejected",
      errorCodes: ["invalid-input-response"],
    });
  });

  test("a spent token is 'rejected' (timeout-or-duplicate)", async () => {
    fakeNetwork();
    expect(await verifyTurnstile({ ...production, secret: TURNSTILE_TEST_SECRETS.spent }, "token", "1.2.3.4")).toMatchObject({
      ok: false,
      reason: "rejected",
      errorCodes: ["timeout-or-duplicate"],
    });
  });

  test("no token, or an absurdly long one: missing_token, and Siteverify is not called", async () => {
    const network = fakeNetwork();
    expect(await verifyTurnstile(production, undefined, "1.2.3.4")).toMatchObject({ ok: false, reason: "missing_token" });
    expect(await verifyTurnstile(production, "", "1.2.3.4")).toMatchObject({ ok: false, reason: "missing_token" });
    expect(await verifyTurnstile(production, "x".repeat(2049), "1.2.3.4")).toMatchObject({ ok: false, reason: "missing_token" });
    expect(network.siteverify).toHaveLength(0);
  });

  describe("Siteverify cannot be used: unavailable, which callers must treat as 'no'", () => {
    test("network error", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
      expect(await verifyTurnstile(production, "token", "1.2.3.4")).toEqual({ ok: false, reason: "unavailable", errorCodes: [] });
    });

    test("timeout", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("The operation timed out", "TimeoutError"));
      expect(await verifyTurnstile(production, "token", "1.2.3.4")).toMatchObject({ ok: false, reason: "unavailable" });
    });

    test("HTTP 500", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("oops", { status: 500 }));
      expect(await verifyTurnstile(production, "token", "1.2.3.4")).toMatchObject({ ok: false, reason: "unavailable" });
    });

    test("an answer that is not JSON", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>", { status: 200 }));
      expect(await verifyTurnstile(production, "token", "1.2.3.4")).toMatchObject({ ok: false, reason: "unavailable" });
    });

    test("an answer without success: true is a refusal, whatever else it says", async () => {
      for (const body of [{}, { success: "true" }, { success: 1 }, { success: false }, { Success: true }, []]) {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(body));
        expect(await verifyTurnstile(production, "token", "1.2.3.4"), JSON.stringify(body)).toMatchObject({ ok: false });
        vi.restoreAllMocks();
      }
    });
  });

  describe("no secret", () => {
    test("production fails closed", async () => {
      const lines = captureLogs();
      const network = fakeNetwork();
      for (const secret of [undefined, ""]) {
        expect(await verifyTurnstile({ secret, production: true }, "token", "1.2.3.4")).toEqual({ ok: false, reason: "not_configured", errorCodes: [] });
      }
      expect(network.siteverify).toHaveLength(0);
      expect(lines.join("\n")).toContain("TURNSTILE_SECRET_KEY is not set");
    });

    test("outside production the check is skipped, and says so", async () => {
      const network = fakeNetwork();
      expect(await verifyTurnstile({ secret: undefined, production: false }, undefined, "1.2.3.4")).toEqual({ ok: true, skipped: true });
      expect(network.siteverify).toHaveLength(0);
    });
  });

  describe("action binding", () => {
    function siteverifyAnswers(action: string | undefined) {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ success: true, ...(action === undefined ? {} : { action }) }));
    }

    test("a token minted for another form is refused", async () => {
      siteverifyAnswers("login");
      expect(await verifyTurnstile(production, "token", "1.2.3.4", "register")).toEqual({ ok: false, reason: "rejected", errorCodes: ["action-mismatch"] });
    });

    test("the right action passes", async () => {
      siteverifyAnswers("register");
      expect(await verifyTurnstile(production, "token", "1.2.3.4", "register")).toEqual({ ok: true });
    });

    test("a widget that declared no action still passes (the binding only works when the widget sets data-action)", async () => {
      siteverifyAnswers(undefined);
      expect(await verifyTurnstile(production, "token", "1.2.3.4", "register")).toEqual({ ok: true });
    });
  });

  test("nothing it logs holds the token or the secret", async () => {
    const lines = captureLogs();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error(`boom ${TURNSTILE_TEST_SECRETS.alwaysPass} SECRET-TOKEN`));
    await verifyTurnstile(production, "SECRET-TOKEN", "1.2.3.4");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("SECRET-TOKEN", { status: 502 }));
    await verifyTurnstile(production, "SECRET-TOKEN", "1.2.3.4");
    const logged = lines.join("\n");
    expect(logged).not.toContain("SECRET-TOKEN");
    expect(logged).not.toContain(TURNSTILE_TEST_SECRETS.alwaysPass);
    expect(logged).toContain("[turnstile]");
  });
});

describe("guardTurnstile: the one call a route makes", () => {
  const env = { ENVIRONMENT: "production", TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRETS.alwaysPass };

  test("reads the token from the X-Turnstile-Token header and the address from CF-Connecting-IP", async () => {
    const network = fakeNetwork();
    const request = new Request("https://example.test/x", { method: "POST", headers: { "x-turnstile-token": "from-header", "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "6.6.6.6" } });
    expect(await guardTurnstile(env, request, "contact")).toBeNull();
    expect(network.siteverify).toEqual([{ secret: TURNSTILE_TEST_SECRETS.alwaysPass, response: "from-header", remoteip: "198.51.100.7" }]);
  });

  test("a token the caller already has (a JSON body field) is used instead of the header", async () => {
    const network = fakeNetwork();
    const request = new Request("https://example.test/x", { method: "POST", headers: { "x-turnstile-token": "ignored" } });
    expect(await guardTurnstile(env, request, "contact", "from-body")).toBeNull();
    expect(network.siteverify[0]!.response).toBe("from-body");
  });

  test("a refusal is a ready Response: 403 for the visitor's failure, 503 when the check cannot run, never cached", async () => {
    fakeNetwork();
    const request = new Request("https://example.test/x", { method: "POST" });
    const noToken = (await guardTurnstile(env, request, "contact"))!;
    expect(noToken.status).toBe(403);
    expect(noToken.headers.get("cache-control")).toBe("no-store");
    expect(await noToken.json()).toEqual({ error: "captcha_failed", message: "Verifikasi keamanan gagal. Muat ulang halaman lalu coba lagi." });

    const noSecret = (await guardTurnstile({ ENVIRONMENT: "production" }, request, "contact", "token"))!;
    expect(noSecret.status).toBe(503);
    expect(await noSecret.json()).toMatchObject({ error: "captcha_unavailable" });
  });

  test("the environment names that are not production skip the check without a secret; anything else is production", async () => {
    const request = new Request("https://example.test/x", { method: "POST" });
    expect(await guardTurnstile({ ENVIRONMENT: "development" }, request, "contact")).toBeNull();
    expect(await guardTurnstile({ ENVIRONMENT: "test" }, request, "contact")).toBeNull();
    expect((await guardTurnstile({ ENVIRONMENT: "staging" }, request, "contact"))!.status).toBe(503);
    expect((await guardTurnstile({}, request, "contact"))!.status).toBe(503);
  });
});
