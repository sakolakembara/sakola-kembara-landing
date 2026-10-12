import { isIP } from "node:net";
import { env } from "@/lib/env";
import {
  CONTACT_MESSAGES,
  CONTACT_RATE_LIMIT,
  parseContactInput,
  saveContactMessage,
} from "@/lib/contact";
import { CACHE_NONE, publicError, publicJson } from "@/lib/public-api/http";
import {
  CLIENT_IP_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifyRequestSignature,
} from "@/lib/public-api/signing";
import { rateLimit } from "@/lib/rate-limit";

// Server-to-server contact form for the Astro Worker. Not for browsers: no
// CORS, and every request must carry an HMAC signature made with
// PUBLIC_API_SHARED_SECRET (lib/public-api/signing.ts). Contract and error
// codes: docs/cloudflare/content-api.md.
export const dynamic = "force-dynamic";

/** Generous for 5000 chars of 4-byte characters plus the other fields. */
const MAX_BODY_BYTES = 32 * 1024;

export async function POST(request: Request) {
  // Fail closed: without a secret nobody can be authenticated.
  const secret = env.PUBLIC_API_SHARED_SECRET;
  if (!secret) return publicError(503, "service_unavailable");

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return publicError(400, "body_too_large");
  }
  const rawBody = Buffer.from(await request.arrayBuffer());
  if (rawBody.length > MAX_BODY_BYTES) {
    return publicError(400, "body_too_large");
  }

  const verdict = verifyRequestSignature({
    secret,
    timestamp: request.headers.get(TIMESTAMP_HEADER),
    signature: request.headers.get(SIGNATURE_HEADER),
    rawBody,
  });
  if (!verdict.ok) {
    return publicError(401, "unauthorized", { reason: verdict.reason });
  }

  // Only now is the caller known to be the Worker, so only now is the address
  // it reports trusted. The request's own headers show a Cloudflare egress
  // address, which would put every visitor in one rate-limit bucket.
  const clientIp = request.headers.get(CLIENT_IP_HEADER)?.trim();
  if (!clientIp || !isIP(clientIp)) {
    return publicError(400, "invalid_client_ip");
  }

  const limit = await rateLimit({ ...CONTACT_RATE_LIMIT, ip: clientIp });
  if (!limit.allowed) {
    return rateLimited("rate_limited", CONTACT_MESSAGES.rateLimited, limit.resetAt);
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return publicError(400, "invalid_json");
  }

  const parsed = parseContactInput(json);
  // Silently drop honeypot hits, exactly as the on-site form does.
  if (parsed.kind === "honeypot") return created();
  if (parsed.kind === "invalid") {
    return publicError(400, "validation_failed", {
      message: CONTACT_MESSAGES.invalid,
      fieldErrors: parsed.fieldErrors,
    });
  }

  if ((await saveContactMessage(parsed.data)) === "duplicate") {
    return rateLimited(
      "duplicate_recent",
      CONTACT_MESSAGES.duplicate,
      Date.now() + 5 * 60 * 1000,
    );
  }
  return created();
}

/** Same body for a saved message and a dropped honeypot hit. */
function created() {
  return publicJson(
    { ok: true, message: CONTACT_MESSAGES.success },
    CACHE_NONE,
    201,
  );
}

function rateLimited(error: string, message: string, resetAt: number) {
  const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  return publicError(429, error, { message, retryAfterSeconds: retryAfter }, {
    "Retry-After": String(retryAfter),
  });
}
