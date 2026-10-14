import type { Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context";
import { AUTH_BASE_PATH, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./factory";

// POST /api/auth/register: a student creates their own account. The portal UI
// is a later milestone; this is its contract (documented in docs/cloudflare/auth.md).
//
//   request   JSON { name, email, password, confirmPassword?, callbackURL?, website? }
//             header X-Turnstile-Token (checked, with the rate limits, in src/auth/gate.ts)
//   200       { ok: true, message }  THE SAME for a new address, an address that already
//             has an account, and a honeypot hit. Nothing in the answer, its status or its
//             body tells the caller whether the address is registered; a new owner gets
//             the verification link, an existing one gets an "akun sudah ada" email.
//   400       { error: "invalid", message, fieldErrors }  legacy rules and wording
//   403/415/429/503  from the gate and the origin guard
//
// The role is always `student`: it is not read from the request, and Better Auth
// refuses a client-sent role anyway (`input: false`). Admins are created by a
// super_admin (src/api/admin-users.ts) and there is no public admin sign-up.
//
// It delegates to Better Auth's own sign-up (which hashes the password even
// when the address exists, so timing does not give it away, creates the
// account and sends the verification email) and then throws away its answer:
// Better Auth's JSON carries a user object, ours must not.

// Rules and messages of app/(auth)/register/actions.ts.
const name = z.string().trim().min(2, "Nama minimal 2 karakter").max(120, "Maksimal 120 karakter");
const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Format email belum benar").max(254, "Email terlalu panjang"));
const password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password minimal ${PASSWORD_MIN_LENGTH} karakter`)
  .max(PASSWORD_MAX_LENGTH, `Password maksimal ${PASSWORD_MAX_LENGTH} karakter`);

const registerInput = z
  .object({
    name,
    email,
    password,
    /** Optional: the form checks it too, but a client that sends it gets the legacy server-side check. */
    confirmPassword: z.string().optional(),
    /** Where the verification link sends the browser afterwards. Better Auth only accepts this origin's paths or a trusted origin. */
    callbackURL: z.string().max(500).optional(),
    /** Honeypot: humans never see the field, bots fill it. */
    website: z.string().max(500).optional(),
  })
  .refine((value) => value.confirmPassword === undefined || value.confirmPassword === value.password, {
    message: "Konfirmasi password tidak cocok",
    path: ["confirmPassword"],
  });

export const REGISTER_MESSAGE = "Pendaftaran diterima. Cek email kamu untuk langkah berikutnya (periksa juga folder spam).";

/**
 * The registration handler for one audience's mount point: it forwards to Better Auth's sign-up under the same base
 * path (`/api/auth/sign-up/email` on the admin host, `/portal/api/auth/sign-up/email` on the apex). The rules, the
 * answers and the neutrality are identical; only the path differs.
 */
export function createRegisterStudent(basePath: string): (c: Context<AppEnv>) => Promise<Response> {
  return (c) => handleRegister(basePath, c);
}

/** The admin Worker's: `POST /api/auth/register`. */
export const registerStudent = createRegisterStudent(AUTH_BASE_PATH);

async function handleRegister(basePath: string, c: Context<AppEnv>): Promise<Response> {
  const raw: unknown = await c.req.json().catch(() => undefined);
  if (raw === undefined) return c.json({ error: "invalid", message: "Periksa kembali isian formulir." }, 400);

  const parsed = registerInput.safeParse(raw);
  if (!parsed.success) {
    // A bot that filled the honeypot gets the same answer as a person, and nothing is created.
    if (typeof (raw as { website?: unknown }).website === "string" && (raw as { website: string }).website !== "") {
      return c.json({ ok: true, message: REGISTER_MESSAGE });
    }
    return c.json({ error: "invalid", message: "Periksa kembali isian formulir.", fieldErrors: z.flattenError(parsed.error).fieldErrors }, 400);
  }
  const input = parsed.data;
  if (input.website) return c.json({ ok: true, message: REGISTER_MESSAGE });

  // The request Better Auth sees: same origin and headers (its origin check
  // and IP detection read them), a body that holds only what it should.
  const url = new URL(c.req.url);
  url.pathname = `${basePath}/sign-up/email`;
  url.search = "";
  const headers = new Headers(c.req.raw.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");
  const forwarded = new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: input.name,
      email: input.email,
      password: input.password,
      ...(input.callbackURL ? { callbackURL: input.callbackURL } : {}),
    }),
  });

  const result = await c.get("auth")().handler(forwarded);
  if (result.ok) return c.json({ ok: true, message: REGISTER_MESSAGE });

  // Not the "address exists" case (that is a 200). What is left is a refused callbackURL or an unexpected failure.
  const body = (await result.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.toLowerCase() : "register_failed";
  return c.json({ error: code, message: "Pendaftaran belum berhasil. Periksa isian formulir lalu coba lagi." }, result.status === 403 ? 403 : 400);
}
