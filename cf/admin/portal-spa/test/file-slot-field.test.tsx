import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { FileSlotField, type FileSlotChange, type FileSlotFieldProps } from "~/components/FileSlotField";
import { type FileUploadOutcome, type FileUploadRequest, setFileUploader } from "~/lib/files/client";
import type { StoredFile, UploadResponse } from "~/lib/files/types";
import { deferred, respond, stubApi } from "./helpers";

// The file field of the documents and marketing steps (SAKEM-083, P4): add, replace and remove one slot's files, with
// the uploader and the transport stubbed (the request itself is in files-lib.test.ts, the Worker's side in
// test/private-files-*.test.ts). The wizard (P3) holds the files and applies each `onChange`; these tests hold them in a
// list the same way.

afterEach(() => {
  setFileUploader(null);
  vi.unstubAllGlobals();
});

const stored = (id: string, slot: StoredFile["slot"], over: Partial<StoredFile> = {}): StoredFile => ({
  id,
  slot,
  contentType: "image/jpeg",
  size: 450_000,
  width: 800,
  height: 600,
  uploadedAt: "2026-10-13T03:30:00.000Z",
  ...over,
});

function response(file: StoredFile, count = 1): UploadResponse {
  return { file, usage: { slotCount: count, slotMax: 2, applicationFiles: count, applicationBytes: file.size }, draft: { id: "draft-1", missingFiles: ["self-photo"] } };
}

const fileOf = (name: string, size: number, type: string) => new File([new Uint8Array(size)], name, { type });
const input = (container: HTMLElement) => container.querySelector('input[type="file"]') as HTMLInputElement;
/** The sentence shown under the field (the same words are also read out by the live region, so a text query would find two). */
const shownError = () => document.querySelector('[id$="-error"]')?.textContent ?? null;

/** The field with a list the way the wizard keeps it: every change is applied. */
function setup(props: Partial<FileSlotFieldProps> & { files?: StoredFile[] } = {}) {
  const changes: FileSlotChange[] = [];
  const { files: initial = [], onChange, ...rest } = props;
  const user = userEvent.setup({ applyAccept: false });
  let current = initial;
  const props0 = (): FileSlotFieldProps => ({
    slot: "family-card",
    files: current,
    onChange: (change) => {
      changes.push(change);
      onChange?.(change);
      if (change.kind === "added") current = [...current, change.file];
      else if (change.kind === "removed") current = current.filter((file) => file.id !== change.fileId);
      else current = current.map((file) => (file.id === change.removedId ? change.file : file));
      view.rerender(<FileSlotField {...props0()} />);
    },
    ...rest,
  });
  const view = render(<FileSlotField {...props0()} />);
  return { user, changes, ...view };
}

describe("an empty slot", () => {
  test("the label as the legend, what it takes and how much, one button, and a file input with explicit types", () => {
    const { container } = setup();
    expect(screen.getByRole("group", { name: "Scan Kartu Keluarga" })).toBeTruthy();
    expect(screen.getByText(/PNG, JPEG, WebP, PDF\. Maksimal 10 MB per berkas\. Sampai 2 berkas\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pilih berkas" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Tambah berkas" })).toBeNull();
    const picker = input(container);
    expect(picker.accept).toBe("image/png,image/jpeg,image/webp,application/pdf");
    expect(picker.getAttribute("tabindex")).toBe("-1");
    expect(picker.getAttribute("aria-hidden")).toBe("true");
  });

  test("a slot that takes images only says so and offers only images; a one-file slot has no 'Sampai'", () => {
    const { container } = setup({ slot: "self-photo" });
    expect(screen.getByText("PNG, JPEG, WebP. Maksimal 10 MB per berkas.")).toBeTruthy();
    expect(input(container).accept).toBe("image/png,image/jpeg,image/webp");
  });

  test("the asterisk is the wizard's to ask for, and an outside error is shown as the slot's own", () => {
    setup({ required: true, error: "Berkas wajib belum lengkap: Scan Kartu Keluarga." });
    expect(screen.getByRole("group", { name: /Scan Kartu Keluarga/ }).querySelector("legend span")?.textContent).toBe("*");
    expect(screen.getByText("Berkas wajib belum lengkap: Scan Kartu Keluarga.")).toBeTruthy();
  });
});

describe("the files of a slot", () => {
  const files = [stored("f1", "family-card", { contentType: "application/pdf", size: 812_345, width: null, height: null }), stored("f2", "family-card")];

  test("each is numbered, with its type and size, and a link through the Worker in a new tab: 'Unduh' for a PDF, 'Lihat' for an image", () => {
    setup({ files });
    expect(screen.getByText("Berkas 1")).toBeTruthy();
    expect(screen.getByText("PDF · 812,3 kB")).toBeTruthy();
    expect(screen.getByText("JPEG · 450 kB")).toBeTruthy();
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/portal/api/files/f1", "/portal/api/files/f2"]);
    expect(links.map((link) => link.textContent)).toEqual(["Unduh berkas 1 Scan Kartu Keluarga", "Lihat berkas 2 Scan Kartu Keluarga"]);
    for (const link of links) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  test("nothing is loaded by itself: no picture, no frame, no request", () => {
    const api = stubApi({});
    const { container } = setup({ files });
    expect(container.querySelector("img, iframe, embed, object")).toBeNull();
    expect(api.calls).toEqual([]);
  });

  test("a full slot offers no 'Tambah' and says to replace or remove; one with room offers 'Tambah berkas'", () => {
    const full = setup({ files });
    expect(screen.queryByRole("button", { name: "Tambah berkas" })).toBeNull();
    expect(screen.getByText("Slot ini sudah penuh. Hapus atau ganti satu berkas untuk mengubahnya.")).toBeTruthy();
    full.unmount();
    setup({ files: [files[0]!] });
    expect(screen.getByRole("button", { name: "Tambah berkas" })).toBeTruthy();
    expect(screen.queryByText(/sudah penuh/)).toBeNull();
  });

  test("closed (the batch ended or the application was sent): the list stays, nothing can be added, replaced or removed", () => {
    const { container } = setup({ files, disabled: true });
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(input(container).disabled).toBe(true);
  });
});

describe("adding", () => {
  test("picking a file sends it to the slot, shows progress, and hands the stored file and the draft's missing slots to the wizard", async () => {
    const gate = deferred<FileUploadOutcome>();
    const seen: FileUploadRequest[] = [];
    setFileUploader(async (request) => {
      seen.push(request);
      request.onProgress?.(0.4);
      return gate.promise;
    });
    const { user, container, changes } = setup();
    await user.upload(input(container), fileOf("kk-budi-santoso.pdf", 2000, "application/pdf"));

    const bar = await screen.findByRole("progressbar", { name: "Mengunggah kk-budi-santoso.pdf" });
    expect(bar.getAttribute("aria-valuenow")).toBe("40");
    expect(screen.getByRole("button", { name: "Pilih berkas" })).toHaveProperty("disabled", true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ slot: "family-card", replace: undefined });
    expect(seen[0]!.body.size).toBe(2000);

    const file = stored("new-1", "family-card", { contentType: "application/pdf", size: 2000, width: null, height: null });
    await act(async () => gate.resolve({ ok: true, response: response(file) }));
    await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull());
    expect(changes).toEqual([{ kind: "added", file, response: response(file) }]);
    expect(screen.getByText("Berkas 1")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("kk-budi-santoso.pdf selesai diunggah");
  });

  test("a photo just stored shows a preview from the browser's memory, and lets go of it when it goes away", async () => {
    const created = vi.fn(() => "blob:preview-1");
    const revoked = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked }));
    const file = stored("img-1", "self-photo");
    setFileUploader(async () => ({ ok: true, response: response(file) }));
    const api = stubApi({ "DELETE /portal/api/applications/current/files/img-1": respond(null, 204) });
    const { user, container } = setup({ slot: "self-photo" });
    await user.upload(input(container), fileOf("foto.jpg", 1000, "image/jpeg"));
    const preview = await screen.findByRole("img", { name: "Pratinjau berkas 1 Foto Diri" });
    expect(preview.getAttribute("src")).toBe("blob:preview-1");
    expect(created).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Hapus berkas 1 Foto Diri" }));
    await user.click(screen.getByRole("button", { name: "Ya, hapus" }));
    await waitFor(() => expect(revoked).toHaveBeenCalledWith("blob:preview-1"));
    expect(api.count("DELETE /portal/api/applications/current/files/img-1")).toBe(1);
  });

  test("a file the phone can already tell is wrong is refused with the Worker's words, and nothing is sent", async () => {
    const send = vi.fn();
    setFileUploader(send);
    const { user, container, changes } = setup();
    await user.upload(input(container), fileOf("kk.exe", 100, "application/x-msdownload"));
    await waitFor(() => expect(shownError()).toBe("Tipe file tidak didukung. Gunakan: PNG, JPEG, WebP, PDF."));
    await user.upload(input(container), fileOf("kk.pdf", 10_000_001, "application/pdf"));
    await waitFor(() => expect(shownError()).toBe("Ukuran file maksimal 10 MB."));
    await user.upload(input(container), fileOf("kosong.pdf", 0, "application/pdf"));
    await waitFor(() => expect(shownError()).toBe("File kosong."));
    expect(send).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
  });

  test("the Worker's refusal is its sentence under the field, nothing changes, and the next pick starts clean", async () => {
    let answer: FileUploadOutcome = { ok: false, status: 409, code: "slot_full", message: "Slot ini sudah penuh. Hapus satu berkas dulu atau ganti berkas yang ada." };
    setFileUploader(async () => answer);
    const { user, container, changes } = setup();
    await user.upload(input(container), fileOf("kk.pdf", 100, "application/pdf"));
    await waitFor(() => expect(shownError()).toBe("Slot ini sudah penuh. Hapus satu berkas dulu atau ganti berkas yang ada."));
    expect(changes).toEqual([]);
    expect(screen.queryByRole("progressbar")).toBeNull();

    answer = { ok: true, response: response(stored("ok-1", "family-card")) };
    await user.upload(input(container), fileOf("kk2.pdf", 100, "application/pdf"));
    await waitFor(() => expect(shownError()).toBeNull());
    expect(changes).toHaveLength(1);
  });

  test("an ended session (401) tells the wizard, and says so", async () => {
    const onUnauthorized = vi.fn();
    setFileUploader(async () => ({ ok: false, status: 401, message: "Sesi kamu sudah berakhir. Silakan masuk lagi.", code: "unauthenticated" }));
    const { user, container } = setup({ onUnauthorized });
    await user.upload(input(container), fileOf("kk.pdf", 100, "application/pdf"));
    await waitFor(() => expect(shownError()).toBe("Sesi kamu sudah berakhir. Silakan masuk lagi."));
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  test("'Batal' stops the upload that is going on and says it was cancelled, without an error", async () => {
    let signal: AbortSignal | undefined;
    setFileUploader(
      (request) =>
        new Promise((resolve) => {
          signal = request.signal;
          request.signal?.addEventListener("abort", () => resolve({ ok: false, status: 0, message: "Unggahan dibatalkan.", code: "aborted" }));
        }),
    );
    const { user, container, changes } = setup();
    await user.upload(input(container), fileOf("kk.pdf", 100, "application/pdf"));
    await user.click(await screen.findByRole("button", { name: "Batal" }));
    expect(signal?.aborted).toBe(true);
    await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull());
    expect(screen.getByRole("status").textContent).toBe("Unggahan dibatalkan");
    expect(screen.queryByText("Unggahan dibatalkan.")).toBeNull(); // announced, not shown as an error
    expect(changes).toEqual([]);
  });

  test("several files at once go one after the other, and the first refusal stops the rest", async () => {
    const sent: string[] = [];
    let count = 0;
    setFileUploader(async (request) => {
      sent.push(String(request.body.size));
      count += 1;
      return count === 2 ? { ok: false, status: 503, code: "storage_full", message: "Penyimpanan berkas sedang penuh. Hubungi panitia lewat WhatsApp." } : { ok: true, response: response(stored(`h${count}`, "house-photos")) };
    });
    const { user, container, changes } = setup({ slot: "house-photos" });
    expect(input(container).multiple).toBe(false); // set when the picker is opened, below
    await user.click(screen.getByRole("button", { name: "Pilih berkas" }));
    expect(input(container).multiple).toBe(true);
    await user.upload(input(container), [fileOf("a.jpg", 101, "image/jpeg"), fileOf("b.jpg", 102, "image/jpeg"), fileOf("c.jpg", 103, "image/jpeg")]);
    await waitFor(() => expect(shownError()).toBe("Penyimpanan berkas sedang penuh. Hubungi panitia lewat WhatsApp."));
    expect(sent).toEqual(["101", "102"]); // the third never left
    expect(changes).toHaveLength(1);
  });

  test("more files than the slot has room for: the ones that fit go, the rest are not sent, and the student is told", async () => {
    const sent: number[] = [];
    setFileUploader(async (request) => {
      sent.push(request.body.size);
      return { ok: true, response: response(stored(`s${sent.length}`, "family-card")) };
    });
    const { user, container } = setup(); // room for two
    await user.click(screen.getByRole("button", { name: "Pilih berkas" }));
    expect(input(container).multiple).toBe(true);
    await user.upload(input(container), [fileOf("a.pdf", 10, "application/pdf"), fileOf("b.pdf", 20, "application/pdf"), fileOf("c.pdf", 30, "application/pdf")]);
    await waitFor(() => expect(shownError()).toBe("Slot ini hanya menampung 2 berkas. Sisanya tidak diunggah."));
    expect(sent).toEqual([10, 20]);
  });
});

describe("replacing", () => {
  test("'Ganti' sends the new file with the id of the one it replaces (one file, not several) and swaps them", async () => {
    const seen: FileUploadRequest[] = [];
    const replacement = stored("n1", "family-card", { size: 600_000 });
    setFileUploader(async (request) => {
      seen.push(request);
      return { ok: true, response: response(replacement) };
    });
    const { user, container, changes } = setup({ files: [stored("f1", "family-card"), stored("f2", "family-card")] });
    await user.click(screen.getByRole("button", { name: "Ganti berkas 2 Scan Kartu Keluarga" }));
    expect(input(container).multiple).toBe(false);
    await user.upload(input(container), [fileOf("baru.jpg", 600, "image/jpeg"), fileOf("lain.jpg", 700, "image/jpeg")]);
    await waitFor(() => expect(changes).toHaveLength(1));
    expect(seen).toHaveLength(1); // only the first of the two is taken
    expect(seen[0]).toMatchObject({ slot: "family-card", replace: "f2" });
    expect(changes[0]).toMatchObject({ kind: "replaced", removedId: "f2", file: replacement });
    expect(screen.getAllByText(/Berkas \d/).map((node) => node.textContent)).toEqual(["Berkas 1", "Berkas 2"]);
  });
});

describe("removing", () => {
  test("it asks in place first; 'Batal' changes nothing and sends nothing", async () => {
    const api = stubApi({});
    const { user, changes } = setup({ files: [stored("f1", "family-card")] });
    await user.click(screen.getByRole("button", { name: "Hapus berkas 1 Scan Kartu Keluarga" }));
    const ask = screen.getByRole("group", { name: "Hapus berkas 1 Scan Kartu Keluarga?" });
    expect(within(ask).getByText("Hapus berkas ini?")).toBeTruthy();
    await user.click(within(ask).getByRole("button", { name: "Batal" }));
    expect(screen.queryByRole("group", { name: /Hapus berkas/ })).toBeNull();
    expect(api.calls).toEqual([]);
    expect(changes).toEqual([]);
  });

  test("'Ya, hapus' deletes the file by its id, once however often it is pressed, and tells the wizard", async () => {
    const gate = deferred<Response>();
    const api = stubApi({ "DELETE /portal/api/applications/current/files/f1": () => gate.promise });
    const { user, changes } = setup({ files: [stored("f1", "family-card")] });
    await user.click(screen.getByRole("button", { name: "Hapus berkas 1 Scan Kartu Keluarga" }));
    const confirm = screen.getByRole("button", { name: "Ya, hapus" });
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    expect(api.count("DELETE /portal/api/applications/current/files/f1")).toBe(1);
    await act(async () => gate.resolve(respond(null, 204)));
    await waitFor(() => expect(changes).toEqual([{ kind: "removed", fileId: "f1" }]));
    expect(screen.queryByText("Berkas 1")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Berkas dihapus");
  });

  test("a refusal is its sentence under the field and the file stays; an ended session tells the wizard", async () => {
    const onUnauthorized = vi.fn();
    stubApi({
      "DELETE /portal/api/applications/current/files/f1": respond({ error: "batch_closed", message: "Pendaftaran untuk batch ini sudah ditutup. Isianmu tidak bisa disimpan atau dikirim." }, 409),
      "DELETE /portal/api/applications/current/files/f2": respond({ error: "unauthenticated" }, 401),
    });
    const { user, changes } = setup({ files: [stored("f1", "family-card"), stored("f2", "family-card")], onUnauthorized });
    await user.click(screen.getByRole("button", { name: "Hapus berkas 1 Scan Kartu Keluarga" }));
    await user.click(screen.getByRole("button", { name: "Ya, hapus" }));
    await waitFor(() => expect(shownError()).toBe("Pendaftaran untuk batch ini sudah ditutup. Isianmu tidak bisa disimpan atau dikirim."));
    expect(changes).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Hapus berkas 2 Scan Kartu Keluarga" }));
    await user.click(screen.getByRole("button", { name: "Ya, hapus" }));
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledOnce());
    expect(screen.getByText("Berkas 2")).toBeTruthy();
  });
});
