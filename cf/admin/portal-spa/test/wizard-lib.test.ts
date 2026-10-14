import { describe, expect, test } from "vitest";
import { LOCAL_DRAFT_VERSION, type LocalDraft } from "../../shared/application-form/draft";
import { STEP_IDS, UI_STEP_BUCKETS, UI_STEP_ORDER } from "../../shared/application-form/steps";
import { classify, failureMessage, GATE_MESSAGES, parseCurrent, parseStepSaved, parseSubmitted } from "../src/lib/wizard/api";
import { parsePortalConfig } from "../src/lib/public-config";
import { contactHref, parseWizardConfig } from "../src/lib/wizard/config";
import { FIELD_LABELS, labelOf } from "../src/lib/wizard/fields";
import { BUCKET_SCREENS, firstIncompleteScreen, REVIEW_INDEX, screenOf, screensDone } from "../src/lib/wizard/screens";
import { summaryItems } from "../src/lib/wizard/summary";
import { canon, emptyValues, isDirty, mergeStart, normalizeBucket, snapshotsOf } from "../src/lib/wizard/values";
import { currentBody } from "./wizard-helpers";

// The pure parts of the wizard: how it reads what the Worker answers, how it tells two copies of a bucket apart, which
// copy wins when it opens, and where a student lands. No DOM, no React.

const NOW = Date.parse("2026-10-13T03:00:00.000Z");
const STORED_IDENTITY = {
  fullName: "Sari Dewi",
  nickname: "Sari",
  gender: "perempuan",
  religion: "Islam",
  schoolName: "SMAN 1 Contoh",
  branch: "Bandung",
  homeAddress: "Jl. Contoh No. 1",
  graduationBatch: "2027 (Kelas 12)",
  whatsapp: "6281200000001",
};
const draftOf = (over: Record<string, unknown> = {}) => ({ id: "d1", updatedAt: "2026-10-13T02:00:00.000Z", lastStep: "identity", steps: { identity: STORED_IDENTITY }, saved: ["identity"], missingFiles: [], ...over });
const localOf = (over: Partial<LocalDraft> = {}): LocalDraft => ({ version: LOCAL_DRAFT_VERSION, savedAt: NOW, stepIndex: 2, visited: ["intro", "identity", "household"], values: {}, ...over });

describe("parseCurrent: the answer the wizard opens on", () => {
  test("an open batch with no draft", () => {
    const parsed = parseCurrent(currentBody());
    expect(parsed).toMatchObject({ gate: "open", application: null, draft: null, files: [], user: { name: "Sari Dewi" } });
    expect(parsed?.batch).toMatchObject({ id: "8b7e0c1a-0000-4000-8000-000000000001", year: 2026, name: "Gen 6 - 2026/2027", description: null });
  });

  test("no batch is open: the gate says so and there is no batch", () => {
    expect(parseCurrent(currentBody({ gate: "no_open_batch", batch: null }))).toMatchObject({ gate: "no_open_batch", batch: null });
  });

  test("submitted needs the application and its time", () => {
    expect(parseCurrent(currentBody({ gate: "submitted", application: { id: "a1", submittedAt: "2026-10-12T01:00:00.000Z" } }))?.application).toEqual({ id: "a1", submittedAt: "2026-10-12T01:00:00.000Z" });
    expect(parseCurrent(currentBody({ gate: "submitted", application: null }))).toBeNull();
  });

  test("a draft is read bucket by bucket: only the seven known ones, only objects; the rest of the list is filtered, not trusted", () => {
    const parsed = parseCurrent(currentBody({ draft: draftOf({ steps: { identity: STORED_IDENTITY, other: { a: 1 }, housing: "text" }, saved: ["identity", "nope"], missingFiles: ["family-card", "nope"], lastStep: "nope" }) }));
    expect(parsed?.draft).toMatchObject({ id: "d1", lastStep: null, saved: ["identity"], missingFiles: ["family-card"] });
    expect(Object.keys(parsed?.draft?.steps ?? {})).toEqual(["identity"]);
  });

  test("files are the stored files of P4's parser; one that is not a file is dropped", () => {
    const good = { id: "f1", slot: "family-card", contentType: "application/pdf", size: 10, width: null, height: null, uploadedAt: "2026-10-13T02:00:00.000Z" };
    expect(parseCurrent(currentBody({ files: [good, { id: "f2", slot: "not-a-slot" }, 7] }))?.files).toEqual([good]);
  });

  test.each([
    ["not an object", null],
    ["no clock", { ...currentBody(), now: "nope" }],
    ["an unknown gate", currentBody({ gate: "closed" })],
    ["an open gate with no batch", currentBody({ batch: null })],
    ["a batch that is not one", currentBody({ batch: { id: 1 } })],
    ["a draft that is not one", currentBody({ draft: { id: "d" } })],
    ["no user", { ...currentBody(), user: null }],
  ])("%s is null (an error screen, never a form of blanks)", (_name, body) => {
    expect(parseCurrent(body)).toBeNull();
  });
});

describe("the answers of a save and of the submit", () => {
  test("a saved step: the draft's state and the slots the server removed", () => {
    const body = { step: "documents", savedAt: "2026-10-13T03:00:00.000Z", draft: { id: "d1", updatedAt: "2026-10-13T03:00:00.000Z", saved: ["documents"], missingFiles: ["family-card"] }, removedSlots: ["dtks", "nope"] };
    expect(parseStepSaved(body)).toEqual({ step: "documents", savedAt: "2026-10-13T03:00:00.000Z", draft: { id: "d1", updatedAt: "2026-10-13T03:00:00.000Z", saved: ["documents"], missingFiles: ["family-card"] }, removedSlots: ["dtks"] });
    expect(parseStepSaved({ ...body, step: "nope" })).toBeNull();
    expect(parseStepSaved({ ...body, draft: null })).toBeNull();
  });

  test("the submitted application", () => {
    expect(parseSubmitted({ applicationId: "a1", submittedAt: "2026-10-13T03:00:00.000Z", batch: { id: "b" } })).toEqual({ applicationId: "a1", submittedAt: "2026-10-13T03:00:00.000Z" });
    expect(parseSubmitted({ applicationId: 1, submittedAt: "2026-10-13T03:00:00.000Z" })).toBeNull();
    expect(parseSubmitted({ applicationId: "a1", submittedAt: "tomorrow-ish" })).toBeNull();
  });
});

describe("what a refusal comes to", () => {
  const failure = (status: number, code?: string, extra: Record<string, unknown> = {}) => ({ ok: false as const, status, code, ...extra });

  test("401 is the lost session; the shell takes it from there", () => {
    expect(classify(failure(401, "unauthenticated"))).toEqual({ kind: "unauthorized" });
  });

  test.each(["no_open_batch", "batch_closed", "already_submitted"] as const)("409 %s is the gate: the Worker's sentence, or the legacy one when it sent none", (code) => {
    expect(classify(failure(409, code, { message: "Kalimat dari Worker." }))).toEqual({ kind: "gate", gate: code, message: "Kalimat dari Worker." });
    expect(classify(failure(409, code))).toEqual({ kind: "gate", gate: code, message: GATE_MESSAGES[code] });
  });

  test("the legacy sentences of the three gates", () => {
    expect(GATE_MESSAGES).toEqual({
      no_open_batch: "Belum ada batch pendaftaran yang dibuka. Silakan kembali saat pendaftaran berikutnya diumumkan.",
      batch_closed: "Pendaftaran untuk batch ini sudah ditutup. Isianmu tidak bisa disimpan atau dikirim.",
      already_submitted: "Kamu sudah mengirim pendaftaran untuk batch ini. Cek status di halaman Portal Siswa.",
    });
  });

  test("400 invalid carries the fields (only strings are kept by the client) and the sentence", () => {
    expect(classify(failure(400, "invalid", { fields: { fullName: "Nama minimal 3 karakter" }, message: "Periksa kembali isian formulir." }))).toEqual({
      kind: "invalid",
      fields: { fullName: "Nama minimal 3 karakter" },
      message: "Periksa kembali isian formulir.",
    });
    expect(classify(failure(400, "invalid"))).toEqual({ kind: "invalid", fields: {}, message: "Periksa kembali isian formulir." });
  });

  test("the rest: offline, the limiter, the Worker's own sentence, a 5xx", () => {
    expect(classify(failure(0))).toMatchObject({ kind: "failed", status: 0, message: "Tidak dapat terhubung ke server. Periksa koneksi internet lalu coba lagi." });
    expect(failureMessage({ status: 429, retryAfter: 60 })).toBe("Terlalu banyak percobaan. Coba lagi dalam 1 menit.");
    expect(failureMessage({ status: 429, retryAfter: 30 })).toBe("Terlalu banyak percobaan. Coba lagi dalam 30 detik.");
    expect(failureMessage({ status: 429 })).toBe("Terlalu banyak percobaan. Coba lagi dalam 1 menit.");
    expect(failureMessage({ status: 429, message: "Terlalu banyak percobaan pengiriman. Silakan tunggu beberapa menit lalu coba lagi." })).toBe("Terlalu banyak percobaan pengiriman. Silakan tunggu beberapa menit lalu coba lagi.");
    expect(classify(failure(422, "incomplete", { message: "Berkas wajib belum lengkap: Foto Diri." }))).toEqual({ kind: "failed", status: 422, code: "incomplete", message: "Berkas wajib belum lengkap: Foto Diri." });
    expect(classify(failure(500, "internal"))).toMatchObject({ message: "Terjadi kesalahan di server. Coba lagi sebentar lagi." });
    // A 409 that is not one of the three is no gate.
    expect(classify(failure(409, "duplicate_whatsapp", { message: "Baru saja dikirim." }))).toEqual({ kind: "failed", status: 409, code: "duplicate_whatsapp", message: "Baru saja dikirim." });
  });
});

describe("a bucket as the screens draw it", () => {
  const base = emptyValues("Sari Dewi");

  test("a stored bucket comes back as text, whatever it was sent as", () => {
    const household = normalizeBucket({ familySize: 4, hasOtherEarner1: true, livingWith: ["Ayah", 3, "Nenek"], fatherName: " Bapak " }, base.household);
    expect(household).toMatchObject({ familySize: "4", hasOtherEarner1: true, livingWith: ["Ayah", "Nenek"], fatherName: " Bapak ", motherName: "" });
  });

  test("a copy somebody edited in the browser cannot break a screen: the wrong type is the default, unknown keys are gone", () => {
    const identity = normalizeBucket({ fullName: { evil: true }, nickname: 12, gender: ["x"], extra: "no" }, base.identity);
    expect(identity.fullName).toBe("Sari Dewi");
    expect(identity.nickname).toBe("12");
    expect(identity.gender).toBe("");
    expect("extra" in identity).toBe(false);
    expect(normalizeBucket("not an object", base.identity)).toBe(base.identity);
    expect(normalizeBucket(null, base.housing)).toBe(base.housing);
  });

  test("the organisations always show a row to type in", () => {
    expect(normalizeBucket({ hasOrganizations: false, entries: [] }, base.organizations).entries).toEqual([{ name: "", position: "" }]);
    expect(normalizeBucket({ hasOrganizations: true, entries: [{ name: "OSIS", position: 3 }, "x"] }, base.organizations).entries).toEqual([{ name: "OSIS", position: "" }]);
  });

  test("a new application starts empty, with the account's name and no vehicle, as the legacy form did", () => {
    expect(base.identity).toMatchObject({ fullName: "Sari Dewi", nickname: "" });
    expect(base.housing).toMatchObject({ motorcycles: "0", cars: "0", buildingArea: "" });
    expect(base.organizations.entries).toEqual([{ name: "", position: "" }]);
  });
});

describe("canon: is this still what the server holds?", () => {
  test("a trailing space and a count that was a number on the other side do not count as a change", () => {
    const base = emptyValues("");
    const typed = { ...base.identity, ...STORED_IDENTITY, schoolName: "SMAN 1 Contoh  " };
    expect(canon("identity", typed)).toBe(canon("identity", STORED_IDENTITY));
    const a = { ...base.household, familySize: "4" };
    const b = normalizeBucket({ ...a, familySize: 4 }, base.household);
    expect(canon("household", a)).toBe(canon("household", b));
  });

  test("a bucket that does not pass is never equal to one that does", () => {
    const base = emptyValues("");
    expect(canon("identity", base.identity)).not.toBe(canon("identity", STORED_IDENTITY));
  });

  test("dirty: typed and not held, or held and changed; an empty bucket the student never touched is not 'belum disimpan'", () => {
    const pristine = emptyValues("Sari Dewi");
    const values = emptyValues("Sari Dewi");
    expect(isDirty("identity", values, {}, pristine)).toBe(false);
    values.identity.nickname = "Sari";
    expect(isDirty("identity", values, {}, pristine)).toBe(true);
    const saved = snapshotsOf({ id: "d", updatedAt: "2026-10-13T02:00:00.000Z", lastStep: "identity", steps: { identity: STORED_IDENTITY }, saved: ["identity"], missingFiles: [] });
    expect(isDirty("identity", { ...values, identity: normalizeBucket(STORED_IDENTITY, pristine.identity) }, saved, pristine)).toBe(false);
    expect(isDirty("identity", { ...values, identity: { ...normalizeBucket(STORED_IDENTITY, pristine.identity), nickname: "Dewi" } }, saved, pristine)).toBe(true);
  });
});

describe("mergeStart: what the wizard opens with", () => {
  const server = (updatedAt = "2026-10-13T02:00:00.000Z") => parseCurrent(currentBody({ draft: draftOf({ updatedAt }) }))!.draft;
  const typedElsewhere = { ...STORED_IDENTITY, nickname: "Dewi" };

  test("nothing at all: an empty form on the intro", () => {
    const start = mergeStart({ accountName: "Sari Dewi", draft: null, local: null, skewMs: 0 });
    expect(start).toMatchObject({ screen: 0, visited: ["intro"], saved: {} });
    expect(start.values.identity.fullName).toBe("Sari Dewi");
  });

  test("the server's draft only: its buckets are filled, and the student carries on at the first screen it does not hold", () => {
    const start = mergeStart({ accountName: "Sari Dewi", draft: server(), local: null, skewMs: 0 });
    expect(start.values.identity).toMatchObject({ fullName: "Sari Dewi", nickname: "Sari", branch: "Bandung" });
    expect(UI_STEP_ORDER[start.screen]).toBe("household");
    expect(start.visited).toEqual(["intro", "identity", "household"]);
    expect(Object.keys(start.saved)).toEqual(["identity"]);
  });

  test("the browser's copy only: it is what the student typed, and it says where they were", () => {
    const start = mergeStart({ accountName: "", draft: null, local: localOf({ values: { identity: typedElsewhere } }), skewMs: 0 });
    expect(start.values.identity.nickname).toBe("Dewi");
    expect(start.screen).toBe(2);
    expect(start.visited).toEqual(["intro", "identity", "household"]);
    expect(start.saved).toEqual({});
  });

  test("both, and the browser's copy is NEWER and different: it is kept, and the bucket is not 'saved' (so it shows 'belum disimpan')", () => {
    const start = mergeStart({ accountName: "", draft: server("2026-10-13T01:00:00.000Z"), local: localOf({ savedAt: NOW, values: { identity: typedElsewhere } }), skewMs: 0 });
    expect(start.values.identity.nickname).toBe("Dewi");
    expect(isDirty("identity", start.values, start.saved, emptyValues(""))).toBe(true);
    expect(start.screen).toBe(2);
  });

  test("both, and the server's draft is NEWER: the server wins for what it holds; the screen is where the server stops", () => {
    const start = mergeStart({ accountName: "", draft: server("2026-10-13T04:00:00.000Z"), local: localOf({ savedAt: NOW, values: { identity: typedElsewhere } }), skewMs: 0 });
    expect(start.values.identity.nickname).toBe("Sari");
    expect(isDirty("identity", start.values, start.saved, emptyValues(""))).toBe(false);
    expect(UI_STEP_ORDER[start.screen]).toBe("household");
    // The screens the browser had visited are still open to jump to.
    expect(start.visited).toContain("household");
  });

  test("both, newer, but the same: nothing to mark", () => {
    const start = mergeStart({ accountName: "", draft: server("2026-10-13T01:00:00.000Z"), local: localOf({ values: { identity: STORED_IDENTITY } }), skewMs: 0 });
    expect(isDirty("identity", start.values, start.saved, emptyValues(""))).toBe(false);
  });

  test("a bucket the server does not hold is the browser's even when the server's draft is newer", () => {
    const start = mergeStart({ accountName: "", draft: server("2026-10-13T04:00:00.000Z"), local: localOf({ values: { household: { fatherName: "Bapak Contoh" } } }), skewMs: 0 });
    expect(start.values.household.fatherName).toBe("Bapak Contoh");
  });

  test("a phone whose clock is ahead does not decide which copy is newer: the skew from the server's `now` is taken off", () => {
    // The local copy was written 10 minutes before the server's draft, by the server's clock; the phone is 30 minutes ahead.
    const draft = server("2026-10-13T02:00:00.000Z");
    const writtenAt = Date.parse("2026-10-13T01:50:00.000Z") + 30 * 60 * 1000;
    const start = mergeStart({ accountName: "", draft, local: localOf({ savedAt: writtenAt, values: { identity: typedElsewhere } }), skewMs: 30 * 60 * 1000 });
    expect(start.values.identity.nickname).toBe("Sari");
    // Without the correction the same copy would have looked 20 minutes newer and won.
    const naive = mergeStart({ accountName: "", draft, local: localOf({ savedAt: writtenAt, values: { identity: typedElsewhere } }), skewMs: 0 });
    expect(naive.values.identity.nickname).toBe("Dewi");
  });

  test("a draft that has only files (no step saved yet) opens on the first form screen, not the intro", () => {
    const start = mergeStart({ accountName: "", draft: parseCurrent(currentBody({ draft: draftOf({ steps: {}, saved: [], lastStep: null }) }))!.draft, local: null, skewMs: 0 });
    expect(UI_STEP_ORDER[start.screen]).toBe("identity");
  });
});

describe("screens", () => {
  test("every bucket is drawn on exactly one screen, and the marketing proofs sit under the documents", () => {
    for (const bucket of STEP_IDS) expect(UI_STEP_BUCKETS[screenOf(bucket)]).toContain(bucket);
    expect(screenOf("marketing")).toBe("documents");
    expect(BUCKET_SCREENS.map((entry) => entry.bucket)).toEqual([...STEP_IDS]);
  });

  test("done screens and where to carry on", () => {
    expect(screensDone(["identity", "documents"])).toEqual(["identity"]);
    expect(screensDone(["documents", "marketing"])).toEqual(["documents"]);
    expect(UI_STEP_ORDER[firstIncompleteScreen([])]).toBe("identity");
    expect(UI_STEP_ORDER[firstIncompleteScreen(["identity", "household", "housing"])]).toBe("organizations");
    // The student went back and saved an earlier screen again: they carry on where the gap is, not after the last save.
    expect(UI_STEP_ORDER[firstIncompleteScreen(["identity", "household", "organizations", "interview"])]).toBe("housing");
    expect(UI_STEP_ORDER[firstIncompleteScreen(["documents"])]).toBe("identity");
    expect(firstIncompleteScreen(STEP_IDS)).toBe(REVIEW_INDEX);
  });
});

describe("the summary of what needs fixing", () => {
  test("one line per field, in the order the fields appear, with the name the label uses", () => {
    const items = summaryItems("household", { familySize: "Minimal 1 (termasuk kamu)", fatherName: "Wajib diisi", livingWith: "Pilih minimal satu" });
    expect(items.map((item) => item.label)).toEqual(["Kamu tinggal bersama siapa?", "Nama Ayah", "Jumlah Anggota Keluarga"]);
    expect(items[2]).toEqual({ key: "familySize", label: "Jumlah Anggota Keluarga", message: "Minimal 1 (termasuk kamu)" });
  });

  test("a row of the organisations and a document have their own names; the documents come after the marketing field", () => {
    const org = summaryItems("organizations", { "entries.1.position": "Jabatan wajib diisi", "entries.0.name": "Nama organisasi wajib diisi" });
    expect(org.map((item) => item.label)).toEqual(["Organisasi 1, Nama Organisasi", "Organisasi 2, Jabatan / Posisi"]);
    const docs = summaryItems("documents", { "file:family-card": "Wajib diisi", instagramUsername: "Wajib diisi", dtksRegistered: "Pilih Ya atau Tidak", "file:dtks": "Wajib diisi karena kamu terdaftar DTKS. Unggah SKTM DTKS-mu." });
    expect(docs.map((item) => item.label)).toEqual(["Terdaftar DTKS", "Username Instagram", "Scan Kartu Keluarga", "Surat Keterangan Tidak Mampu (SKTM) terdaftar DTKS"]);
  });

  test("a key no field owns still gets a line: a message of the Worker is never dropped", () => {
    expect(summaryItems("identity", { somethingNew: "Pesan dari server." })).toEqual([{ key: "somethingNew", label: "Isian", message: "Pesan dari server." }]);
    expect(summaryItems("identity", { fullName: "" })).toEqual([]);
  });

  test("every field of every bucket has a name", () => {
    expect(labelOf("identity", "fullName")).toBe("Nama Lengkap");
    expect(labelOf("household", "livingWith.0")).toBe("Kamu tinggal bersama siapa?");
    expect(Object.values(FIELD_LABELS).every((labels) => Object.values(labels).every((label) => label.length > 0))).toBe(true);
  });
});

describe("the wizard's part of /portal/api/config", () => {
  test("the contact number is digits, the group is an https address; anything else is nothing", () => {
    expect(parseWizardConfig({ siteUrl: "https://contoh.test", contactWhatsapp: "+62 812-0000-0001", whatsappGroupUrl: "https://chat.contoh.test/abc" })).toEqual({
      siteUrl: "https://contoh.test",
      contactWhatsapp: "6281200000001",
      whatsappGroupUrl: "https://chat.contoh.test/abc",
    });
    expect(parseWizardConfig({ contactWhatsapp: "halo", whatsappGroupUrl: "http://chat.contoh.test/abc" })).toEqual({ siteUrl: "", contactWhatsapp: "", whatsappGroupUrl: "" });
    expect(parseWizardConfig({ whatsappGroupUrl: "javascript:alert(1)" }).whatsappGroupUrl).toBe("");
    expect(parseWizardConfig(null)).toEqual({ siteUrl: "", contactWhatsapp: "", whatsappGroupUrl: "" });
    expect(contactHref("6281200000001")).toBe("https://wa.me/6281200000001");
  });

  test("absent, empty or present: both values are optional, and an empty text is the same as none", () => {
    const none = { siteUrl: "", contactWhatsapp: "", whatsappGroupUrl: "" };
    expect(parseWizardConfig({ google: false, turnstileSiteKey: null, siteUrl: "", adminUrl: "" })).toEqual(none);
    expect(parseWizardConfig({ siteUrl: "", adminUrl: "", contactWhatsapp: "", whatsappGroupUrl: "" })).toEqual(none);
    expect(parseWizardConfig({ contactWhatsapp: null, whatsappGroupUrl: 5 })).toEqual(none);
    expect(parseWizardConfig({ contactWhatsapp: "6281200000001", whatsappGroupUrl: "https://chat.contoh.test/grup" })).toEqual({
      siteUrl: "",
      contactWhatsapp: "6281200000001",
      whatsappGroupUrl: "https://chat.contoh.test/grup",
    });
  });

  test("the public site's address is read as the shell reads it (the one rule, kept in two files that a Worker test can and cannot import)", () => {
    for (const value of ["https://situs.contoh.test", "http://localhost:4321/", "https://situs.contoh.test/jalan?x=1", "ftp://situs.contoh.test", "bukan alamat", "", "  ", null, 7]) {
      expect(parseWizardConfig({ siteUrl: value }).siteUrl, String(value)).toBe(parsePortalConfig({ siteUrl: value }).siteUrl);
    }
  });
});
