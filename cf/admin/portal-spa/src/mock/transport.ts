import type { Transport } from "@shared/spa/api";
import { TURNSTILE_HEADER } from "@shared/spa/captcha";
import { MOCK_SITE_KEY, MOCK_TOKEN_PREFIX } from "@shared/spa/mock-turnstile";
import { ENDPOINTS } from "~/lib/paths";
import { isStudent } from "~/lib/me";
import { mockApplications, mockMe, mockOverview } from "./fixtures";
import type { Persona } from "./persona";

/** What the mock says the public site is (`siteUrl` of /portal/api/config): the Astro dev server. */
export const MOCK_SITE_URL = "http://localhost:4321";
/** What the mock says the admin is (`adminUrl`): the admin SPA's dev server. */
export const MOCK_ADMIN_URL = "http://localhost:5173";

// MOCK, local development only. Answers the calls the portal makes, in the shape the Worker uses
// (docs/cloudflare/portal-api.md), so the screens can be worked on and reviewed without a backend. It never touches
// the network.
//
// Sign in with any password and an email, except these (by the part before "@"):
//   salah              wrong credentials (401)
//   belum-verifikasi   address not verified (403 EMAIL_NOT_VERIFIED)
//   dibatasi           rate limited, Retry-After 60 (429)
//   offline            the request fails before an answer (network error)
//   captcha-gagal      the security check refuses the token (403 captcha_failed)
//   captcha-tidak-tersedia   the check cannot run (503 captcha_unavailable)
// Registration and "kirim ulang" also know:
//   email-tidak-tersedia     no email service (503 email_unavailable)
//   kuota-penuh              the day's emails are spent (503 email_quota)
//   isian-salah (register)   the Worker refuses the fields (400 invalid, with fieldErrors)
// Every route behind the security check needs the made-up token the mock widget hands out (shared/spa/mock-turnstile.ts)
// and accepts each one once, like the Worker. Reset tokens: "kedaluwarsa" is refused as spent; any other works.

export interface MockConfig {
  persona: Persona;
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
  const spentTokens = new Set<string>();
  const me = mockMe(config.persona);

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

  /** The pipeline of a student data route: a session, then the role (docs/cloudflare/portal-api.md#1-conventions). */
  function dataGuard(): Response | null {
    if (!config.session.get()) return json({ error: "unauthenticated" }, 401);
    if (!isStudent(me)) return json({ error: "student_only", message: "Halaman ini hanya untuk calon siswa. Pengurus yayasan masuk lewat halaman admin." }, 403);
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
      case `GET ${ENDPOINTS.config}`:
        return json({ google: true, turnstileSiteKey: MOCK_SITE_KEY, siteUrl: MOCK_SITE_URL, adminUrl: MOCK_ADMIN_URL });

      case `GET ${ENDPOINTS.me}`:
        return config.session.get() ? json({ user: me }) : json({ error: "unauthenticated" }, 401);

      case `GET ${ENDPOINTS.overview}`: {
        const refused = dataGuard();
        if (refused) return refused;
        if (config.persona === "error") return json({ error: "internal" }, 500);
        return json(mockOverview(config.persona, new Date()));
      }

      case `GET ${ENDPOINTS.applications}`: {
        const refused = dataGuard();
        if (refused) return refused;
        if (config.persona === "error") return json({ error: "internal" }, 500);
        return json(mockApplications(config.persona, new Date()));
      }

      case `POST ${ENDPOINTS.signIn}`:
        if (localPart === "offline") throw new TypeError("mock: network down");
        if (localPart === "dibatasi") return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
        {
          const refused = checkCaptcha(init, localPart);
          if (refused) return refused;
        }
        if (localPart === "salah") return json({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }, 401);
        if (localPart === "belum-verifikasi") return json({ code: "EMAIL_NOT_VERIFIED", message: "Email not verified" }, 403);
        config.session.set(true);
        return json({ redirect: true, token: "mock", user: me });

      case `POST ${ENDPOINTS.signOut}`:
        config.session.set(false);
        return json({ success: true });

      case `POST ${ENDPOINTS.register}`: {
        // The Worker's order: no email service first, then the limits, then the security check, then the fields.
        if (localPart === "email-tidak-tersedia") return json({ error: "email_unavailable" }, 503);
        if (localPart === "kuota-penuh") return json({ error: "email_quota", message: "Pendaftaran akun hari ini sudah penuh." }, 503);
        if (localPart === "dibatasi") return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
        const refused = checkCaptcha(init, localPart);
        if (refused) return refused;
        if (localPart === "isian-salah") {
          return json({ error: "invalid", message: "Periksa kembali isian formulir.", fieldErrors: { name: ["Nama minimal 2 karakter"], email: ["Format email belum benar"] } }, 400);
        }
        // The same answer for an address that is new and one that already has an account.
        return json({ ok: true, message: "Pendaftaran diterima. Cek email kamu untuk langkah berikutnya (periksa juga folder spam)." });
      }

      case `POST ${ENDPOINTS.sendVerification}`: {
        if (localPart === "email-tidak-tersedia") return json({ error: "email_unavailable" }, 503);
        if (localPart === "kuota-penuh") return json({ error: "email_quota" }, 503);
        if (localPart === "dibatasi") return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
        const refused = checkCaptcha(init, localPart);
        if (refused) return refused;
        return json({ status: true });
      }

      case `POST ${ENDPOINTS.requestReset}`: {
        if (localPart === "email-tidak-tersedia") return json({ error: "email_unavailable" }, 503);
        if (localPart === "dibatasi") return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
        const refused = checkCaptcha(init, localPart);
        if (refused) return refused;
        return json({ status: true });
      }

      case `POST ${ENDPOINTS.resetPassword}`:
        if (body.token === "kedaluwarsa") return json({ code: "INVALID_TOKEN", message: "Invalid token" }, 400);
        return json({ status: true });

      case `POST ${ENDPOINTS.signInSocial}`:
        // Google would answer a URL to go to; the mock goes straight back to the portal as the signed-in student.
        config.session.set(true);
        return json({ url: `${window.location.origin}/portal/` });

      default:
        return json({ error: "not_found" }, 404);
    }
  };
}
