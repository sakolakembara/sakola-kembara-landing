import { afterEach, describe, expect, test } from "vitest";
import { validateStep } from "../shared/application-form/rules";
import { missingFilesMessage, requiredSlots, SLOTS, type SlotId } from "../shared/application-form/slots";
import { STEP_IDS, type StepId } from "../shared/application-form/steps";
import { setTransport } from "../shared/spa/api";
import { getCurrent, postSubmit, putStep } from "../portal-spa/src/lib/wizard/api";
import { parseWizardConfig } from "../portal-spa/src/lib/wizard/config";
import { REVIEW_INDEX } from "../portal-spa/src/lib/wizard/screens";
import { canon, emptyValues, mergeStart, normalizeBucket, snapshotsOf } from "../portal-spa/src/lib/wizard/values";
import { addFileRow, addRequiredFiles, draftOf, openBatch, student, type Student } from "./portal-applications-helpers";
import { portalCall } from "./portal-helpers";

// The contract with the portal SPA's wizard (docs/cloudflare/portal-api.md, section 16, last bullet): the wizard's own pure files
// (portal-spa/src/lib/wizard: api.ts, values.ts, screens.ts, config.ts: relative imports only, so they run here) run against
// what the real Worker sends, so a key renamed or a rule changed on either side fails here and not on a child's phone. Same idea
// as portal-applications-spa-contract.test.ts for the home and the status page.
//
// Each test makes its own student and its own batch (the suite empties the tables before every test) and reads no clock but the
// batch's own window (a day ago to a month ahead), so nothing here depends on the order the tests run in or on the load of the
// machine; the one limit that counts, the saves per minute of a user, is far from the ten saves a test makes.

/** The wizard's requests, sent to the portal Worker as the signed-in student (or with no session at all). */
function as(who: Pick<Student, "cookie"> | null) {
  setTransport((path, init) => {
    const headers = new Headers(init.headers);
    return portalCall(path, { method: init.method, cookie: who?.cookie, json: init.body ? JSON.parse(String(init.body)) : undefined, headers: Object.fromEntries(headers.entries()) });
  });
}

afterEach(() => setTransport(null));

/** Typed as the form holds them: every count is text. */
const TYPED: Record<StepId, Record<string, unknown>> = {
  identity: { fullName: "Pendaftar Contoh", nickname: "Contoh", gender: "perempuan", religion: "Islam", schoolName: "SMA Contoh Satu", branch: "Cililin", homeAddress: "Jl. Contoh No. 9", graduationBatch: "2027 (Kelas 12)", whatsapp: "6281200012345" },
  household: { livingWith: ["Ayah", "Ibu"], fatherName: "Bapak Contoh", fatherOccupation: "Petani", fatherIncome: "1.200.000", motherName: "Ibu Contoh", motherOccupation: "Ibu rumah tangga", motherIncome: "0", hasOtherEarner1: true, earner1Relation: "Kakak", earner1Income: "500.000", hasOtherEarner2: false, familySize: "4" },
  housing: { residenceStatus: "Rumah Pribadi", buildingArea: "36", motorcycles: "1", cars: "0", hasDebt: true, debtType: "Cicilan", debtAmount: "2.000.000", debtInstallmentMonths: "12", debtDescription: "Cicilan modal usaha" },
  organizations: { hasOrganizations: true, entries: [{ name: "OSIS", position: "Ketua" }] },
  documents: { dtksRegistered: "tidak" },
  marketing: { instagramUsername: "contoh.pendaftar" },
  interview: {
    motivationHigherEducation: "Saya ingin kuliah supaya bisa membantu keluarga.",
    motivationSakem: "Saya ingin belajar bersama teman-teman yang saling mendukung.",
    consistencyPlan: "Belajar rutin setiap hari dan mengikuti jadwal bimbingan.",
    attendanceCommitment: "Saya siap hadir pada seluruh kegiatan yang dijadwalkan.",
    parentResponse: "Orang tua saya mendukung sepenuhnya rencana ini.",
    ifParentChangesMind: "Saya akan berdiskusi baik-baik dan mencari jalan tengah.",
    agreedToSignedStatement: "ya",
  },
};

function sanitised(step: StepId) {
  const result = validateStep(step, TYPED[step]);
  if (!result.ok) throw new Error(`${step}: ${JSON.stringify(result.fields)}`);
  return result.value;
}

describe("the wizard's reading of the Worker", () => {
  test("no batch: the gate, and every write is the 409 the wizard acts on", async () => {
    const who = await student();
    as(who);
    const current = await getCurrent();
    expect(current).toMatchObject({ kind: "ok", data: { gate: "no_open_batch", batch: null, draft: null, files: [] } });
    expect(await putStep("identity", sanitised("identity"))).toMatchObject({ kind: "gate", gate: "no_open_batch" });
    expect(await postSubmit()).toMatchObject({ kind: "gate", gate: "no_open_batch" });
  });

  test("an open batch and nothing started: the gate is open, the draft is null, the account's name is there, the send says 'no_draft'", async () => {
    await openBatch();
    const who = await student();
    as(who);
    const current = await getCurrent();
    expect(current.kind === "ok" && current.data).toMatchObject({ gate: "open", draft: null, application: null, files: [] });
    expect(current.kind === "ok" && current.data.user.name).toBeTruthy();
    expect(await postSubmit()).toMatchObject({ kind: "failed", status: 404, code: "no_draft", message: "Belum ada isian yang tersimpan. Isi formulir pendaftaran dulu." });
  });

  test("a session that is not there is 'unauthorized' on all three calls", async () => {
    as(null);
    expect(await getCurrent()).toEqual({ kind: "unauthorized" });
    expect(await putStep("identity", {})).toEqual({ kind: "unauthorized" });
    expect(await postSubmit()).toEqual({ kind: "unauthorized" });
  });

  test("each bucket, saved as the wizard sends it, comes back from `current` as the same bucket (so nothing shows 'belum disimpan' after a round trip)", async () => {
    await openBatch();
    const who = await student();
    as(who);
    for (const step of STEP_IDS) {
      const saved = await putStep(step, sanitised(step));
      expect(saved, step).toMatchObject({ kind: "ok", data: { step } });
      const current = await getCurrent();
      if (current.kind !== "ok") throw new Error("current");
      const form = normalizeBucket(TYPED[step], emptyValues("")[step]);
      expect(snapshotsOf(current.data.draft)[step], step).toBe(canon(step, form));
    }
    const current = await getCurrent();
    if (current.kind !== "ok") throw new Error("current");
    expect(current.data.draft?.saved).toEqual([...STEP_IDS]);
    expect(current.data.draft?.lastStep).toBe("interview");

    // Opened on another device: everything saved, so the student lands on the review, with the buckets filled.
    const start = mergeStart({ accountName: "", draft: current.data.draft, local: null, skewMs: 0 });
    expect(start.screen).toBe(REVIEW_INDEX);
    expect(canon("household", start.values.household)).toBe(canon("household", normalizeBucket(TYPED.household, emptyValues("").household)));
  });

  test("the fields the Worker names for a bucket that fails are the ones the wizard's own rules name (the two never disagree)", async () => {
    await openBatch();
    const who = await student();
    as(who);
    const bad: [StepId, Record<string, unknown>][] = [
      ["identity", { ...TYPED.identity, fullName: "AB", whatsapp: "0812", gender: "x" }],
      ["household", { ...TYPED.household, livingWith: [], fatherIncome: "Rp1", earner1Relation: "", familySize: "0" }],
      ["housing", { ...TYPED.housing, buildingArea: "-1", debtInstallmentMonths: "0" }],
      ["organizations", { hasOrganizations: true, entries: [{ name: "OSIS", position: "" }, { name: "", position: "" }] }],
      ["marketing", { instagramUsername: "a b" }],
      ["interview", { ...TYPED.interview, motivationSakem: "pendek", agreedToSignedStatement: "tidak" }],
    ];
    for (const [step, body] of bad) {
      const client = validateStep(step, body);
      const server = await putStep(step, body);
      expect(server, step).toMatchObject({ kind: "invalid" });
      expect(server.kind === "invalid" && server.fields, step).toEqual(!client.ok && client.fields);
    }
  });

  test("the send: the missing documents are 422 'incomplete' with the sentence the wizard would build itself (the Worker names the documents' slots first, the proofs only once those are there)", async () => {
    await openBatch();
    const who = await student();
    as(who);
    for (const step of STEP_IDS) await putStep(step, sanitised(step));
    const lacking: SlotId[] = requiredSlots(false).filter((slot) => SLOTS[slot].step === "documents");
    const result = await postSubmit();
    expect(result).toMatchObject({ kind: "failed", status: 422, code: "incomplete", message: missingFilesMessage(lacking) });
  });

  test("the send: with everything there it is 201, and `current` then says 'submitted' with the same id; a second send and a save are the 409", async () => {
    await openBatch();
    const who = await student();
    as(who);
    for (const step of STEP_IDS) await putStep(step, sanitised(step));
    const draft = (await draftOf(who.id))!;
    await addRequiredFiles(draft.id);

    const before = await getCurrent();
    expect(before.kind === "ok" && before.data.files.length).toBe(requiredSlots(false).length);
    expect(before.kind === "ok" && before.data.draft?.missingFiles).toEqual([]);

    const sent = await postSubmit();
    expect(sent).toMatchObject({ kind: "ok", data: { applicationId: draft.id } });
    const after = await getCurrent();
    expect(after).toMatchObject({ kind: "ok", data: { gate: "submitted", draft: null, application: { id: draft.id } } });
    expect(after.kind === "ok" && after.data.files.length).toBe(requiredSlots(false).length);
    expect(await postSubmit()).toMatchObject({ kind: "gate", gate: "already_submitted" });
    expect(await putStep("identity", sanitised("identity"))).toMatchObject({ kind: "gate", gate: "already_submitted" });
  });

  test("a save of the documents with 'tidak' removes the SKTM file, and the answer lists the slot the wizard forgets", async () => {
    await openBatch();
    const who = await student();
    as(who);
    await putStep("documents", { dtksRegistered: "ya" });
    const draft = (await draftOf(who.id))!;
    await addFileRow(draft.id, "dtks", { contentType: "application/pdf" });
    const before = await getCurrent();
    expect(before.kind === "ok" && before.data.files.map((file) => file.slot)).toEqual(["dtks"]);
    const result = await putStep("documents", { dtksRegistered: "tidak" });
    expect(result).toMatchObject({ kind: "ok", data: { removedSlots: ["dtks"] } });
    const after = await getCurrent();
    expect(after.kind === "ok" && after.data.files).toEqual([]);
  });
});

describe("the wizard's part of GET /portal/api/config", () => {
  const config = async (env: Record<string, string> = {}) => (await portalCall("/portal/api/config", { env })).json() as Promise<Record<string, unknown>>;

  test("absent: the Worker sends neither value (or sends them empty), and the wizard reads both as 'no link', still reading the public site's address", async () => {
    const body = await config({ SITE_URL: "https://situs.contoh.test" });
    expect(body.siteUrl).toBe("https://situs.contoh.test");
    expect(parseWizardConfig(body)).toEqual({ siteUrl: "https://situs.contoh.test", contactWhatsapp: "", whatsappGroupUrl: "" });
    // The shape the Worker may send for them: text, and "" when unset (as `adminUrl` is). A null, a boolean or a number would not be ours to read.
    for (const key of ["contactWhatsapp", "whatsappGroupUrl"]) if (key in body) expect(typeof body[key], key).toBe("string");
  });

  test("present: the shape the Worker's two public variables make, as the wizard reads it (digits with the country code, an https address)", () => {
    // What the Worker sends once the deployment sets them: the number as digits (what a person pastes with spaces or a plus is
    // cleaned on this side), the group as an https address. Anything else is no link, so a typo in a variable cannot become a bad link.
    expect(parseWizardConfig({ siteUrl: "https://situs.contoh.test", contactWhatsapp: "6281200000001", whatsappGroupUrl: "https://chat.contoh.test/grup" })).toEqual({
      siteUrl: "https://situs.contoh.test",
      contactWhatsapp: "6281200000001",
      whatsappGroupUrl: "https://chat.contoh.test/grup",
    });
    expect(parseWizardConfig({ contactWhatsapp: "+62 812-0000-0001", whatsappGroupUrl: "http://chat.contoh.test/grup" })).toMatchObject({ contactWhatsapp: "6281200000001", whatsappGroupUrl: "" });
    expect(parseWizardConfig({ contactWhatsapp: "hubungi kami", whatsappGroupUrl: "javascript:alert(1)" })).toMatchObject({ contactWhatsapp: "", whatsappGroupUrl: "" });
  });
});
