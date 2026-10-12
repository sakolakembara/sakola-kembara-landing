import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { vi } from "vitest";
import worker from "../src/worker";
import type { Bindings } from "../src/env";

export const ORIGIN = "https://admin.test";
export const PASSWORD = "correct horse battery staple";

let counter = 0;
/** A fresh fake client address, so the per-IP rate limit never couples two tests. */
export function freshIp(): string {
  counter += 1;
  return `203.0.113.${(counter % 250) + 1}`;
}

export function uniqueEmail(label = "user"): string {
  counter += 1;
  return `${label}-${counter}-${crypto.randomUUID().slice(0, 8)}@example.test`;
}

interface CallInit extends RequestInit {
  /** Replaces bindings for this call only, e.g. { ENVIRONMENT: "production" }. */
  env?: Partial<Bindings>;
  ip?: string;
  cookie?: string;
  json?: unknown;
}

/** Calls the worker like the Workers runtime does, and waits for `waitUntil` work. */
export async function call(path: string, init: CallInit = {}): Promise<Response> {
  const { env: overrides, ip, cookie, json, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("cf-connecting-ip", ip ?? freshIp());
  if (cookie) headers.set("cookie", cookie);
  let body = rest.body;
  if (json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(json);
  }
  // `origin` is what a browser sends on a same-origin POST.
  if (rest.method && rest.method !== "GET" && !headers.has("origin")) headers.set("origin", ORIGIN);

  const ctx = createExecutionContext();
  const bindings = { ...env, ...overrides } as Bindings;
  const response = await worker.fetch(new Request(`${ORIGIN}${path}`, { ...rest, headers, body, redirect: "manual" }), bindings, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

/** Name=value pairs of every Set-Cookie, ready for a Cookie header. */
export function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

export interface SentEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

let outbox: SentEmail[] = [];
let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;

function installEmailCapture() {
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url !== "https://api.resend.com/emails") throw new Error(`unexpected outbound request: ${url}`);
    outbox.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: "fake-id" }), { status: 200 });
  });
}

/**
 * Replaces fetch so Resend calls are recorded instead of sent. Any other
 * outbound request fails the test: this app calls nothing else. Starts with an
 * empty outbox each time it is called.
 */
export function captureEmails() {
  outbox = [];
  installEmailCapture();
  return { sent: outbox };
}

/** Local env that has a (fake) Resend key, so email goes through fetch. */
export const withEmail: Partial<Bindings> = {
  RESEND_API_KEY: "re_fake_key_for_tests",
  EMAIL_FROM: "Sakola Kembara <no-reply@example.test>",
};

/** First link in an email text that points at this app. */
export function linkIn(email: SentEmail): string {
  const match = email.text.match(/https:\/\/admin\.test\/\S+/);
  if (!match) throw new Error("no link in email");
  return match[0].replace(ORIGIN, "");
}

export async function signUp(email: string, password = PASSWORD, name = "Tester") {
  return call("/api/auth/sign-up/email", {
    method: "POST",
    json: { email, password, name, callbackURL: "/login?verified=1" },
    env: withEmail,
  });
}

/** Sign up, follow the emailed verification link, and return the user id. */
export async function createVerifiedUser(email: string, role?: "student" | "viewer" | "editor" | "super_admin") {
  const capturing = fetchSpy !== undefined && vi.isMockFunction(globalThis.fetch);
  if (!capturing) installEmailCapture();
  const before = outbox.length;
  await signUp(email);
  const verification = outbox.slice(before).find((message) => message.to === email);
  if (!verification) throw new Error("no verification email was sent");
  await call(linkIn(verification), { env: withEmail });
  if (!capturing) {
    fetchSpy!.mockRestore();
    fetchSpy = undefined;
  }
  if (role) await env.DB.prepare("UPDATE users SET role = ? WHERE email = ?").bind(role, email).run();
  const row = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
  return row!.id;
}

export async function signIn(email: string, password = PASSWORD, ip?: string) {
  return call("/api/auth/sign-in/email", { method: "POST", json: { email, password }, ip });
}

/** Verified user, signed in. Returns the Cookie header to use on later calls. */
export async function signedInCookie(email: string, role?: "student" | "viewer" | "editor" | "super_admin") {
  await createVerifiedUser(email, role);
  const res = await signIn(email);
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.status}`);
  return cookiesOf(res);
}
