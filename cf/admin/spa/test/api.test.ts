import { describe, expect, test, vi } from "vitest";
import { api, onActivity, onWrite, requestsInFlight, setTransport } from "~/lib/api";
import { deferred, respond } from "./helpers";

describe("api()", () => {
  test("returns the parsed body on success", async () => {
    setTransport(async () => respond({ hello: "dunia" }));
    expect(await api("/api/x")).toEqual({ ok: true, data: { hello: "dunia" } });
  });

  test("a 204 has no body", async () => {
    setTransport(async () => respond(null, 204));
    expect(await api("/api/x", { method: "DELETE" })).toEqual({ ok: true, data: null });
  });

  test("sends JSON with the content type the Worker requires, and cookies", async () => {
    const transport = vi.fn(async () => respond({}));
    setTransport(transport);
    await api("/api/x", { method: "POST", json: { a: 1 } });
    const [path, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/x");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(init.body).toBe('{"a":1}');
    expect(init.credentials).toBe("same-origin");
  });

  test("a Turnstile token goes in the X-Turnstile-Token header, next to the JSON", async () => {
    const transport = vi.fn(async () => respond({}));
    setTransport(transport);
    await api("/api/x", { method: "POST", json: { a: 1 }, turnstileToken: "token-123" });
    const [path, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/x"); // never in the address
    expect(init.headers).toEqual({ "Content-Type": "application/json", "X-Turnstile-Token": "token-123" });
    expect(init.body).toBe('{"a":1}'); // nor in the body
  });

  test("no token (none yet, or no Turnstile here) adds no header, not even an empty one", async () => {
    const transport = vi.fn(async () => respond({}));
    setTransport(transport);
    await api("/api/x", { method: "POST", json: {}, turnstileToken: null });
    await api("/api/x", { method: "POST", json: {}, turnstileToken: "" });
    await api("/api/x", { method: "POST", json: {} });
    for (const call of transport.mock.calls as unknown as [string, RequestInit][]) {
      expect(call[1].headers).toEqual({ "Content-Type": "application/json" });
    }
  });

  test("a GET sends no body and no content type", async () => {
    const transport = vi.fn(async () => respond({}));
    setTransport(transport);
    await api("/api/x");
    const init = (transport.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.headers).toBeUndefined();
  });

  test("a failure carries the status and the Better Auth code", async () => {
    setTransport(async () => respond({ code: "EMAIL_NOT_VERIFIED", message: "Email not verified" }, 403));
    expect(await api("/api/x")).toMatchObject({ ok: false, status: 403, code: "EMAIL_NOT_VERIFIED" });
  });

  test("or the Worker's `error`", async () => {
    setTransport(async () => respond({ error: "forbidden" }, 403));
    expect(await api("/api/x")).toMatchObject({ ok: false, status: 403, code: "forbidden" });
  });

  test("field errors come through", async () => {
    setTransport(async () => respond({ error: "invalid", fieldErrors: { title: ["Judul minimal 3 karakter"] } }, 400));
    expect(await api("/api/x")).toMatchObject({ ok: false, status: 400, fieldErrors: { title: ["Judul minimal 3 karakter"] } });
  });

  test("reads Retry-After in seconds", async () => {
    setTransport(async () => respond({ error: "rate_limited" }, 429, { "Retry-After": "60" }));
    expect(await api("/api/x")).toMatchObject({ ok: false, status: 429, retryAfter: 60 });
  });

  test("ignores a Retry-After that is a date", async () => {
    setTransport(async () => respond({}, 429, { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" }));
    const result = await api("/api/x");
    expect(result).toMatchObject({ ok: false, status: 429 });
    expect((result as { retryAfter?: number }).retryAfter).toBeUndefined();
  });

  test("a body that is not JSON still gives a failure", async () => {
    setTransport(async () => new Response("<html>bad gateway</html>", { status: 502 }));
    expect(await api("/api/x")).toMatchObject({ ok: false, status: 502, code: undefined });
  });

  test("never throws: no answer is status 0", async () => {
    setTransport(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await api("/api/x")).toEqual({ ok: false, status: 0 });
  });

  test("setTransport(null) restores fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(respond({ via: "fetch" }));
    setTransport(async () => respond({ via: "stub" }));
    setTransport(null);
    expect(await api("/api/x")).toEqual({ ok: true, data: { via: "fetch" } });
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  test("onWrite is told after every write, whatever its answer, and never after a read", async () => {
    const told = vi.fn();
    const stop = onWrite(told);
    setTransport(async () => respond({}));
    await api("/api/x");
    await api("/api/x", { method: "HEAD" });
    expect(told).not.toHaveBeenCalled();
    await api("/api/x", { method: "POST", json: {} });
    setTransport(async () => respond({ error: "boom" }, 500));
    await api("/api/x", { method: "delete" });
    setTransport(async () => {
      throw new Error("offline");
    });
    await api("/api/x", { method: "PUT", json: {} });
    expect(told).toHaveBeenCalledTimes(3);
    stop();
    await api("/api/x", { method: "POST", json: {} });
    expect(told).toHaveBeenCalledTimes(3);
  });

  test("requestsInFlight counts the calls still waiting, and onActivity is told at every change, whatever the end", async () => {
    const seen: number[] = [];
    const stop = onActivity(() => seen.push(requestsInFlight()));
    const gate = deferred<Response>();
    setTransport(() => gate.promise.then((response) => response.clone()));
    const first = api("/api/x");
    const second = api("/api/y", { method: "POST", json: {} });
    expect(requestsInFlight()).toBe(2);
    gate.resolve(respond({}));
    await Promise.all([first, second]);
    expect(requestsInFlight()).toBe(0);
    setTransport(async () => {
      throw new Error("offline");
    });
    await api("/api/x");
    setTransport(async () => respond({ error: "boom" }, 500));
    await api("/api/x");
    expect(requestsInFlight()).toBe(0);
    expect(seen).toEqual([1, 2, 1, 0, 1, 0, 1, 0]);
    stop();
    await api("/api/x");
    expect(seen).toHaveLength(8);
  });
});
