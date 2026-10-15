import { setTransport } from "@shared/spa/api";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { expect, vi } from "vitest";
import { localDraftKey } from "../../shared/application-form/draft";
import { type StepId, type UiStepId, UI_STEP_ORDER } from "../../shared/application-form/steps";
import { setFileUploader } from "~/lib/files/client";
import { ENDPOINTS } from "~/lib/paths";
import { CURRENT_PATH } from "~/lib/wizard/api";
import { createMockApplications, type MockApplications } from "~/mock/applications";
import type { Persona } from "~/mock/persona";
import { type Call, meBody, openBatch, renderApp, respond } from "./helpers";

// Helpers of the wizard's tests (SAKEM-083, P3). Everything invented: no real name, number or address anywhere.

export const BATCH = openBatch();

/** The body of `GET applications/current`, as the Worker builds it. */
export function currentBody(over: Record<string, unknown> = {}) {
  return {
    now: "2026-10-13T03:00:00.000Z",
    gate: "open",
    batch: BATCH,
    application: null,
    user: { name: "Sari Dewi", email: "sari@contoh.test" },
    draft: null,
    files: [],
    ...over,
  };
}

export const ROUTES = {
  me: `GET ${ENDPOINTS.me}`,
  current: `GET ${CURRENT_PATH}`,
  config: `GET ${ENDPOINTS.config}`,
  step: (step: string) => `PUT ${CURRENT_PATH}/steps/${step}`,
  submit: `POST ${CURRENT_PATH}/submit`,
};

/** A fixed answer, or a function that answers (or returns `null` to let the mock's own route answer). */
export type Handler =Response | ((call: Call) => Response | null | Promise<Response | null>);

/**
 * A stand-in Worker made of the mock's own wizard routes (the REAL rules of the shared module decide what is valid), with
 * the shell's two calls added, and any route a test wants to answer differently listed in `over` (keyed "METHOD /path").
 */
export function wizardServer(persona: Persona = "open", over: Record<string, Handler> = {}, options: { config?: Record<string, unknown> } = {}) {
  const apps: MockApplications = createMockApplications(persona, () => null, () => new Date("2026-10-13T03:00:00.000Z"), { uploadDelayMs: 0 });
  const calls: Call[] = [];
  const transport = vi.fn(async (path: string, init: RequestInit) => {
    const url = new URL(path, "http://test.invalid");
    const method = (init.method ?? "GET").toUpperCase();
    const call: Call = {
      method,
      path: url.pathname,
      url: path,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
    };
    calls.push(call);
    const route = `${method} ${url.pathname}`;
    const handler = over[route];
    if (handler) {
      const answer = typeof handler === "function" ? await handler(call) : handler.clone();
      if (answer) return answer;
    }
    if (route === ROUTES.me) return respond(meBody());
    if (route === ROUTES.config) return respond({ google: false, turnstileSiteKey: null, siteUrl: "", adminUrl: "", ...options.config });
    return apps.handle(method, url.pathname, init) ?? respond({ error: "not_found" }, 404);
  });
  setTransport(transport);
  const writes = () => calls.filter((call) => call.method !== "GET");
  return { calls, apps, writes, count: (route: string) => calls.filter((call) => `${call.method} ${call.path}` === route).length, last: (route: string) => calls.filter((call) => `${call.method} ${call.path}` === route).at(-1) };
}

export function resetWizardMocks() {
  setFileUploader(null);
}

// ─── What a student types, in the words of the form

/** A complete, valid set of answers, invented. */
export const ANSWERS = {
  identity: { fullName: "Sari Dewi", nickname: "Sari", whatsapp: "6281200000001", schoolName: "SMAN 1 Contoh", homeAddress: "Jl. Contoh No. 1, Kota Contoh" },
  household: { fatherName: "Bapak Contoh", motherName: "Ibu Contoh", fatherIncome: "1.200.000", motherIncome: "500.000" },
  interview: "Saya ingin kuliah supaya bisa membantu keluarga dan desa saya.",
  instagram: "sari_contoh",
};

export function setText(name: string | RegExp, value: string) {
  fireEvent.change(screen.getByRole("textbox", { name }), { target: { value } });
}

export async function choose(user: UserEvent, group: string | RegExp, option: string) {
  await user.click(within(screen.getByRole("group", { name: group })).getByRole("radio", { name: option }));
}

export const next = (user: UserEvent) => user.click(screen.getByRole("button", { name: "Selanjutnya" }));

export async function fillIdentity(user: UserEvent, over: Partial<typeof ANSWERS.identity> = {}) {
  const a = { ...ANSWERS.identity, ...over };
  setText("Nama Lengkap", a.fullName);
  setText("Nama Panggilan", a.nickname);
  await choose(user, "Jenis Kelamin", "Perempuan");
  await choose(user, "Agama", "Islam");
  setText("Asal Sekolah", a.schoolName);
  await choose(user, "Cabang Sakola Kembara", "Bandung");
  setText(/Alamat Rumah/, a.homeAddress);
  await choose(user, "Tahun Angkatan Kelulusan", "2027 (Kelas 12)");
  setText("Nomor WhatsApp Pribadi", a.whatsapp);
}

export async function fillHousehold(user: UserEvent) {
  await user.click(screen.getByRole("checkbox", { name: "Ayah" }));
  await user.click(screen.getByRole("checkbox", { name: "Ibu" }));
  setText(/Nama Ayah/, ANSWERS.household.fatherName);
  await choose(user, "Pekerjaan Ayah", "Petani");
  setText("Penghasilan Ayah per Bulan", ANSWERS.household.fatherIncome);
  setText(/Nama Ibu/, ANSWERS.household.motherName);
  await choose(user, "Pekerjaan Ibu", "Ibu rumah tangga");
  setText("Penghasilan Ibu per Bulan", ANSWERS.household.motherIncome);
  await user.selectOptions(screen.getByRole("combobox", { name: /Jumlah Anggota Keluarga/ }), "4");
}

export async function fillHousing(user: UserEvent) {
  await choose(user, "Status Tempat Tinggal", "Rumah Pribadi");
  setText("Luas Bangunan Tempat Tinggal", "60");
}

export async function fillInterview(user: UserEvent) {
  for (const name of [
    /Ceritakan alasanmu ingin melanjutkan/,
    /Mengapa kamu tertarik menjadi bagian/,
    /Sakola Kembara berlangsung setiap akhir pekan/,
    /Sebagai bentuk komitmen/,
    /Apa tanggapan orang tuamu/,
    /Apakah orang tuamu sudah tahu/,
  ]) {
    setText(name, ANSWERS.interview);
  }
  await choose(user, /Jika diterima, apakah kamu benar-benar siap/, "Ya, saya siap");
}

/** The field of a document slot. */
export const slotGroup = (label: string) => screen.getByRole("group", { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) });

/**
 * Picks a file for a slot, and (unless the Worker is made to refuse it: `{ expectStored: false }`) waits until it is listed.
 * It sends the event a browser sends when a file is picked (the field only reads `event.target.files`); user.upload is far slower.
 */
export async function upload(_user: UserEvent, label: string, name = "berkas.pdf", type = "application/pdf", options: { expectStored?: boolean } = {}) {
  const group = slotGroup(label);
  const listed = () => within(group).queryAllByText(/^Berkas \d+$/).length;
  const before = listed();
  const input = group.querySelector('input[type="file"]') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [new File(["isi berkas"], name, { type })] } });
  });
  if (options.expectStored === false) return;
  await waitFor(() => expect(listed()).toBe(before + 1));
  // The page holds "Selanjutnya" until the field says the file is over (it does, a moment after the file is listed).
  await waitFor(() => expect(screen.getByRole("button", { name: "Selanjutnya" })).toHaveProperty("disabled", false));
}

// ─── Opening the wizard on a screen, the way a returning student would: from the copy in the browser

export const LOCAL_KEY = localDraftKey("user-1", BATCH.id);

/** Leaves the copy a student who was on `screen` would have left in the browser (`values` are what they had typed). */
export function seedLocal(screenId: UiStepId, values: Partial<Record<StepId, Record<string, unknown>>> = {}, savedAt = Date.now()) {
  const stepIndex = UI_STEP_ORDER.indexOf(screenId);
  window.localStorage.setItem(LOCAL_KEY, JSON.stringify({ version: 1, savedAt, stepIndex, visited: UI_STEP_ORDER.slice(0, stepIndex + 1), values }));
}

/** The wizard, open on `screenId`. */
export function openAt(screenId: UiStepId, values: Partial<Record<StepId, Record<string, unknown>>> = {}) {
  seedLocal(screenId, values);
  return renderApp("/portal/daftar");
}

/** The copy in the browser, as it is now. */
export const localCopy = () =>
  JSON.parse(window.localStorage.getItem(LOCAL_KEY) ?? "null") as { savedAt: number; stepIndex: number; visited: string[]; values: Record<string, Record<string, unknown>> } | null;

/** The lines of the summary of what needs fixing: the alert box that took focus. */
export const summaryLines = () =>
  screen
    .getAllByRole("alert")
    .flatMap((box) => within(box).queryAllByRole("listitem"))
    .map((item) => item.textContent ?? "");

/** The required documents and proofs, one file each. */
export const REQUIRED_DOCUMENTS = ["Tagihan/Token Listrik 3 Bulan Terakhir", "Scan Kartu Keluarga", "Surat Izin Orang Tua (bermaterai)", "Foto Diri", "Foto Rumah: depan, ruang tamu, kamar mandi", "Foto Kendaraan yang ada di rumah"];
export const REQUIRED_PROOFS = ["Bukti Follow Instagram @sakolakembara", "Bukti Share Poster + Broadcast ke 3 Grup WhatsApp", "Bukti Upload Twibbon di Feed Instagram", "Bukti Share Poster di Story Instagram"];

// ─── A whole run

const headingOf = (name: string) => screen.findByRole("heading", { name });

export async function uploadEverything(u: UserEvent) {
  await u.click(within(screen.getByRole("group", { name: /Apakah kamu terdaftar dalam DTKS/ })).getByRole("radio", { name: "Tidak terdaftar" }));
  setText(/Username Instagram/, ANSWERS.instagram);
  for (const label of REQUIRED_DOCUMENTS) await upload(u, label, label.startsWith("Foto") ? "foto.jpg" : "berkas.pdf", label.startsWith("Foto") ? "image/jpeg" : "application/pdf");
  for (const label of REQUIRED_PROOFS) await upload(u, label, "bukti.png", "image/png");
}

/** The student goes through every screen as a student would, up to the review. */
export async function fillAllTheWay(u: UserEvent) {
  await headingOf("Sebelum Mulai Pendaftaran");
  await next(u);
  await headingOf("Identitas Pribadi");
  await fillIdentity(u);
  await next(u);
  await headingOf("Keluarga & Ekonomi");
  await fillHousehold(u);
  await next(u);
  await headingOf("Tempat Tinggal & Hutang");
  await fillHousing(u);
  await next(u);
  await headingOf("Organisasi");
  await next(u);
  await headingOf("Interview Tertulis");
  await fillInterview(u);
  await next(u);
  await headingOf("Berkas Pendaftaran");
  await uploadEverything(u);
  await next(u);
  await headingOf("Tinjau & Kirim");
}
