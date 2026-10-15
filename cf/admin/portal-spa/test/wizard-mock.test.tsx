import { api, setTransport } from "@shared/spa/api";
import { afterEach, describe, expect, test } from "vitest";
import { validateStep } from "../../shared/application-form/rules";
import { missingFilesMessage, SLOT_IDS, type SlotId } from "../../shared/application-form/slots";
import { STEP_IDS, type StepId } from "../../shared/application-form/steps";
import { removeFile, setFileUploader, uploadFile } from "../src/lib/files/client";
import { parseUploadResponse } from "../src/lib/files/types";
import { CURRENT_PATH, parseCurrent, parseStepSaved, parseSubmitted, stepPath, SUBMIT_PATH } from "../src/lib/wizard/api";
import { PERSONAS, type Persona } from "../src/mock/persona";
import { createMockTransport } from "../src/mock/transport";
import { ANSWERS } from "./wizard-helpers";

// The mock that `pnpm dev:portal-spa:mock` serves is held to the contract the wizard reads: its answers go through the wizard's
// own parsers, and it checks a step with the shared module's real rules, so a screen worked on against it behaves as it will
// against the Worker. (The Worker's side of the same contract is test/portal-applications-*.test.ts.)

afterEach(() => {
  setTransport(null);
  setFileUploader(null);
});

function mock(persona: Persona = "open", signedIn = true) {
  setTransport(createMockTransport({ persona, delayMs: 0, session: { get: () => signedIn, set: () => undefined } }));
}

const VALID: Record<StepId, Record<string, unknown>> = {
  identity: { fullName: "Sari Dewi", nickname: "Sari", gender: "perempuan", religion: "Islam", schoolName: "SMAN 1 Contoh", branch: "Bandung", homeAddress: "Jl. Contoh", graduationBatch: "2027 (Kelas 12)", whatsapp: "6281200000001" },
  household: { livingWith: ["Ayah"], fatherName: "Bapak Contoh", fatherOccupation: "Petani", fatherIncome: "1.200.000", motherName: "Ibu Contoh", motherOccupation: "Petani", motherIncome: "0", hasOtherEarner1: false, hasOtherEarner2: false, familySize: "4" },
  housing: { residenceStatus: "Rumah Pribadi", buildingArea: "60", motorcycles: "0", cars: "0", hasDebt: false },
  organizations: { hasOrganizations: false, entries: [] },
  documents: { dtksRegistered: "tidak" },
  marketing: { instagramUsername: "sari_contoh" },
  interview: Object.fromEntries([...["motivationHigherEducation", "motivationSakem", "consistencyPlan", "attendanceCommitment", "parentResponse", "ifParentChangesMind"].map((key) => [key, ANSWERS.interview]), ["agreedToSignedStatement", "ya"]]),
};
const put = (step: StepId, body: unknown) => api<unknown>(stepPath(step), { method: "PUT", json: body });
const file = (type = "application/pdf") => new File(["isi"], "berkas", { type });
const send = (slot: SlotId, type?: string, replace?: string) => uploadFile({ slot, body: file(type), replace });
const REQUIRED: SlotId[] = SLOT_IDS.filter((slot) => !["father-income", "mother-income", "other-earner-1-income", "other-earner-2-income", "debt-proof", "dtks"].includes(slot));

describe("GET applications/current, for each persona, as the wizard parses it", () => {
  test.each([
    ["open", "open"],
    ["no-batch", "no_open_batch"],
    ["draft", "open"],
    ["submitted", "submitted"],
    ["published-accepted", "no_open_batch"],
    ["published-rejected", "no_open_batch"],
    ["published-undecided", "no_open_batch"],
    ["unverified", "open"],
  ] as const)("%s: the gate is %s", async (persona, gate) => {
    mock(persona);
    const result = await api<unknown>(CURRENT_PATH);
    expect(result.ok).toBe(true);
    const parsed = result.ok ? parseCurrent(result.data) : null;
    expect(parsed?.gate).toBe(gate);
    expect(parsed?.batch === null).toBe(gate === "no_open_batch");
  });

  test("the draft persona has a draft on the server: two saved steps, a file, and what is still missing", async () => {
    mock("draft");
    const result = await api<unknown>(CURRENT_PATH);
    const parsed = result.ok ? parseCurrent(result.data) : null;
    expect(parsed?.draft).toMatchObject({ lastStep: "household", saved: ["identity", "household"] });
    expect(parsed?.files).toHaveLength(1);
    expect(parsed?.draft?.missingFiles).not.toContain("family-card");
    expect(parsed?.draft?.missingFiles).toContain("self-photo");
    // What is stored is what the rules store.
    expect(validateStep("identity", parsed?.draft?.steps.identity).ok).toBe(true);
  });

  test("the keys of the answer are the contract's (portal-api.md, 5.1), no more and no fewer", async () => {
    mock("draft");
    const result = await api<Record<string, unknown>>(CURRENT_PATH);
    if (!result.ok) throw new Error("no answer");
    expect(Object.keys(result.data).sort()).toEqual(["application", "batch", "draft", "files", "gate", "now", "user"]);
    expect(Object.keys(result.data.draft as object).sort()).toEqual(["id", "lastStep", "missingFiles", "saved", "steps", "updatedAt"]);
    expect(Object.keys((result.data.files as object[])[0] as object).sort()).toEqual(["contentType", "height", "id", "size", "slot", "uploadedAt", "width"]);
  });

  test("the guards of every student route: no session is 401, an admin account is 403, the 'error' persona is a fault", async () => {
    mock("open", false);
    expect(await api(CURRENT_PATH)).toMatchObject({ ok: false, status: 401 });
    mock("admin-account");
    expect(await api(CURRENT_PATH)).toMatchObject({ ok: false, status: 403, code: "student_only" });
    mock("error");
    expect(await api(CURRENT_PATH)).toMatchObject({ ok: false, status: 500 });
  });

  test("every persona has an answer (a persona added to the list without one fails here)", async () => {
    for (const persona of PERSONAS) {
      mock(persona);
      const result = await api(CURRENT_PATH);
      expect(result.ok || [403, 500].includes(result.status), persona).toBe(true);
    }
  });
});

describe("saving a step: the real rules decide", () => {
  test("an invalid bucket is a 400 with the fields the shared module names, and nothing is saved", async () => {
    mock();
    const result = await put("identity", { ...VALID.identity, nickname: "", whatsapp: "081" });
    const expected = validateStep("identity", { ...VALID.identity, nickname: "", whatsapp: "081" });
    expect(result).toMatchObject({ ok: false, status: 400, code: "invalid", message: "Periksa kembali isian formulir." });
    expect(!result.ok && result.fields).toEqual(!expected.ok && expected.fields);
    const current = await api<unknown>(CURRENT_PATH);
    expect(current.ok && parseCurrent(current.data)?.draft).toBeNull();
  });

  test("a valid bucket is saved as the rules store it, and the answer parses", async () => {
    mock();
    const result = await put("identity", { ...VALID.identity, whatsapp: "62 812 0000 0001", schoolName: "  SMAN 1 Contoh  " });
    const saved = result.ok ? parseStepSaved(result.data) : null;
    expect(saved).toMatchObject({ step: "identity", draft: { saved: ["identity"] }, removedSlots: [] });
    const current = await api<unknown>(CURRENT_PATH);
    expect(current.ok && parseCurrent(current.data)?.draft?.steps.identity).toMatchObject({ whatsapp: "6281200000001", schoolName: "SMAN 1 Contoh" });
  });

  test("the draft lists the buckets in the order of the seven, whatever order they were saved in", async () => {
    mock();
    for (const step of ["interview", "identity", "housing"] as const) await put(step, VALID[step]);
    const current = await api<unknown>(CURRENT_PATH);
    const draft = current.ok ? parseCurrent(current.data)?.draft : null;
    expect(draft?.saved).toEqual(["identity", "housing", "interview"]);
    // ...and the resume point is the one saved last.
    expect(draft?.lastStep).toBe("housing");
  });

  test("an unknown step is a 404", async () => {
    mock();
    expect(await api(`${CURRENT_PATH}/steps/other`, { method: "PUT", json: {} })).toMatchObject({ ok: false, status: 404, code: "unknown_step" });
  });

  test("'tidak' to DTKS removes the SKTM file along with the save, and says so", async () => {
    mock();
    const sent = await send("dtks");
    expect(sent.ok).toBe(true);
    const result = await put("documents", { dtksRegistered: "tidak" });
    expect(result.ok && parseStepSaved(result.data)?.removedSlots).toEqual(["dtks"]);
    const current = await api<unknown>(CURRENT_PATH);
    expect(current.ok && parseCurrent(current.data)?.files).toEqual([]);
  });

  test("the words that make the refusals a form cannot be made to produce (the Nama Panggilan of the Identitas step)", async () => {
    mock();
    await expect(put("identity", { ...VALID.identity, nickname: "offline" })).resolves.toMatchObject({ ok: false, status: 0 });
    expect(await put("identity", { ...VALID.identity, nickname: "dibatasi" })).toMatchObject({ ok: false, status: 429, retryAfter: 60 });
    expect(await put("identity", { ...VALID.identity, nickname: "kedaluwarsa" })).toMatchObject({ ok: false, status: 401 });
    expect(await put("identity", { ...VALID.identity, nickname: "ditutup" })).toMatchObject({ ok: false, status: 409, code: "batch_closed" });
  });

  test("the gate: no batch and an application already sent refuse a save with the contract's 409", async () => {
    mock("no-batch");
    expect(await put("identity", VALID.identity)).toMatchObject({ ok: false, status: 409, code: "no_open_batch" });
    mock("submitted");
    expect(await put("identity", VALID.identity)).toMatchObject({ ok: false, status: 409, code: "already_submitted" });
  });

  test("an address that is not verified is refused with the Worker's sentence", async () => {
    mock("unverified");
    expect(await put("identity", VALID.identity)).toMatchObject({ ok: false, status: 403, code: "email_not_verified" });
  });
});

describe("files", () => {
  test("an upload answers what the field parses, fills the slot, and a full slot is a 409 'slot_full'", async () => {
    mock();
    const first = await send("family-card");
    expect(first.ok && parseUploadResponse(first.response)).toBeTruthy();
    expect(first.ok && first.response.usage).toMatchObject({ slotCount: 1, slotMax: 2 });
    await send("family-card");
    const third = await send("family-card");
    expect(third).toMatchObject({ ok: false, status: 409, code: "slot_full" });
  });

  test("replacing swaps the file; removing it works, and removing it twice is still fine", async () => {
    mock();
    const first = await send("self-photo", "image/jpeg");
    if (!first.ok) throw new Error("upload");
    const replaced = await send("self-photo", "image/png", first.response.file.id);
    expect(replaced.ok && replaced.response.file.contentType).toBe("image/png");
    const current = await api<unknown>(CURRENT_PATH);
    expect(current.ok && parseCurrent(current.data)?.files.map((stored) => stored.id)).toEqual([replaced.ok ? replaced.response.file.id : "?"]);
    if (!replaced.ok) throw new Error("replace");
    expect(await removeFile(replaced.response.file.id)).toEqual({ ok: true });
    expect(await removeFile(replaced.response.file.id)).toEqual({ ok: true });
  });

  test("a file the browser says is something else is stored as a PDF (the mock keeps no bytes, it only answers)", async () => {
    mock();
    const sent = await send("family-card", "text/plain");
    expect(sent.ok && sent.response.file.contentType).toBe("application/pdf");
  });
});

describe("the send", () => {
  const post = () => api<unknown>(SUBMIT_PATH, { method: "POST", json: {} });
  async function saveEverything() {
    for (const step of STEP_IDS) await put(step, VALID[step]);
  }
  async function uploadRequired() {
    for (const slot of REQUIRED) await send(slot, slot === "self-photo" ? "image/jpeg" : "application/pdf");
  }

  test("with nothing saved: 404 'no_draft'", async () => {
    mock();
    expect(await post()).toMatchObject({ ok: false, status: 404, code: "no_draft" });
  });

  test("a bucket never saved is 422 with the legacy 'belum lengkap' sentence", async () => {
    mock();
    await put("identity", VALID.identity);
    expect(await post()).toMatchObject({ ok: false, status: 422, code: "incomplete", message: "Isian keluarga belum lengkap." });
  });

  test("every bucket saved and a document missing: 422 with the sentence that names them", async () => {
    mock();
    await saveEverything();
    const result = await post();
    expect(result).toMatchObject({ ok: false, status: 422, code: "incomplete" });
    expect(!result.ok && result.message).toBe(missingFilesMessage(REQUIRED));
  });

  test("everything there: 201, the answer parses, the gate is 'submitted' after it, and a second send or a save is 409", async () => {
    mock();
    await saveEverything();
    await uploadRequired();
    const result = await post();
    expect(result.ok && parseSubmitted(result.data)).toMatchObject({ applicationId: expect.any(String) });
    const current = await api<unknown>(CURRENT_PATH);
    expect(current.ok && parseCurrent(current.data)).toMatchObject({ gate: "submitted", draft: null });
    expect(await post()).toMatchObject({ ok: false, status: 409, code: "already_submitted" });
    expect(await put("identity", VALID.identity)).toMatchObject({ ok: false, status: 409, code: "already_submitted" });
  });

  test("the words that make the refusals of the send: 'kembar' (the same number a moment ago) and 'berubah' (the draft changed)", async () => {
    mock();
    await saveEverything();
    await uploadRequired();
    await put("identity", { ...VALID.identity, nickname: "kembar" });
    expect(await post()).toMatchObject({ ok: false, status: 409, code: "duplicate_whatsapp" });
    await put("identity", { ...VALID.identity, nickname: "berubah" });
    expect(await post()).toMatchObject({ ok: false, status: 409, code: "draft_changed" });
  });

  test("an address that is not verified gets the shorter sentence", async () => {
    mock("unverified");
    expect(await post()).toMatchObject({ ok: false, status: 403, code: "email_not_verified", message: "Verifikasi email kamu dulu sebelum mengirim pendaftaran." });
  });
});
