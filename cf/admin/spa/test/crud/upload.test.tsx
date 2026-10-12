import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { UploadField } from "~/components/crud/UploadField";
import { discardUpload, resetUploadsBase, setUploader, type UploadOutcome, type UploadRequest, uploadFile, useUploadsBase, xhrUploader } from "~/lib/crud/upload-client";
import type { UploadKindName } from "~/lib/crud/upload-kinds";
import { deferred, respond, stubApi } from "../helpers";

// The browser side of uploads: the XMLHttpRequest uploader (with a stubbed XHR, so progress, errors and abort are
// driven by the test) and the field that uses it (with a stubbed uploader).

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
  sent: FormData | null = null;
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
  send(body: FormData) {
    this.sent = body;
  }
  abort() {
    this.aborted = true;
    this.fire("abort");
  }
  private fire(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener(new Event(type));
  }
  // What the test drives:
  progress(loaded: number, total: number, lengthComputable = true) {
    this.upload.dispatchEvent(Object.assign(new Event("progress"), { loaded, total, lengthComputable }));
  }
  answer(status: number, body: unknown, headers: Record<string, string> = {}) {
    this.status = status;
    this.responseText = typeof body === "string" ? body : JSON.stringify(body);
    this.responseHeaders = headers;
    this.fire("load");
  }
  networkError() {
    this.fire("error");
  }
}

const lastXhr = () => FakeXhr.instances.at(-1)!;
const pngFile = (name = "foto.png", size = 1000) => new File([new Uint8Array(size)], name, { type: "image/png" });

beforeEach(() => {
  FakeXhr.instances = [];
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setUploader(null);
  resetUploadsBase();
});

const RESULT = { id: "11111111-2222-3333-4444-555555555555", path: "/uploads/team-photo/2026/11111111-2222-3333-4444-555555555555-foto.png", contentType: "image/png", size: 1000, width: 8, height: 8 };

describe("xhrUploader: POST /api/admin/uploads", () => {
  test("one multipart POST with the kind in the form and in the query, the session cookie, JSON asked for", async () => {
    const file = pngFile();
    const pending = xhrUploader({ kind: "team-photo", file });
    const xhr = lastXhr();
    expect([xhr.method, xhr.url]).toEqual(["POST", "/api/admin/uploads?kind=team-photo"]);
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.headers).toEqual({ Accept: "application/json" }); // no Content-Type: the browser adds the multipart boundary
    expect(xhr.sent!.get("kind")).toBe("team-photo");
    expect(xhr.sent!.get("file")).toBeInstanceOf(File);
    expect((xhr.sent!.get("file") as File).name).toBe("foto.png");

    xhr.answer(201, RESULT);
    expect(await pending).toEqual({ ok: true, result: RESULT });
  });

  test("progress is bytes sent over the total, between 0 and 1; a total the browser cannot tell is ignored", async () => {
    const seen: number[] = [];
    const pending = xhrUploader({ kind: "team-photo", file: pngFile(), onProgress: (fraction) => seen.push(fraction) });
    const xhr = lastXhr();
    xhr.progress(250, 1000);
    xhr.progress(500, 1000);
    xhr.progress(10, 0); // no total
    xhr.progress(10, 1000, false); // not computable
    xhr.progress(2000, 1000); // more than the total (the envelope): capped
    xhr.answer(201, RESULT);
    await pending;
    expect(seen).toEqual([0.25, 0.5, 1, 1]); // the last 1 is the finished upload
  });

  test("a refusal of the Worker: its sentence, its status, its code", async () => {
    for (const [status, body, message, code] of [
      [413, { error: "too_large", message: "Ukuran file maksimal 5 MB.", maxBytes: 5_000_000 }, "Ukuran file maksimal 5 MB.", "too_large"],
      [415, { error: "unsupported_type", message: "Tipe file tidak didukung. Gunakan: PNG, JPEG, WebP." }, "Tipe file tidak didukung. Gunakan: PNG, JPEG, WebP.", "unsupported_type"],
      [422, { error: "dimensions_too_large", message: "Dimensi gambar terlalu besar." }, "Dimensi gambar terlalu besar.", "dimensions_too_large"],
    ] as const) {
      const pending = xhrUploader({ kind: "team-photo", file: pngFile() });
      lastXhr().answer(status, body);
      expect(await pending, String(status)).toEqual({ ok: false, status, message, code });
    }
  });

  test("a guard's refusal has no message: the SPA's own line, never the code", async () => {
    const forbidden = xhrUploader({ kind: "team-photo", file: pngFile() });
    lastXhr().answer(403, { error: "forbidden" });
    expect(await forbidden).toMatchObject({ ok: false, status: 403, message: "Kamu tidak punya izin untuk melakukan ini." });

    const limited = xhrUploader({ kind: "team-photo", file: pngFile() });
    lastXhr().answer(429, { error: "rate_limited" }, { "retry-after": "60" });
    expect(await limited).toMatchObject({ ok: false, status: 429, message: "Terlalu banyak permintaan. Coba lagi dalam 1 menit." });

    const html = xhrUploader({ kind: "team-photo", file: pngFile() });
    lastXhr().answer(502, "<html>Bad gateway</html>");
    expect(await html).toMatchObject({ ok: false, status: 502, message: "Terjadi kesalahan di server. Coba lagi sebentar lagi." });
  });

  test("a 201 whose body is not an upload is an error, not a crash", async () => {
    const pending = xhrUploader({ kind: "team-photo", file: pngFile() });
    lastXhr().answer(201, "{nope");
    expect(await pending).toMatchObject({ ok: false, message: "Jawaban server tidak bisa dibaca. Coba lagi." });
  });

  test("no network is status 0 with the offline sentence", async () => {
    const pending = xhrUploader({ kind: "team-photo", file: pngFile() });
    lastXhr().networkError();
    expect(await pending).toEqual({ ok: false, status: 0, message: "Tidak dapat terhubung ke server. Periksa koneksi internet lalu coba lagi.", code: undefined });
  });

  test("an abort signal stops the request; one that is already aborted sends nothing", async () => {
    const controller = new AbortController();
    const pending = xhrUploader({ kind: "team-photo", file: pngFile(), signal: controller.signal });
    controller.abort();
    expect(lastXhr().aborted).toBe(true);
    expect(await pending).toMatchObject({ ok: false, status: 0, code: "aborted", message: "Unggahan dibatalkan." });

    const spent = new AbortController();
    spent.abort();
    const before = FakeXhr.instances.length;
    expect(await xhrUploader({ kind: "team-photo", file: pngFile(), signal: spent.signal })).toMatchObject({ code: "aborted" });
    expect(FakeXhr.instances[before]!.sent).toBeNull();
  });

  test("the uploader can be replaced and put back (the mock, the tests)", async () => {
    const fake = vi.fn(async (): Promise<UploadOutcome> => ({ ok: true, result: RESULT }));
    setUploader(fake);
    expect(await uploadFile({ kind: "team-photo", file: pngFile() })).toEqual({ ok: true, result: RESULT });
    expect(fake).toHaveBeenCalledOnce();
    setUploader(null);
    const pending = uploadFile({ kind: "team-photo", file: pngFile() });
    lastXhr().answer(201, RESULT);
    await pending;
    expect(FakeXhr.instances).toHaveLength(1);
  });
});

describe("discardUpload and useUploadsBase", () => {
  test("discarding sends DELETE for the id, encoded", async () => {
    const api = stubApi({ "DELETE /api/admin/uploads/abc%2Fdef": respond(null, 204) });
    discardUpload("abc/def");
    await waitFor(() => expect(api.calls).toHaveLength(1));
    expect(api.calls[0]).toMatchObject({ method: "DELETE", url: "/api/admin/uploads/abc%2Fdef" });
  });

  function Base() {
    return <p data-testid="base">{useUploadsBase()}</p>;
  }

  test("the base comes from GET /api/config once, and is asked only once however many fields there are", async () => {
    const api = stubApi({ "GET /api/config": respond({ google: false, turnstileSiteKey: null, uploadsBaseUrl: "https://files.example.org/" }) });
    const view = render(
      <>
        <Base />
        <Base />
      </>,
    );
    await waitFor(() => expect(screen.getAllByTestId("base")[0]!.textContent).toBe("https://files.example.org"));
    view.unmount();
    render(<Base />);
    expect(screen.getByTestId("base").textContent).toBe("https://files.example.org"); // cached: right at the first render
    expect(api.count("GET /api/config")).toBe(1);
  });

  test("anything that is not an origin, a failure, or no field is the empty base (same origin)", async () => {
    for (const config of [{ uploadsBaseUrl: "javascript:alert(1)" }, { uploadsBaseUrl: 5 }, {}, { uploadsBaseUrl: "https://files.example.org/path" }]) {
      resetUploadsBase();
      stubApi({ "GET /api/config": respond(config) });
      const view = render(<Base />);
      await act(async () => undefined);
      expect(screen.getByTestId("base").textContent, JSON.stringify(config)).toBe("");
      view.unmount();
    }
    resetUploadsBase();
    stubApi({ "GET /api/config": respond({ error: "internal" }, 500) });
    render(<Base />);
    await act(async () => undefined);
    expect(screen.getByTestId("base").textContent).toBe("");
  });
});

// ------------------------------------------------------------------------------ the field

function Field({ kind = "team-photo", initial = null as string | null, ...rest }: { kind?: UploadKindName; initial?: string | null; error?: string; disabled?: boolean; onValue?: (path: string | null) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <UploadField
      id="image"
      label="Foto"
      kind={kind}
      value={value}
      hint="PNG, JPEG, atau WebP, maksimal 5 MB."
      required
      error={rest.error}
      disabled={rest.disabled}
      onChange={(path) => {
        setValue(path);
        rest.onValue?.(path);
      }}
    />
  );
}

const input = (container: HTMLElement) => container.querySelector<HTMLInputElement>('input[type="file"]')!;
function stubUploader() {
  const gates: { request: UploadRequest; resolve: (outcome: UploadOutcome) => void }[] = [];
  setUploader((request) => {
    const gate = deferred<UploadOutcome>();
    gates.push({ request, resolve: gate.resolve });
    return gate.promise;
  });
  return gates;
}

describe("UploadField", () => {
  test("a group named by its label, a button, the hint, the asterisk; the file input is not in the tab order and not announced", () => {
    stubApi({ "GET /api/config": respond({ uploadsBaseUrl: "" }) });
    const { container } = render(<Field />);
    const group = screen.getByRole("group", { name: /Foto/ });
    expect(within(group).getByRole("button", { name: "Pilih file" })).toBeTruthy();
    expect(within(group).getByText("PNG, JPEG, atau WebP, maksimal 5 MB.")).toBeTruthy();
    expect(group.getAttribute("aria-describedby")).toBeTruthy();
    expect(container.querySelector("legend [aria-hidden]")?.textContent).toBe("*");
    const file = input(container);
    expect(file.tabIndex).toBe(-1);
    expect(file.getAttribute("aria-hidden")).toBe("true");
    expect(file.accept).toBe("image/png,.png,image/jpeg,.jpg,.jpeg,image/webp,.webp");
  });

  test("the keyboard opens the picker: Enter on the button clicks the hidden input", async () => {
    stubApi({ "GET /api/config": respond({}) });
    const user = userEvent.setup();
    const { container } = render(<Field />);
    const click = vi.spyOn(input(container), "click");
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Pilih file" }));
    await user.keyboard("{Enter}");
    expect(click).toHaveBeenCalledOnce();
  });

  test("its id is on the button, so the error summary of a form can focus it", () => {
    stubApi({ "GET /api/config": respond({}) });
    render(<Field />);
    expect(screen.getByRole("button", { name: "Pilih file" }).id).toBe("image");
  });

  test("a file the browser can tell is wrong is refused before anything is sent, in the Worker's words, and announced", async () => {
    stubApi({ "GET /api/config": respond({}) });
    const gates = stubUploader();
    const { container } = render(<Field />);

    fireEvent.change(input(container), { target: { files: [new File([new Uint8Array(5_000_001)], "besar.png", { type: "image/png" })] } });
    // Shown under the field, and announced.
    const shown = () => document.getElementById("image-error")?.textContent;
    await waitFor(() => expect(shown()).toBe("Ukuran file maksimal 5 MB."));
    expect(screen.getByRole("status").textContent).toBe("Ukuran file maksimal 5 MB.");

    fireEvent.change(input(container), { target: { files: [new File([new Uint8Array(10)], "laporan.pdf", { type: "application/pdf" })] } });
    await waitFor(() => expect(shown()).toBe("Tipe file tidak didukung. Gunakan: PNG, JPEG, WebP."));

    fireEvent.change(input(container), { target: { files: [new File([], "kosong.png", { type: "image/png" })] } });
    await waitFor(() => expect(shown()).toBe("File kosong."));

    expect(gates).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Pilih file" })).toBeTruthy(); // nothing was chosen
  });

  test("an upload: a progress bar that says how far (the number is not read out), the buttons locked, 'Batal' offered", async () => {
    stubApi({ "GET /api/config": respond({}) });
    const gates = stubUploader();
    const { container } = render(<Field />);
    fireEvent.change(input(container), { target: { files: [pngFile("foto-ibu.png")] } });

    const bar = await screen.findByRole("progressbar", { name: "Mengunggah foto-ibu.png" });
    expect([bar.getAttribute("aria-valuemin"), bar.getAttribute("aria-valuemax"), bar.getAttribute("aria-valuenow")]).toEqual(["0", "100", "0"]);
    expect(screen.getByRole("status").textContent).toBe("Mengunggah foto-ibu.png");
    expect(screen.getByRole("button", { name: "Pilih file" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Batal" })).toBeTruthy();
    expect(input(container).disabled).toBe(true);

    act(() => gates[0]!.request.onProgress?.(0.45));
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("45");
    expect(screen.getByText("45%").getAttribute("aria-hidden")).toBe("true");
    expect(gates[0]!.request).toMatchObject({ kind: "team-photo" });
  });

  test("when it is done the path goes to the form, the bar goes away, and the end is announced", async () => {
    stubApi({ "GET /api/config": respond({}) });
    const gates = stubUploader();
    const onValue = vi.fn();
    const { container } = render(<Field onValue={onValue} />);
    fireEvent.change(input(container), { target: { files: [pngFile("foto.png")] } });
    await screen.findByRole("progressbar");

    await act(async () => gates[0]!.resolve({ ok: true, result: RESULT }));
    expect(onValue).toHaveBeenCalledWith(RESULT.path);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("foto.png selesai diunggah");
    expect(screen.getByRole("button", { name: "Ganti" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hapus" })).toBeTruthy();
  });

  test("a refusal of the Worker is shown and nothing is chosen", async () => {
    stubApi({ "GET /api/config": respond({}) });
    const gates = stubUploader();
    const onValue = vi.fn();
    const { container } = render(<Field onValue={onValue} />);
    fireEvent.change(input(container), { target: { files: [pngFile()] } });
    await screen.findByRole("progressbar");
    await act(async () => gates[0]!.resolve({ ok: false, status: 415, message: "Tipe file tidak didukung. Gunakan: PNG, JPEG, WebP." }));
    expect(document.getElementById("image-error")?.textContent).toBe("Tipe file tidak didukung. Gunakan: PNG, JPEG, WebP.");
    expect(onValue).not.toHaveBeenCalled();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByRole("button", { name: "Pilih file" })).toHaveProperty("disabled", false);
  });

  test("'Batal' aborts the upload: nothing is chosen, and it says so", async () => {
    stubApi({ "GET /api/config": respond({}) });
    const user = userEvent.setup();
    let signal: AbortSignal | undefined;
    setUploader(
      (request) =>
        new Promise<UploadOutcome>((resolve) => {
          signal = request.signal;
          request.signal?.addEventListener("abort", () => resolve({ ok: false, status: 0, message: "Unggahan dibatalkan.", code: "aborted" }));
        }),
    );
    const onValue = vi.fn();
    const { container } = render(<Field onValue={onValue} />);
    fireEvent.change(input(container), { target: { files: [pngFile()] } });
    await user.click(await screen.findByRole("button", { name: "Batal" }));
    await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull());
    expect(signal!.aborted).toBe(true);
    expect(onValue).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("Unggahan dibatalkan");
    expect(screen.queryByText("Unggahan dibatalkan.")).toBeNull(); // a cancel is not an error
  });

  test("leaving the page aborts an upload in flight", async () => {
    stubApi({ "GET /api/config": respond({}) });
    const gates = stubUploader();
    const { container, unmount } = render(<Field />);
    fireEvent.change(input(container), { target: { files: [pngFile()] } });
    await screen.findByRole("progressbar");
    unmount();
    expect(gates[0]!.request.signal!.aborted).toBe(true);
  });

  test("replacing a file uploaded in this form deletes the one it replaces; a file that was already saved is left to the Worker", async () => {
    const api = stubApi({ "GET /api/config": respond({}), "DELETE /api/admin/uploads/first-id": respond(null, 204) });
    const gates = stubUploader();
    const { container } = render(<Field />);

    fireEvent.change(input(container), { target: { files: [pngFile("a.png")] } });
    await act(async () => gates[0]!.resolve({ ok: true, result: { ...RESULT, id: "first-id", path: "/uploads/team-photo/2026/first-id-a.png" } }));
    fireEvent.change(input(container), { target: { files: [pngFile("b.png")] } });
    await act(async () => gates[1]!.resolve({ ok: true, result: { ...RESULT, id: "second-id", path: "/uploads/team-photo/2026/second-id-b.png" } }));
    await waitFor(() => expect(api.count("DELETE /api/admin/uploads/first-id")).toBe(1)); // a replaced, never-saved file
    expect(api.calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
  });

  test("a file that came with the form (already saved) is never deleted from here", async () => {
    const api = stubApi({ "GET /api/config": respond({}) });
    const gates = stubUploader();
    const { container } = render(<Field initial="/uploads/team-photo/2026/saved-id-lama.png" />);
    fireEvent.change(input(container), { target: { files: [pngFile("baru.png")] } });
    await act(async () => gates[0]!.resolve({ ok: true, result: { ...RESULT, id: "new-id", path: "/uploads/team-photo/2026/new-id-baru.png" } }));
    fireEvent.click(screen.getByRole("button", { name: "Hapus" }));
    await waitFor(() => expect(api.calls.filter((call) => call.method === "DELETE")).toHaveLength(1)); // only the new one, removed again
    expect(api.calls.find((call) => call.method === "DELETE")!.url).toBe("/api/admin/uploads/new-id");
  });

  test("'Hapus' empties the field", async () => {
    stubApi({ "GET /api/config": respond({}) });
    const onValue = vi.fn();
    render(<Field initial="/uploads/team-photo/2026/saved-id-lama.png" onValue={onValue} />);
    fireEvent.click(screen.getByRole("button", { name: "Hapus" }));
    expect(onValue).toHaveBeenCalledWith(null);
    expect(screen.getByRole("button", { name: "Pilih file" })).toBeTruthy();
  });

  test("an image shows its preview from the public files domain, with a text alternative; a broken one shows a placeholder", async () => {
    stubApi({ "GET /api/config": respond({ uploadsBaseUrl: "https://files.example.org" }) });
    render(<Field initial="/uploads/team-photo/2026/saved-id-lama.png" />);
    const img = await screen.findByRole("img", { name: "Pratinjau Foto" });
    await waitFor(() => expect(img.getAttribute("src")).toBe("https://files.example.org/uploads/team-photo/2026/saved-id-lama.png"));
    fireEvent.error(img);
    expect(await screen.findByRole("img", { name: "Pratinjau tidak tersedia" })).toBeTruthy();
  });

  test("a legacy static path is shown as it is", () => {
    stubApi({ "GET /api/config": respond({ uploadsBaseUrl: "https://files.example.org" }) });
    render(<Field initial="/images/team/ayu.jpg" />);
    expect(screen.getByRole("img", { name: "Pratinjau Foto" }).getAttribute("src")).toBe("/images/team/ayu.jpg");
  });

  test("a PDF kind shows the file name as a link that opens in a new tab, safely", async () => {
    stubApi({ "GET /api/config": respond({ uploadsBaseUrl: "https://files.example.org" }) });
    render(<Field kind="report" initial={`/uploads/report/2026/${RESULT.id}-laporan-tahunan.pdf`} />);
    const link = await screen.findByRole("link", { name: "laporan-tahunan.pdf" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    await waitFor(() => expect(link.getAttribute("href")).toBe(`https://files.example.org/uploads/report/2026/${RESULT.id}-laporan-tahunan.pdf`));
    expect(screen.queryByRole("img")).toBeNull();
  });

  test("the form's own error (from the Worker's `fields`) describes the group", () => {
    stubApi({ "GET /api/config": respond({}) });
    render(<Field error="Berkas tidak valid. Unggah ulang berkasnya." />);
    const group = screen.getByRole("group", { name: /Foto/ });
    expect(document.getElementById(group.getAttribute("aria-describedby")!)!.textContent).toBe("Berkas tidak valid. Unggah ulang berkasnya.");
  });

  test("disabled (a role that cannot write) has no buttons at all, only what is there", () => {
    stubApi({ "GET /api/config": respond({}) });
    const { container } = render(<Field disabled initial="/uploads/team-photo/2026/saved-id-lama.png" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(input(container).disabled).toBe(true);
    expect(screen.getByRole("img", { name: "Pratinjau Foto" })).toBeTruthy();
  });

  test("an image just uploaded is previewed from the file itself, and the preview is let go when it is replaced", async () => {
    stubApi({ "GET /api/config": respond({}) });
    const create = vi.fn(() => "blob:preview-1");
    const revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const gates = stubUploader();
    const { container } = render(<Field />);
    fireEvent.change(input(container), { target: { files: [pngFile("a.png")] } });
    await act(async () => gates[0]!.resolve({ ok: true, result: { ...RESULT, id: "id-a", path: "/uploads/team-photo/2026/id-a-a.png" } }));
    expect(screen.getByRole("img", { name: "Pratinjau Foto" }).getAttribute("src")).toBe("blob:preview-1");
    fireEvent.click(screen.getByRole("button", { name: "Hapus" }));
    expect(revoke).toHaveBeenCalledWith("blob:preview-1");
  });
});
