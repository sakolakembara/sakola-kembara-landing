import { MAX_FILE_BYTES } from "@shared/application-form/limits";
import { SLOT_IDS, SLOTS } from "@shared/application-form/slots";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { acceptFor, checkPickedFile, checkSendSize, FILE_MESSAGES, formatBytes, typeOfPicked, typesHint } from "~/lib/files/accept";
import { CLIENT_MESSAGES, failureMessage, fileHref, FILES_API, removeFile, setFileUploader, uploadFile, xhrFileUploader } from "~/lib/files/client";
import { fitWithin, type ImageCodec, JPEG_QUALITY, MAX_LONG_SIDE, prepareForUpload, shouldReencode } from "~/lib/files/compress";
import { parseStoredFile, parseUploadResponse } from "~/lib/files/types";
import { respond, stubApi } from "./helpers";

// The pure and the near-pure parts of the portal's file client (SAKEM-083, P4): what a file input offers and refuses, the
// re-encoding decisions, the request the upload sends and the sentence of each answer. The field that uses them is in
// file-slot-field.test.tsx; the Worker's side is test/private-files-*.test.ts, and the two agree in
// test/portal-files-spa-contract.test.ts.

describe("what a file input offers (accept)", () => {
  test("explicit types only, never image/* (an iPhone converts HEIC to JPEG instead of offering what the server refuses)", () => {
    for (const slot of SLOT_IDS) {
      expect(acceptFor(slot), slot).not.toContain("*");
      expect(acceptFor(slot).split(",").sort(), slot).toEqual(SLOTS[slot].types.map((type) => ({ png: "image/png", jpeg: "image/jpeg", webp: "image/webp", pdf: "application/pdf" })[type]).sort());
    }
    expect(acceptFor("family-card")).toBe("image/png,image/jpeg,image/webp,application/pdf");
    expect(acceptFor("self-photo")).toBe("image/png,image/jpeg,image/webp");
    expect(typesHint("family-card")).toBe("PNG, JPEG, WebP, PDF");
    expect(typesHint("self-photo")).toBe("PNG, JPEG, WebP");
  });

  test("the browser's guess, or the extension when it guesses nothing; a guess that is not ours is refused whatever the extension says", () => {
    expect(typeOfPicked({ name: "x.bin", type: "image/png" })).toBe("png");
    expect(typeOfPicked({ name: "FOTO.JPG", type: "" })).toBe("jpeg");
    expect(typeOfPicked({ name: "scan.PDF", type: "" })).toBe("pdf");
    expect(typeOfPicked({ name: "a.webp", type: "" })).toBe("webp");
    expect(typeOfPicked({ name: "kk.png", type: "text/html" })).toBeNull();
    expect(typeOfPicked({ name: "kk.exe", type: "" })).toBeNull();
    expect(typeOfPicked({ name: "kk", type: "" })).toBeNull();
    expect(typeOfPicked({ name: "kk.gif", type: "image/gif" })).toBeNull();
  });

  test("a file is refused on the phone, with the Worker's own words, before anything is sent", () => {
    expect(checkPickedFile("family-card", { name: "kk.pdf", size: 0, type: "application/pdf" })).toBe("File kosong.");
    expect(checkPickedFile("family-card", { name: "kk.pdf", size: MAX_FILE_BYTES + 1, type: "application/pdf" })).toBe("Ukuran file maksimal 10 MB.");
    expect(checkPickedFile("family-card", { name: "kk.pdf", size: MAX_FILE_BYTES, type: "application/pdf" })).toBeNull();
    expect(checkPickedFile("family-card", { name: "kk.exe", size: 100, type: "" })).toBe("Tipe file tidak didukung. Gunakan: PNG, JPEG, WebP, PDF.");
    expect(checkPickedFile("self-photo", { name: "foto.pdf", size: 100, type: "application/pdf" })).toBe("Tipe file tidak didukung. Gunakan: PNG, JPEG, WebP.");
    expect(checkPickedFile("self-photo", { name: "foto.jpg", size: 100, type: "image/jpeg" })).toBeNull();
    // An image bigger than 10 MB is fine to PICK: it is re-encoded much smaller, and the size is checked again on what is sent.
    expect(checkPickedFile("family-card", { name: "kk.jpg", size: 12_000_000, type: "image/jpeg" })).toBeNull();
    expect(FILE_MESSAGES.tooBig).toBe("Ukuran file maksimal 10 MB.");
  });

  test("the size of what is really sent: not empty, at most 10,000,000 bytes", () => {
    expect(checkSendSize(1)).toBeNull();
    expect(checkSendSize(MAX_FILE_BYTES)).toBeNull();
    expect(checkSendSize(MAX_FILE_BYTES + 1)).toBe("Ukuran file maksimal 10 MB.");
    expect(checkSendSize(0)).toBe("File kosong.");
  });

  test("sizes in decimal units with the Indonesian comma", () => {
    expect([0, 999, 1000, 45_500, 1_840_000, 10_000_000].map(formatBytes)).toEqual(["0 B", "999 B", "1 kB", "45,5 kB", "1,8 MB", "10 MB"]);
  });
});

describe("re-encoding an image in the browser (compress)", () => {
  test("the long side is at most 2,000 px, the proportions are kept, and nothing is ever enlarged", () => {
    expect(MAX_LONG_SIDE).toBe(2000);
    expect(JPEG_QUALITY).toBe(0.85);
    expect(fitWithin(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1500, height: 2000 });
    expect(fitWithin(2000, 2000)).toEqual({ width: 2000, height: 2000 });
    expect(fitWithin(2001, 1000)).toEqual({ width: 2000, height: 1000 });
    expect(fitWithin(4001, 1000)).toEqual({ width: 2000, height: 500 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(10000, 1)).toEqual({ width: 2000, height: 1 }); // never a zero side
    expect(fitWithin(4000, 3000, 1000)).toEqual({ width: 1000, height: 750 });
  });

  test("pictures are re-encoded, PDFs and everything else go as they are", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp"]) expect(shouldReencode(type), type).toBe(true);
    for (const type of ["application/pdf", "image/gif", "image/svg+xml", "image/heic", "text/html", ""]) expect(shouldReencode(type), type).toBe(false);
  });

  function codec(over: { width?: number; height?: number; blob?: Blob | null; decodeFails?: boolean; drawFails?: boolean } = {}) {
    const calls = { decoded: 0, drawn: [] as [number, number][], released: 0 };
    const stand: ImageCodec = {
      async decode() {
        calls.decoded += 1;
        if (over.decodeFails) throw new Error("not an image");
        return {
          width: over.width ?? 4000,
          height: over.height ?? 3000,
          release: () => void (calls.released += 1),
          draw: async (width, height) => {
            calls.drawn.push([width, height]);
            if (over.drawFails) throw new Error("canvas");
            return over.blob === undefined ? new Blob([new Uint8Array(500)], { type: "image/jpeg" }) : over.blob;
          },
        };
      },
    };
    return { stand, calls };
  }
  const photo = () => new File([new Uint8Array(5_000_000)], "foto-ibu-budi.png", { type: "image/png" });

  test("a photo becomes the re-encoded JPEG at the fitted size, and the decoded picture is released", async () => {
    const { stand, calls } = codec();
    const prepared = await prepareForUpload(photo(), stand);
    expect(prepared.reencoded).toBe(true);
    expect(prepared.body.size).toBe(500);
    expect(prepared.body.type).toBe("image/jpeg");
    expect(calls.drawn).toEqual([[2000, 1500]]);
    expect(calls.released).toBe(1);
  });

  test("a PDF, a type the browser cannot re-encode and a browser with no codec are sent unchanged and never decoded", async () => {
    const { stand, calls } = codec();
    const pdf = new File([new Uint8Array(1000)], "kk.pdf", { type: "application/pdf" });
    expect(await prepareForUpload(pdf, stand)).toEqual({ body: pdf, reencoded: false });
    const gif = new File([new Uint8Array(1000)], "a.gif", { type: "image/gif" });
    expect((await prepareForUpload(gif, stand)).body).toBe(gif);
    const image = photo();
    expect(await prepareForUpload(image, null)).toEqual({ body: image, reencoded: false });
    expect(calls.decoded).toBe(0);
  });

  test("when the browser cannot decode or draw it, or the encode gives nothing, the original goes and the server decides; nothing throws", async () => {
    for (const over of [{ decodeFails: true }, { drawFails: true }, { blob: null }, { blob: new Blob([]) }]) {
      const { stand, calls } = codec(over);
      const image = photo();
      const prepared = await prepareForUpload(image, stand);
      expect(prepared, JSON.stringify(over)).toEqual({ body: image, reencoded: false });
      // A picture that was decoded is released even when it could not be drawn.
      if (!over.decodeFails) expect(calls.released, JSON.stringify(over)).toBe(1);
    }
  });

  test("in a test environment (no createImageBitmap) the default codec is none, so nothing is re-encoded and nothing crashes", async () => {
    const image = photo();
    expect(await prepareForUpload(image)).toEqual({ body: image, reencoded: false });
  });
});

class FakeXhr {
  static instances: FakeXhr[] = [];
  upload = new EventTarget();
  method = "";
  url = "";
  headers: Record<string, string> = {};
  withCredentials = false;
  status = 0;
  responseText = "";
  sent: unknown = undefined;
  private listeners = new Map<string, (() => void)[]>();
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
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  getResponseHeader() {
    return null;
  }
  send(body: unknown) {
    this.sent = body;
  }
  abort() {
    this.fire("abort");
  }
  fire(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
  answer(status: number, body: unknown) {
    this.status = status;
    this.responseText = typeof body === "string" ? body : JSON.stringify(body);
    this.fire("load");
  }
}
const lastXhr = () => FakeXhr.instances.at(-1)!;

const STORED = { id: "c0ffee00-0000-4000-8000-000000000003", slot: "family-card", contentType: "application/pdf", size: 812_345, width: null, height: null, uploadedAt: "2026-10-13T03:30:00.000Z" };
const CREATED = { file: STORED, usage: { slotCount: 1, slotMax: 2, applicationFiles: 5, applicationBytes: 4_123_456 }, draft: { id: "5f1d2c3b-0000-4000-8000-000000000002", missingFiles: ["electricity-bill", "self-photo"] } };

describe("the upload request", () => {
  beforeEach(() => {
    FakeXhr.instances = [];
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setFileUploader(null);
  });

  test("one PUT of the raw bytes to the slot, with the cookie and a constant type: no file name, no multipart, no query", async () => {
    const body = new Blob([new Uint8Array(1234)], { type: "image/jpeg" });
    const pending = xhrFileUploader({ slot: "family-card", body });
    const xhr = lastXhr();
    expect([xhr.method, xhr.url, xhr.withCredentials]).toEqual(["PUT", "/portal/api/applications/current/files/family-card", true]);
    expect(xhr.headers).toEqual({ "Content-Type": "application/octet-stream", Accept: "application/json" });
    expect(xhr.sent).toBe(body);
    xhr.answer(201, CREATED);
    expect(await pending).toEqual({ ok: true, response: CREATED });
  });

  test("a replacement names the file it takes the place of, encoded", async () => {
    const pending = xhrFileUploader({ slot: "self-photo", body: new Blob([new Uint8Array(1)]), replace: "c0ffee00-0000-4000-8000-000000000003" });
    expect(lastXhr().url).toBe("/portal/api/applications/current/files/self-photo?replace=c0ffee00-0000-4000-8000-000000000003");
    lastXhr().answer(201, CREATED);
    await pending;
    void xhrFileUploader({ slot: "self-photo", body: new Blob([new Uint8Array(1)]), replace: "a b&c" });
    expect(lastXhr().url).toBe("/portal/api/applications/current/files/self-photo?replace=a%20b%26c");
  });

  test("every refusal of the Worker is its own sentence; a guard's refusal and a proxy's page are the SPA's line, never a code", async () => {
    for (const [status, body, message, code] of [
      [413, { error: "too_large", message: "Ukuran file maksimal 10 MB.", maxBytes: 10_000_000 }, "Ukuran file maksimal 10 MB.", "too_large"],
      [409, { error: "slot_full", message: "Slot ini sudah penuh. Hapus satu berkas dulu atau ganti berkas yang ada.", max: 2 }, "Slot ini sudah penuh. Hapus satu berkas dulu atau ganti berkas yang ada.", "slot_full"],
      [415, { error: "unsupported_type", message: "Tipe file tidak didukung. Gunakan: PNG, JPEG, WebP, PDF.", allowed: [] }, "Tipe file tidak didukung. Gunakan: PNG, JPEG, WebP, PDF.", "unsupported_type"],
      [503, { error: "storage_full", message: "Penyimpanan berkas sedang penuh. Hubungi panitia lewat WhatsApp." }, "Penyimpanan berkas sedang penuh. Hubungi panitia lewat WhatsApp.", "storage_full"],
      [429, { error: "rate_limited", message: "Terlalu banyak unggahan. Silakan tunggu satu menit lalu coba lagi.", retryAfterSeconds: 60 }, "Terlalu banyak unggahan. Silakan tunggu satu menit lalu coba lagi.", "rate_limited"],
      [403, { error: "student_only" }, CLIENT_MESSAGES.server, "student_only"],
      [502, "<html>Bad gateway</html>", CLIENT_MESSAGES.server, undefined],
    ] as const) {
      const pending = xhrFileUploader({ slot: "family-card", body: new Blob([new Uint8Array(1)]) });
      lastXhr().answer(status, body);
      expect(await pending, String(status)).toEqual({ ok: false, status, message, code });
    }
  });

  test("401 is the session ending: its own line, for the wizard to send the student back to sign in", async () => {
    const pending = xhrFileUploader({ slot: "family-card", body: new Blob([new Uint8Array(1)]) });
    lastXhr().answer(401, { error: "unauthenticated" });
    expect(await pending).toEqual({ ok: false, status: 401, message: "Sesi kamu sudah berakhir. Silakan masuk lagi.", code: "unauthenticated" });
  });

  test("a 201 that is not a stored file is an error, not a crash; so is a 200", async () => {
    for (const [status, body] of [[201, "{nope"], [201, { file: { id: 1 } }], [200, CREATED]] as const) {
      const pending = xhrFileUploader({ slot: "family-card", body: new Blob([new Uint8Array(1)]) });
      lastXhr().answer(status, body);
      expect(await pending).toMatchObject({ ok: false, message: CLIENT_MESSAGES.badAnswer });
    }
  });

  test("no network is status 0 with the offline sentence; an abort is its own outcome", async () => {
    const offline = xhrFileUploader({ slot: "family-card", body: new Blob([new Uint8Array(1)]) });
    lastXhr().fire("error");
    expect(await offline).toEqual({ ok: false, status: 0, message: "Tidak dapat terhubung ke server. Periksa koneksi internet lalu coba lagi." });

    const controller = new AbortController();
    const stopped = xhrFileUploader({ slot: "family-card", body: new Blob([new Uint8Array(1)]), signal: controller.signal });
    controller.abort();
    expect(await stopped).toEqual({ ok: false, status: 0, message: "Unggahan dibatalkan.", code: "aborted" });
  });

  test("the uploader can be replaced and put back (the mock, the tests)", async () => {
    const fake = vi.fn(async () => ({ ok: true as const, response: CREATED as never }));
    setFileUploader(fake);
    await uploadFile({ slot: "family-card", body: new Blob([new Uint8Array(1)]) });
    expect(fake).toHaveBeenCalledOnce();
    setFileUploader(null);
    const pending = uploadFile({ slot: "family-card", body: new Blob([new Uint8Array(1)]) });
    lastXhr().answer(201, CREATED);
    expect(await pending).toMatchObject({ ok: true });
  });

  test("failureMessage: the Worker's sentence when it has one, else the SPA's", () => {
    expect(failureMessage(409, { message: "Ada kalimat." })).toBe("Ada kalimat.");
    expect(failureMessage(409, { message: "  " })).toBe(CLIENT_MESSAGES.server);
    expect(failureMessage(500, null)).toBe(CLIENT_MESSAGES.server);
    expect(failureMessage(401, { message: "x" })).toBe(CLIENT_MESSAGES.expired);
  });
});

describe("removing a file and linking to one", () => {
  test("DELETE of the file by its id; 204 and 404 (already gone) are both done", async () => {
    const api = stubApi({ "DELETE /portal/api/applications/current/files/f1": respond(null, 204), "DELETE /portal/api/applications/current/files/gone": respond({ error: "not_found" }, 404) });
    expect(await removeFile("f1")).toEqual({ ok: true });
    expect(await removeFile("gone")).toEqual({ ok: true });
    expect(api.calls.map((call) => `${call.method} ${call.path}`)).toEqual(["DELETE /portal/api/applications/current/files/f1", "DELETE /portal/api/applications/current/files/gone"]);
  });

  test("the gate's sentence, the session ending, the network and anything else are each told apart", async () => {
    stubApi({
      "DELETE /portal/api/applications/current/files/closed": respond({ error: "batch_closed", message: "Pendaftaran untuk batch ini sudah ditutup. Isianmu tidak bisa disimpan atau dikirim." }, 409),
      "DELETE /portal/api/applications/current/files/expired": respond({ error: "unauthenticated" }, 401),
      "DELETE /portal/api/applications/current/files/boom": respond({ error: "internal" }, 500),
    });
    expect(await removeFile("closed")).toEqual({ ok: false, status: 409, message: "Pendaftaran untuk batch ini sudah ditutup. Isianmu tidak bisa disimpan atau dikirim." });
    expect(await removeFile("expired")).toEqual({ ok: false, status: 401, message: CLIENT_MESSAGES.expired });
    expect(await removeFile("boom")).toEqual({ ok: false, status: 500, message: CLIENT_MESSAGES.deleteFailed });
  });

  test("a stored file is a plain link through the Worker; the address is built from the id alone", () => {
    expect(FILES_API).toBe("/portal/api/applications/current/files");
    expect(fileHref("c0ffee00-0000-4000-8000-000000000003")).toBe("/portal/api/files/c0ffee00-0000-4000-8000-000000000003");
    expect(fileHref("a b/../c")).toBe("/portal/api/files/a%20b%2F..%2Fc");
  });
});

describe("reading the Worker's answers", () => {
  test("a stored file, exactly the keys the Worker sends; anything else is null", () => {
    expect(parseStoredFile(STORED)).toEqual(STORED);
    expect(parseStoredFile({ ...STORED, width: 800, height: 600 })).toMatchObject({ width: 800, height: 600 });
    for (const bad of [null, "x", [], {}, { ...STORED, slot: "nope" }, { ...STORED, id: "" }, { ...STORED, size: -1 }, { ...STORED, size: "1" }, { ...STORED, width: 0 }, { ...STORED, uploadedAt: 5 }]) {
      expect(parseStoredFile(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  test("an upload's answer: the file, the usage and what the draft still lacks", () => {
    expect(parseUploadResponse(CREATED)).toEqual(CREATED);
    for (const bad of [null, {}, { ...CREATED, usage: null }, { ...CREATED, draft: { id: "x", missingFiles: ["nope"] } }, { ...CREATED, usage: { ...CREATED.usage, slotCount: "1" } }, { ...CREATED, file: {} }]) {
      expect(parseUploadResponse(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
