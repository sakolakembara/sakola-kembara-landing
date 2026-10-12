// Cloudflare Turnstile, verified on the server (Siteverify).
//
// The widget in the browser only produces a token. Nothing is protected until
// the Worker sends that token to Siteverify and sees `success: true`, so every
// route that sends email or checks passwords calls `guardTurnstile` (the auth
// routes do it in src/auth/gate.ts; the contact endpoint calls it directly).
//
// Fails closed: in production a missing secret, an unreachable Siteverify, a
// timeout or an unreadable answer all refuse the request. Only a non-production
// run with NO secret configured skips the check, so a developer without a
// Cloudflare account can still use the forms. Set one of Cloudflare's published
// test secrets in `.dev.vars` to exercise the real path locally:
//   TURNSTILE_TEST_SECRETS.alwaysPass  token "XXXX.DUMMY.TOKEN.XXXX" is accepted
//   TURNSTILE_TEST_SECRETS.alwaysFail  every token is refused
//   TURNSTILE_TEST_SECRETS.spent       every token reports "timeout-or-duplicate"
//
// Imports only ./client: the worker that serves the public contact form can
// import this file (and client.ts) as is.

import { clientIp } from "./client";

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Cloudflare's documented dummy keys for development. They are public and work on any site. */
export const TURNSTILE_TEST_SECRETS = {
  alwaysPass: "1x0000000000000000000000000000000AA",
  alwaysFail: "2x0000000000000000000000000000000AA",
  spent: "3x0000000000000000000000000000000AA",
} as const;
/** Matching site keys for the widget in local development. */
export const TURNSTILE_TEST_SITE_KEYS = {
  alwaysPass: "1x00000000000000000000AA",
  alwaysBlock: "2x00000000000000000000AB",
  interactive: "3x00000000000000000000FF",
} as const;

/** The header the SPA sends the widget's token in. */
export const TURNSTILE_HEADER = "x-turnstile-token";

/** Actions a widget declares with `data-action`; Siteverify echoes them back. */
export type TurnstileAction = "login" | "register" | "forgot-password" | "resend-verification" | "contact";

export interface TurnstileConfig {
  /** `TURNSTILE_SECRET_KEY`. */
  secret: string | undefined;
  /** `isProduction(env)`. */
  production: boolean;
}

export type TurnstileResult =
  | { ok: true; skipped?: true }
  /** The visitor failed or reused the challenge: ask them to try again. */
  | { ok: false; reason: "rejected" | "missing_token"; errorCodes: string[] }
  /** Not the visitor's fault: no secret in production, or Siteverify could not be reached or read. */
  | { ok: false; reason: "not_configured" | "unavailable"; errorCodes: string[] };

interface SiteverifyAnswer {
  success?: boolean;
  "error-codes"?: string[];
  action?: string;
}

const TIMEOUT_MS = 5000;
const MAX_TOKEN_LENGTH = 2048; // Cloudflare's documented maximum

/**
 * Checks one token. `ip` is the visitor's address (`CF-Connecting-IP`), sent as
 * `remoteip`; `expectedAction` is the widget's `data-action`. Cloudflare echoes
 * the action back, and a mismatch is refused so a token minted for one form
 * cannot be spent on another. A token from a widget with no action passes.
 */
export async function verifyTurnstile(
  config: TurnstileConfig,
  token: string | null | undefined,
  ip: string | undefined,
  expectedAction?: TurnstileAction,
): Promise<TurnstileResult> {
  if (!config.secret) {
    if (config.production) {
      console.error("[turnstile] TURNSTILE_SECRET_KEY is not set; refusing the request");
      return { ok: false, reason: "not_configured", errorCodes: [] };
    }
    return { ok: true, skipped: true };
  }
  if (!token || token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: "missing_token", errorCodes: [] };

  const body = new URLSearchParams({ secret: config.secret, response: token });
  if (ip && ip !== "unknown") body.set("remoteip", ip);

  let answer: SiteverifyAnswer;
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[turnstile] Siteverify answered HTTP ${res.status}`);
      return { ok: false, reason: "unavailable", errorCodes: [] };
    }
    answer = (await res.json()) as SiteverifyAnswer;
  } catch {
    // Timeout, network error or a body that is not JSON. Never log the token.
    console.error("[turnstile] Siteverify could not be reached or read");
    return { ok: false, reason: "unavailable", errorCodes: [] };
  }

  const errorCodes = Array.isArray(answer["error-codes"]) ? answer["error-codes"].filter((c) => typeof c === "string") : [];
  if (answer.success !== true) return { ok: false, reason: "rejected", errorCodes };
  if (expectedAction && answer.action && answer.action !== expectedAction) {
    return { ok: false, reason: "rejected", errorCodes: ["action-mismatch"] };
  }
  return { ok: true };
}

/**
 * The one call a route makes: null when the visitor may go on, otherwise the
 * Response to return (403 for a failed or reused challenge, 503 when the check
 * itself cannot run). The token is read from the `X-Turnstile-Token` header
 * unless the caller already has it, e.g. from a JSON body field.
 *
 *   const refused = await guardTurnstile(env, request, "contact", body.turnstileToken);
 *   if (refused) return refused;
 */
export async function guardTurnstile(
  env: { ENVIRONMENT?: string; TURNSTILE_SECRET_KEY?: string },
  request: Request,
  action: TurnstileAction,
  token: string | null | undefined = request.headers.get(TURNSTILE_HEADER),
): Promise<Response | null> {
  const production = env.ENVIRONMENT !== "development" && env.ENVIRONMENT !== "test";
  const result = await verifyTurnstile({ secret: env.TURNSTILE_SECRET_KEY, production }, token, clientIp(request.headers), action);
  return result.ok ? null : turnstileFailure(result);
}

/** What a route answers when `verifyTurnstile` said no. */
export function turnstileFailure(result: Exclude<TurnstileResult, { ok: true }>): Response {
  const headers = { "Cache-Control": "no-store" };
  if (result.reason === "not_configured" || result.reason === "unavailable") {
    return Response.json(
      { error: "captcha_unavailable", message: "Verifikasi keamanan sedang tidak tersedia. Coba lagi beberapa saat lagi." },
      { status: 503, headers },
    );
  }
  return Response.json(
    { error: "captcha_failed", message: "Verifikasi keamanan gagal. Muat ulang halaman lalu coba lagi." },
    { status: 403, headers },
  );
}
