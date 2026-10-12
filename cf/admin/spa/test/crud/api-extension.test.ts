import { afterEach, describe, expect, test } from "vitest";
import { api, setTransport } from "~/lib/api";
import { ifMatch } from "~/lib/crud/etag";
import { respond } from "../helpers";

// What `api()` learned for the CRUD API: the error's `message` and `fields`, `If-Match`, and an abort signal.

afterEach(() => setTransport(null));

function recording(answer: () => Response) {
  const seen: { path: string; init: RequestInit }[] = [];
  setTransport(async (path, init) => {
    seen.push({ path, init });
    return answer();
  });
  return seen;
}

describe("api(): the CRUD API's errors", () => {
  test("the Worker's message and fields are kept", async () => {
    recording(() => respond({ error: "invalid", message: "Periksa kembali isian formulir.", fields: { title: "Judul minimal 3 karakter" } }, 400));
    expect(await api("/x", { method: "POST", json: {} })).toEqual({
      ok: false,
      status: 400,
      code: "invalid",
      message: "Periksa kembali isian formulir.",
      fields: { title: "Judul minimal 3 karakter" },
      fieldErrors: undefined,
      retryAfter: undefined,
    });
  });

  test("only strings survive in `fields`: whatever else arrives is not shown", async () => {
    recording(() => respond({ error: "invalid", fields: { title: "ok", evil: { html: "<img onerror=x>" }, list: ["a"], n: 3, nothing: null } }, 400));
    const result = await api("/x");
    expect(result).toMatchObject({ ok: false, fields: { title: "ok" } });
    expect(Object.keys((result as { fields: object }).fields)).toEqual(["title"]);
    for (const bad of [[], "text", 5, null]) {
      recording(() => respond({ error: "invalid", fields: bad }, 400));
      expect(await api("/x")).toMatchObject({ ok: false, fields: undefined });
    }
  });

  test("Better Auth's English message is never taken as a message for people", async () => {
    recording(() => respond({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }, 401));
    expect(await api("/api/auth/sign-in/email", { method: "POST", json: {} })).toMatchObject({ ok: false, status: 401, code: "INVALID_EMAIL_OR_PASSWORD", message: undefined });
  });

  test("a blank message is no message", async () => {
    recording(() => respond({ error: "not_found", message: "   " }, 404));
    expect(await api("/x")).toMatchObject({ message: undefined });
  });
});

describe("api(): If-Match and abort", () => {
  test("`ifMatch` goes in the If-Match header, and nothing else changes", async () => {
    const seen = recording(() => respond({ item: {} }));
    await api("/x/1", { method: "PUT", json: { a: 1 }, ifMatch: ifMatch("2026-10-12T08:30:00.123Z") });
    expect(seen[0]!.init.headers).toEqual({ "Content-Type": "application/json", "If-Match": '"2026-10-12T08:30:00.123Z"' });
    await api("/x/1");
    expect(seen[1]!.init.headers).toBeUndefined();
  });

  test("the signal reaches the transport, and an aborted call is `status 0`, never a throw", async () => {
    const controller = new AbortController();
    let received: AbortSignal | null | undefined;
    setTransport(async (_path, init) => {
      received = init.signal;
      throw new DOMException("aborted", "AbortError");
    });
    controller.abort();
    expect(await api("/x", { signal: controller.signal })).toEqual({ ok: false, status: 0 });
    expect(received).toBe(controller.signal);
  });
});

describe("ifMatch", () => {
  test("is the updatedAt in double quotes: the Worker's ETag", () => {
    expect(ifMatch("2026-10-12T08:30:00.123Z")).toBe('"2026-10-12T08:30:00.123Z"');
  });
});
