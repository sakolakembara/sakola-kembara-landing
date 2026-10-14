import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { sendXhr } from "../../../shared/spa/xhr";

// The shared XMLHttpRequest of both SPAs (shared/spa/xhr.ts): the admin's upload (spa/test/crud/upload.test.tsx) and the
// student portal's file client (portal-spa/test/files-client.test.ts) are thin callers of it. Here the request itself:
// what it sends, what it reports, how it stops. A stubbed XHR, so progress, errors and abort are driven by the test.

class FakeXhr {
  static instances: FakeXhr[] = [];
  upload = new EventTarget();
  method = "";
  url = "";
  headers: Record<string, string> = {};
  withCredentials = false;
  status = 0;
  responseText = "";
  responseHeaders: Record<string, string> = {};
  sent: unknown = undefined;
  aborted = false;
  private listeners = new Map<string, ((event: Event) => void)[]>();

  constructor() {
    FakeXhr.instances.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  addEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  getResponseHeader(name: string) {
    return this.responseHeaders[name.toLowerCase()] ?? null;
  }
  send(body: unknown) {
    this.sent = body;
  }
  abort() {
    this.aborted = true;
    this.fire("abort");
  }
  fire(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener(new Event(type));
  }
  progress(loaded: number, total: number, lengthComputable = true) {
    this.upload.dispatchEvent(Object.assign(new Event("progress"), { loaded, total, lengthComputable }));
  }
  answer(status: number, text: string, headers: Record<string, string> = {}) {
    this.status = status;
    this.responseText = text;
    this.responseHeaders = headers;
    this.fire("load");
  }
}

const last = () => FakeXhr.instances.at(-1)!;

beforeEach(() => {
  FakeXhr.instances = [];
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
});
afterEach(() => vi.unstubAllGlobals());

describe("sendXhr", () => {
  test("sends the body with the method, the address, the session cookie and the headers it is given, as they are", async () => {
    const body = new Uint8Array([1, 2, 3]);
    const pending = sendXhr({ method: "PUT", url: "/portal/api/x", body, headers: { Accept: "application/json", "Content-Type": "application/octet-stream" } });
    const xhr = last();
    expect([xhr.method, xhr.url, xhr.withCredentials, xhr.sent]).toEqual(["PUT", "/portal/api/x", true, body]);
    expect(xhr.headers).toEqual({ Accept: "application/json", "Content-Type": "application/octet-stream" });
    xhr.answer(201, '{"ok":true}', { "retry-after": "60" });
    const outcome = await pending;
    expect(outcome.kind).toBe("response");
    if (outcome.kind !== "response") throw new Error("no response");
    expect([outcome.status, outcome.text, outcome.header("Retry-After"), outcome.header("X-Nothing")]).toEqual([201, '{"ok":true}', "60", null]);
  });

  test("no headers at all is fine (a FormData sets its own boundary)", async () => {
    const pending = sendXhr({ method: "POST", url: "/x", body: new FormData() });
    expect(last().headers).toEqual({});
    last().answer(200, "");
    expect((await pending).kind).toBe("response");
  });

  test("any status is an answer, an error status included: what it means is the caller's to say", async () => {
    for (const status of [400, 403, 429, 500, 503]) {
      const pending = sendXhr({ method: "PUT", url: "/x", body: new Uint8Array(1) });
      last().answer(status, "{}");
      expect(await pending, String(status)).toMatchObject({ kind: "response", status });
    }
  });

  test("progress is bytes sent over the total, between 0 and 1; a total the browser cannot tell is ignored", async () => {
    const seen: number[] = [];
    const pending = sendXhr({ method: "PUT", url: "/x", body: new Uint8Array(1), onProgress: (fraction) => seen.push(fraction) });
    const xhr = last();
    xhr.progress(250, 1000);
    xhr.progress(1000, 1000);
    xhr.progress(10, 0);
    xhr.progress(10, 1000, false);
    xhr.progress(2000, 1000);
    xhr.answer(200, "");
    await pending;
    expect(seen).toEqual([0.25, 1, 1]);
  });

  test("an error and a timeout are 'network': the request never got an answer", async () => {
    for (const event of ["error", "timeout"]) {
      const pending = sendXhr({ method: "PUT", url: "/x", body: new Uint8Array(1) });
      last().fire(event);
      expect(await pending, event).toEqual({ kind: "network" });
    }
  });

  test("an abort signal stops the request; one that is already aborted sends nothing at all", async () => {
    const controller = new AbortController();
    const pending = sendXhr({ method: "PUT", url: "/x", body: new Uint8Array(1), signal: controller.signal });
    controller.abort();
    expect(last().aborted).toBe(true);
    expect(await pending).toEqual({ kind: "aborted" });

    const spent = new AbortController();
    spent.abort();
    const before = FakeXhr.instances.length;
    expect(await sendXhr({ method: "PUT", url: "/x", body: new Uint8Array(1), signal: spent.signal })).toEqual({ kind: "aborted" });
    expect(FakeXhr.instances[before]!.sent).toBeUndefined();
  });
});
