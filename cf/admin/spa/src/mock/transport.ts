import type { Transport } from "~/lib/api";
import { accessTo } from "~/lib/access";
import { type AdminArea, isAdminRole, parseMe } from "~/lib/me";
import { TURNSTILE_HEADER } from "~/lib/captcha";
import { mockDashboard, mockMeBody } from "./fixtures";
import { MOCK_HANDLERS } from "./handlers";
import { createKomunikasiMock } from "./komunikasi";
import type { Persona } from "./persona";
import { MOCK_RESOURCES } from "./registry";
import { createMockResources } from "./resources";
import { MOCK_SITE_KEY, MOCK_TOKEN_PREFIX } from "./turnstile";

// MOCK, local development only. Answers the calls the SPA makes, in the shape
// the Worker uses, so the screens can be worked on and reviewed without a
// backend. It never touches the network.
//
// Sign in with any password and an email, except these (by the part before "@"):
//   salah            wrong credentials (401)
//   belum-verifikasi account not verified (403)
//   dibatasi         rate limited, Retry-After 60 (429)
//   offline          the request fails before an answer (network error)
//   captcha-gagal    the security check refuses the token (403 captcha_failed)
//   captcha-tidak-tersedia  the check cannot run (503 captcha_unavailable)
// "Lupa password" also knows:
//   email-tidak-tersedia    no email service (503 email_unavailable)
// Sign-in and "lupa password" need the made-up token the mock widget hands out
// (mock/turnstile.ts) and accept each one once, like the Worker: without it, or
// with one already used, they answer 403 captcha_failed.
// Reset tokens: "kedaluwarsa" is refused as spent; any other token works.

export type DashboardMode = "ready" | "empty" | "error" | "unavailable" | "slow";

export interface MockConfig {
  persona: Persona;
  dashboard: DashboardMode;
  /** Whether a session exists. Kept outside so a reload can keep it. */
  session: { get: () => boolean; set: (signedIn: boolean) => void };
  /** Pretend network time, so loading states are visible. */
  delayMs: number;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function bodyOf(init: RequestInit): Record<string, unknown> {
  try {
    return JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function createMockTransport(config: MockConfig): Transport {
  // Every resource registered in mock/resources/ (list, item, create, update, delete, uploads' areas), with the persona's rights.
  const accessOf = (area: AdminArea) => accessTo(parseMe(mockMeBody(config.persona)), area);
  const resources = createMockResources(MOCK_RESOURCES, accessOf);
  const komunikasi = createKomunikasiMock(accessOf);
  const spentTokens = new Set<string>();

  /** The Worker's security check: null when the token is good (it is then spent), otherwise the refusal. */
  function checkCaptcha(init: RequestInit, localPart: string): Response | null {
    if (localPart === "captcha-tidak-tersedia") return json({ error: "captcha_unavailable" }, 503);
    const token = new Headers(init.headers).get(TURNSTILE_HEADER);
    if (localPart === "captcha-gagal" || !token || !token.startsWith(MOCK_TOKEN_PREFIX) || spentTokens.has(token)) {
      return json({ error: "captcha_failed" }, 403);
    }
    spentTokens.add(token);
    return null;
  }

  const self = mockMeBody(config.persona).user;
  function answeredByHandler(method: string, url: URL, init: RequestInit): Response | null {
    for (const handler of MOCK_HANDLERS) {
      const answer = handler({ method, url, init, accessOf, self });
      if (answer) return answer;
    }
    return null;
  }

  return async (path, init) => {
    await sleep(config.delayMs);
    const url = new URL(path, "http://mock.invalid");
    const method = (init.method ?? "GET").toUpperCase();
    const route = `${method} ${url.pathname}`;
    const body = bodyOf(init);
    const localPart = String(body.email ?? "").split("@")[0];

    switch (route) {
      case "GET /api/config":
        return json({ google: true, turnstileSiteKey: MOCK_SITE_KEY, uploadsBaseUrl: "" });

      case "GET /api/me":
        return config.session.get() ? json(mockMeBody(config.persona)) : json({ error: "unauthenticated" }, 401);

      case "POST /api/auth/sign-in/email":
        if (localPart === "offline") throw new TypeError("mock: network down");
        if (localPart === "dibatasi") return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
        {
          const refused = checkCaptcha(init, localPart);
          if (refused) return refused;
        }
        if (localPart === "salah") return json({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }, 401);
        if (localPart === "belum-verifikasi") return json({ code: "EMAIL_NOT_VERIFIED", message: "Email not verified" }, 403);
        config.session.set(true);
        return json({ redirect: true, token: "mock", user: mockMeBody(config.persona).user });

      case "POST /api/auth/sign-out":
        config.session.set(false);
        return json({ success: true });

      case "POST /api/auth/request-password-reset": {
        // The Worker's order: no email service first, then the rate limit, then the security check.
        if (localPart === "email-tidak-tersedia") return json({ error: "email_unavailable" }, 503);
        if (localPart === "dibatasi") return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
        const refused = checkCaptcha(init, localPart);
        if (refused) return refused;
        return json({ status: true });
      }

      case "POST /api/auth/reset-password":
        if (body.token === "kedaluwarsa") return json({ code: "INVALID_TOKEN", message: "Invalid token" }, 400);
        return json({ status: true });

      case "GET /api/dashboard":
        // Like the Worker: any admin role, nobody else.
        if (!config.session.get()) return json({ error: "unauthenticated" }, 401);
        if (!isAdminRole(config.persona.role)) return json({ error: "forbidden" }, 403);
        if (config.dashboard === "error") return json({ error: "internal" }, 500);
        if (config.dashboard === "unavailable") return json({ error: "not_found" }, 404);
        if (config.dashboard === "slow") await sleep(4000);
        return json(mockDashboard(config.persona, config.dashboard === "empty" ? "empty" : "ready"));

      default:
        // The Komunikasi screens (mock/komunikasi.ts: the inbox, and the status of the announcements the generic store lists),
        // a registered resource (mock/resources/), a registered handler (mock/handlers/), or nobody's path.
        return (await komunikasi.handle(method, url, init, resources)) ?? resources.handle(method, url, init) ?? answeredByHandler(method, url, init) ?? json({ error: "not_found" }, 404);
    }
  };
}
