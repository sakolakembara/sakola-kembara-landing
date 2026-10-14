import { setTransport } from "@shared/spa/api";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { FileSlotField, type FileSlotChange } from "~/components/FileSlotField";
import { type FileUploader, type FileUploadOutcome, type FileUploadRequest, setFileUploader } from "~/lib/files/client";
import type { StoredFile } from "~/lib/files/types";
import { deferred, respond } from "./helpers";
import { choose, openAt, resetWizardMocks, slotGroup, wizardServer } from "./wizard-helpers";

// A file on its way (SAKEM-083, P3 asks P4's field to say so): the field reports `onBusyChange(true)` when an upload or a delete
// starts and `(false)` when it has ended however it ended, and the wizard holds every button that moves between screens (and
// the send) until then, and says so. Otherwise "Selanjutnya" pressed mid-upload asks for a document that is not stored yet.

vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => void wizardServer());
afterEach(resetWizardMocks);

const stored = (id: string, slot: StoredFile["slot"] = "family-card"): StoredFile => ({ id, slot, contentType: "application/pdf", size: 1000, width: null, height: null, uploadedAt: "2026-10-13T03:30:00.000Z" });
const outcomeOk = (file: StoredFile): FileUploadOutcome => ({
  ok: true,
  response: { file, usage: { slotCount: 1, slotMax: 2, applicationFiles: 1, applicationBytes: file.size }, draft: { id: "d1", missingFiles: [] } },
});
const pick = (input: HTMLInputElement, ...files: File[]) => fireEvent.change(input, { target: { files } });
const pdf = (name = "berkas.pdf") => new File(["isi"], name, { type: "application/pdf" });

/** The field with a list the way the wizard keeps it, and a spy on `onBusyChange`. */
function Harness({ spy, initial = [] }: { spy: (busy: boolean) => void; initial?: StoredFile[] }) {
  const [files, setFiles] = useState(initial);
  const apply = (change: FileSlotChange) =>
    setFiles((prev) => (change.kind === "added" ? [...prev, change.file] : change.kind === "replaced" ? prev.map((file) => (file.id === change.removedId ? change.file : file)) : prev.filter((file) => file.id !== change.fileId)));
  return <FileSlotField slot="family-card" files={files} onChange={apply} onBusyChange={spy} />;
}
const fileInput = (container: HTMLElement) => container.querySelector('input[type="file"]') as HTMLInputElement;

describe("FileSlotField: onBusyChange", () => {
  test("an upload that is stored: true when it starts, false when it is over, once each", async () => {
    const spy = vi.fn();
    const held = deferred<FileUploadOutcome>();
    setFileUploader(() => held.promise);
    const { container } = render(<Harness spy={spy} />);
    expect(spy).not.toHaveBeenCalled();
    pick(fileInput(container), pdf());
    await waitFor(() => expect(spy.mock.calls).toEqual([[true]]));
    await act(async () => held.resolve(outcomeOk(stored("f1"))));
    await waitFor(() => expect(spy.mock.calls).toEqual([[true], [false]]));
    expect(await screen.findByText("Berkas 1")).toBeTruthy();
  });

  test("an upload the Worker refuses ends it too", async () => {
    const spy = vi.fn();
    setFileUploader(async () => ({ ok: false, status: 413, message: "Ukuran file maksimal 10 MB.", code: "too_large" }));
    const { container } = render(<Harness spy={spy} />);
    pick(fileInput(container), pdf());
    await waitFor(() => expect(spy.mock.calls).toEqual([[true], [false]]));
    expect((await screen.findAllByText("Ukuran file maksimal 10 MB.")).length).toBeGreaterThan(0);
  });

  test("an upload cancelled with 'Batal' ends it", async () => {
    const u = userEvent.setup({ delay: null });
    const spy = vi.fn();
    setFileUploader(({ signal }: FileUploadRequest) => new Promise((resolve) => signal?.addEventListener("abort", () => resolve({ ok: false, status: 0, message: "Unggahan dibatalkan.", code: "aborted" }))));
    const { container } = render(<Harness spy={spy} />);
    pick(fileInput(container), pdf());
    await waitFor(() => expect(spy.mock.calls).toEqual([[true]]));
    await u.click(screen.getByRole("button", { name: "Batal" }));
    await waitFor(() => expect(spy.mock.calls).toEqual([[true], [false]]));
  });

  test("two files picked together are one stretch of busy, not two", async () => {
    const spy = vi.fn();
    let count = 0;
    setFileUploader(async () => outcomeOk(stored(`f${++count}`)));
    const { container } = render(<Harness spy={spy} />);
    pick(fileInput(container), pdf("a.pdf"), pdf("b.pdf"));
    await waitFor(() => expect(screen.getByText("Berkas 2")).toBeTruthy());
    await waitFor(() => expect(spy.mock.calls).toEqual([[true], [false]]));
  });

  test("a file refused on the phone, before anything is sent, never makes the field busy", async () => {
    const spy = vi.fn();
    const sent = vi.fn();
    setFileUploader(async (request) => {
      sent(request);
      return outcomeOk(stored("f1"));
    });
    const { container } = render(<Harness spy={spy} />);
    pick(fileInput(container), new File(["x"], "virus.exe", { type: "application/x-msdownload" }));
    expect((await screen.findAllByText(/Tipe file tidak didukung/)).length).toBeGreaterThan(0);
    expect(spy).not.toHaveBeenCalled();
    expect(sent).not.toHaveBeenCalled();
  });

  test("a delete is busy from the confirmation to its end, whether it works or fails", async () => {
    const u = userEvent.setup({ delay: null });
    const spy = vi.fn();
    const held = deferred<Response>();
    let outcome: "held" | "fails" = "held";
    setTransport(async () => (outcome === "held" ? held.promise : respond({ error: "internal" }, 500)));
    render(<Harness spy={spy} initial={[stored("f1"), stored("f2")]} />);
    await u.click(screen.getByRole("button", { name: "Hapus berkas 1 Scan Kartu Keluarga" }));
    await u.click(screen.getByRole("button", { name: "Ya, hapus" }));
    await waitFor(() => expect(spy.mock.calls).toEqual([[true]]));
    await act(async () => held.resolve(new Response(null, { status: 204 })));
    await waitFor(() => expect(spy.mock.calls).toEqual([[true], [false]]));
    expect(screen.getAllByText(/^Berkas \d$/)).toHaveLength(1);

    outcome = "fails";
    await u.click(screen.getByRole("button", { name: "Hapus berkas 1 Scan Kartu Keluarga" }));
    await u.click(screen.getByRole("button", { name: "Ya, hapus" }));
    await waitFor(() => expect(spy.mock.calls).toEqual([[true], [false], [true], [false]]));
  });

  test("a field that goes away in the middle of an upload says it is not busy any more (a slot hidden while it uploads)", async () => {
    const spy = vi.fn();
    setFileUploader(() => new Promise(() => undefined));
    const { container, unmount } = render(<Harness spy={spy} />);
    pick(fileInput(container), pdf());
    await waitFor(() => expect(spy.mock.calls).toEqual([[true]]));
    unmount();
    expect(spy.mock.calls).toEqual([[true], [false]]);
  });

  test("a field that never was busy says nothing when it goes", () => {
    const spy = vi.fn();
    const { unmount } = render(<Harness spy={spy} />);
    unmount();
    expect(spy).not.toHaveBeenCalled();
  });

  test("the latest function is the one called (a page that passes a new one on every render)", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const held = deferred<FileUploadOutcome>();
    setFileUploader(() => held.promise);
    const view = render(<Harness spy={first} />);
    pick(fileInput(view.container), pdf());
    await waitFor(() => expect(first).toHaveBeenCalledWith(true));
    view.rerender(<Harness spy={second} />);
    await act(async () => held.resolve(outcomeOk(stored("f1"))));
    await waitFor(() => expect(second).toHaveBeenCalledWith(false));
    expect(first).toHaveBeenCalledTimes(1);
  });

  test("the prop is optional: a field without it works as before", async () => {
    setFileUploader(async () => outcomeOk(stored("f1")));
    const view = render(<FileSlotField slot="family-card" files={[]} onChange={() => undefined} />);
    pick(fileInput(view.container), pdf());
    await waitFor(() => expect(view.container.querySelector("[role='progressbar']")).toBeNull());
  });
});

describe("the wizard holds its buttons while a file is on its way", () => {
  const user = () => userEvent.setup({ applyAccept: false, delay: null });
  const sebelumnya = () => screen.getByRole("button", { name: "Sebelumnya" }) as HTMLButtonElement;
  const selanjutnya = () => screen.getByRole("button", { name: "Selanjutnya" }) as HTMLButtonElement;
  const list = () => within(within(screen.getByRole("navigation", { name: "Bagian formulir" })).getByRole("list"));
  const status = () => (document.querySelector("main p[role='status'][aria-live='polite']") as HTMLElement).textContent;

  async function startUpload(held: Promise<FileUploadOutcome>, label = "Scan Kartu Keluarga") {
    setFileUploader(() => held);
    const input = slotGroup(label).querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => pick(input, pdf()));
  }

  test("while an upload goes: 'Selanjutnya', 'Sebelumnya' and the list are disabled and the page says why; when it is stored they come back", async () => {
    const api = wizardServer();
    openAt("documents");
    await screen.findByRole("heading", { name: "Berkas Pendaftaran" });
    expect(selanjutnya().disabled).toBe(false);
    expect(status()).toBe("");
    const held = deferred<FileUploadOutcome>();
    await startUpload(held.promise);
    await waitFor(() => expect(selanjutnya().disabled).toBe(true));
    expect(sebelumnya().disabled).toBe(true);
    expect(list().getByRole("button", { name: "Identitas Pribadi" })).toHaveProperty("disabled", true);
    expect(status()).toBe("Tunggu unggahan selesai.");

    // A disabled button sends no click: nothing is saved while the file is on its way.
    fireEvent.click(selanjutnya());
    expect(api.writes()).toEqual([]);
    await act(async () => held.resolve(outcomeOk(stored("f9"))));
    await waitFor(() => expect(selanjutnya().disabled).toBe(false));
    expect(sebelumnya().disabled).toBe(false);
    expect(status()).toBe("");
    expect(within(slotGroup("Scan Kartu Keluarga")).getByText("Berkas 1")).toBeTruthy();
  });

  test("an upload that fails, or is cancelled with 'Batal', gives the buttons back", async () => {
    const u = user();
    openAt("documents");
    await screen.findByRole("heading", { name: "Berkas Pendaftaran" });
    await startUpload(Promise.resolve({ ok: false, status: 413, message: "Ukuran file maksimal 10 MB.", code: "too_large" }));
    await waitFor(() => expect(selanjutnya().disabled).toBe(false));
    expect(status()).toBe("");

    setFileUploader(({ signal }) => new Promise((resolve) => signal?.addEventListener("abort", () => resolve({ ok: false, status: 0, message: "Unggahan dibatalkan.", code: "aborted" }))));
    const input = slotGroup("Foto Diri").querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => pick(input, new File(["x"], "diri.jpg", { type: "image/jpeg" })));
    await waitFor(() => expect(selanjutnya().disabled).toBe(true));
    await u.click(within(slotGroup("Foto Diri")).getByRole("button", { name: "Batal" }));
    await waitFor(() => expect(selanjutnya().disabled).toBe(false));
  });

  test("two slots at once: the buttons come back only when the last one is over", async () => {
    openAt("documents");
    await screen.findByRole("heading", { name: "Berkas Pendaftaran" });
    const first = deferred<FileUploadOutcome>();
    const second = deferred<FileUploadOutcome>();
    await startUpload(first.promise, "Scan Kartu Keluarga");
    await startUpload(second.promise, "Surat Izin Orang Tua (bermaterai)");
    await waitFor(() => expect(selanjutnya().disabled).toBe(true));
    await act(async () => first.resolve(outcomeOk(stored("f1"))));
    await waitFor(() => expect(within(slotGroup("Scan Kartu Keluarga")).getByText("Berkas 1")).toBeTruthy());
    expect(selanjutnya().disabled).toBe(true);
    await act(async () => second.resolve(outcomeOk(stored("f2", "parent-permission"))));
    await waitFor(() => expect(selanjutnya().disabled).toBe(false));
  });

  test("a slot hidden while it uploads (DTKS changed to 'tidak') does not leave the buttons held for good", async () => {
    const u = user();
    openAt("documents");
    await screen.findByRole("heading", { name: "Berkas Pendaftaran" });
    await choose(u, "Apakah kamu terdaftar dalam DTKS?", "Ya, terdaftar");
    await startUpload(new Promise<FileUploadOutcome>(() => undefined), "Surat Keterangan Tidak Mampu (SKTM) terdaftar DTKS");
    await waitFor(() => expect(selanjutnya().disabled).toBe(true));
    await choose(u, "Apakah kamu terdaftar dalam DTKS?", "Tidak terdaftar");
    await waitFor(() => expect(selanjutnya().disabled).toBe(false));
    expect(status()).toBe("");
  });

  test("a delete holds them too", async () => {
    const u = user();
    const held = deferred<Response>();
    const api = wizardServer("draft", { "DELETE /portal/api/applications/current/files/mock-file-1": () => held.promise });
    openAt("documents");
    await screen.findByRole("heading", { name: "Berkas Pendaftaran" });
    expect(api.writes()).toEqual([]);
    await u.click(within(slotGroup("Scan Kartu Keluarga")).getByRole("button", { name: "Hapus berkas 1 Scan Kartu Keluarga" }));
    await u.click(within(slotGroup("Scan Kartu Keluarga")).getByRole("button", { name: "Ya, hapus" }));
    await waitFor(() => expect(selanjutnya().disabled).toBe(true));
    expect(status()).toBe("Tunggu unggahan selesai.");
    await act(async () => held.resolve(new Response(null, { status: 204 })));
    await waitFor(() => expect(selanjutnya().disabled).toBe(false));
    expect(within(slotGroup("Scan Kartu Keluarga")).queryByText("Berkas 1")).toBeNull();
  });

  test("the screens that have no file field never hold anything", async () => {
    openAt("identity");
    await screen.findByRole("heading", { name: "Identitas Pribadi" });
    expect(selanjutnya().disabled).toBe(false);
    expect(status()).toBe("");
  });
});
