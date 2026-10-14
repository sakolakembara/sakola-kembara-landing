import { describe, expect, test } from "vitest";
import { buildFormData } from "../shared/application-form/form-data";
import { requiredSlots, SLOT_IDS } from "../shared/application-form/slots";
import { STEP_IDS, STEP_NOT_SAVED_MESSAGE } from "../shared/application-form/steps";
import { applicationStatus, CURRENT_FORM_DATA_VERSION, type DraftFormData, type StudentApplicationFormData } from "../src/db/schema";
import { applicationReceivedEmail, formatWib } from "../src/email/templates";
import { presentCurrent, presentFiles, presentOpenBatch, presentOverview, presentStatusItem } from "../src/portal/present";
import {
  applicationFileKey,
  checkSubmission,
  countBySlot,
  dtksRegisteredIn,
  DUPLICATE_WINDOW_MS,
  firstNameOf,
  formDataToStore,
  gateOf,
  MESSAGES,
  missingFilesOf,
  resultOf,
  savedStepsOf,
  stepsOf,
  writeRefusal,
  type OpenState,
} from "../src/portal/rules";
import { VALID } from "./portal-applications-helpers";

// The pure rules and the presenters of the student's application API (src/portal/rules.ts, src/portal/present.ts): each
// decided from values, no request, no D1. docs/cloudflare/portal-api.md, sections 4 to 10.

const BATCH = { id: "b1", year: 2026, name: "Gen Uji", description: null, opensAt: new Date(Date.UTC(2026, 9, 1)), closesAt: new Date(Date.UTC(2026, 10, 15)) };
const DRAFT = { id: "d1", updatedAt: new Date(Date.UTC(2026, 9, 5)), lastStep: "identity" as const, formData: null };
const state = (over: Partial<OpenState> = {}): OpenState => ({ batch: BATCH, application: null, draft: null, ...over });

describe("the gate and the refusal of a write (6.2)", () => {
  test("open, submitted, no_open_batch", () => {
    expect(gateOf(state())).toBe("open");
    expect(gateOf(state({ draft: DRAFT }))).toBe("open");
    expect(gateOf(state({ application: { id: "a1", submittedAt: new Date(0) } }))).toBe("submitted");
    expect(gateOf(null)).toBe("no_open_batch");
  });

  test("a write: allowed when open; already_submitted when an application exists; no_open_batch, or batch_closed when the student still has a draft", () => {
    expect(writeRefusal(state(), false)).toBeNull();
    expect(writeRefusal(state({ draft: DRAFT }), false)).toBeNull();
    expect(writeRefusal(state({ application: { id: "a1", submittedAt: new Date(0) } }), false)).toEqual({ error: "already_submitted", message: MESSAGES.alreadySubmitted });
    expect(writeRefusal(null, false)).toEqual({ error: "no_open_batch", message: MESSAGES.noOpenBatch });
    expect(writeRefusal(null, true)).toEqual({ error: "batch_closed", message: MESSAGES.batchClosed });
  });

  test("the sentences are the legacy ones (docs/cloudflare/portal-api.md, section 13)", () => {
    expect(MESSAGES).toEqual({
      noOpenBatch: "Belum ada batch pendaftaran yang dibuka. Silakan kembali saat pendaftaran berikutnya diumumkan.",
      batchClosed: "Pendaftaran untuk batch ini sudah ditutup. Isianmu tidak bisa disimpan atau dikirim.",
      alreadySubmitted: "Kamu sudah mengirim pendaftaran untuk batch ini. Cek status di halaman Portal Siswa.",
      noDraft: "Belum ada isian yang tersimpan. Isi formulir pendaftaran dulu.",
      duplicateWhatsapp: "Pendaftaran dari nomor WhatsApp ini baru saja dikirim. Mohon tunggu sebelum mencoba lagi.",
      draftChanged: "Isianmu berubah saat dikirim. Periksa lagi lalu kirim ulang.",
      verifyBeforeSubmit: "Verifikasi email kamu dulu sebelum mengirim pendaftaran.",
    });
    expect(DUPLICATE_WINDOW_MS).toBe(3_600_000);
  });
});

describe("firstNameOf (4.3)", () => {
  test.each([
    ["Sari Dewi", "Sari"],
    ["  Budi   Santoso", "Budi"],
    ["Ayu", "Ayu"],
    ["Nama\tDengan\nTab", "Nama"],
    ["", "Sakemers"],
    ["   ", "Sakemers"],
    [null, "Sakemers"],
    [undefined, "Sakemers"],
  ] as const)("%j -> %s", (name, first) => {
    expect(firstNameOf(name)).toBe(first);
  });
});

describe("resultOf: the privacy contract (10.1) is decided here and nowhere else", () => {
  const PUBLISHED = new Date(Date.UTC(2026, 11, 1, 1));
  const NOTE = "Catatan panitia";

  test("an unpublished batch: processing, whatever the status and the note are (the status is even handed over as a string a page must never show)", () => {
    for (const status of [...applicationStatus, null] as const) {
      for (const reviewNotes of [NOTE, "", null]) {
        expect(resultOf({ status, reviewNotes, publishedAt: null }), `${status} ${reviewNotes}`).toEqual({ state: "processing" });
      }
    }
  });

  test("published: accepted and rejected are decisions with the announcement time and the trimmed note (null when blank)", () => {
    for (const status of ["accepted", "rejected"] as const) {
      expect(resultOf({ status, reviewNotes: `  ${NOTE} `, publishedAt: PUBLISHED })).toEqual({ state: "decided", decision: status, announcedAt: PUBLISHED.toISOString(), notes: NOTE });
      for (const blank of ["", "  \n", null]) expect(resultOf({ status, reviewNotes: blank, publishedAt: PUBLISHED })).toEqual({ state: "decided", decision: status, announcedAt: PUBLISHED.toISOString(), notes: null });
    }
  });

  test("published but still pending or under review: awaiting_decision, with the time and nothing else; a missing status is the same", () => {
    for (const status of ["pending", "under_review", null] as const) {
      expect(resultOf({ status, reviewNotes: NOTE, publishedAt: PUBLISHED })).toEqual({ state: "awaiting_decision", announcedAt: PUBLISHED.toISOString() });
    }
  });
});

describe("the draft's buckets", () => {
  const form: DraftFormData = { interview: { a: 1 }, identity: { b: 2 }, housing: { c: 3 }, documents: { dtksRegistered: "ya" }, nonsense: { z: 0 } } as DraftFormData;

  test("saved and steps follow the order of the seven buckets, drop anything else, and ignore what was never saved", () => {
    expect(savedStepsOf(form)).toEqual(["identity", "housing", "documents", "interview"]);
    expect(Object.keys(stepsOf(form))).toEqual(["identity", "housing", "documents", "interview"]);
    expect(stepsOf(form).identity).toEqual({ b: 2 });
    expect(savedStepsOf(null)).toEqual([]);
    expect(savedStepsOf(undefined)).toEqual([]);
    expect(stepsOf(null)).toEqual({});
  });

  test("DTKS counts only when the stored answer is exactly ya", () => {
    expect(dtksRegisteredIn(form)).toBe(true);
    for (const value of ["tidak", "Ya", "YA", true, 1, "", undefined]) expect(dtksRegisteredIn({ documents: { dtksRegistered: value } } as DraftFormData), String(value)).toBe(false);
    expect(dtksRegisteredIn(null)).toBe(false);
    expect(dtksRegisteredIn({})).toBe(false);
  });

  test("missingFilesOf: every required slot while nothing is uploaded, then fewer; dtks only when asked", () => {
    expect(missingFilesOf({}, false)).toEqual(requiredSlots(false));
    expect(missingFilesOf({}, true)).toEqual(requiredSlots(true));
    expect(missingFilesOf({ "family-card": 1, "self-photo": 2 }, false)).not.toContain("family-card");
    expect(missingFilesOf({ "family-card": 0 }, false)).toContain("family-card");
    expect(countBySlot([{ slot: "a" }, { slot: "b" }, { slot: "a" }])).toEqual({ a: 2, b: 1 });
  });
});

describe("checkSubmission: the legacy order, then the files (9.1, checks 5 and 5b)", () => {
  const FULL = VALID as unknown as DraftFormData;
  const allFiles = Object.fromEntries(requiredSlots(false).map((slot) => [slot, 1]));

  test("a complete draft with its files passes and hands over the validated values", () => {
    const result = checkSubmission(FULL, allFiles);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.values.identity.fullName).toBe(VALID.identity.fullName);
  });

  test("each missing bucket answers with its own line and step, in the order identity ... interview", () => {
    for (const step of STEP_IDS) {
      const copy: DraftFormData = { ...FULL };
      delete copy[step];
      expect(checkSubmission(copy, allFiles), step).toEqual({ ok: false, step, message: STEP_NOT_SAVED_MESSAGE[step] });
    }
    // Everything missing: identity first.
    expect(checkSubmission({}, {})).toMatchObject({ step: "identity" });
  });

  test("documents' files are checked before the marketing bucket, and marketing's proofs before the interview", () => {
    const noMarketing = { ...FULL };
    delete noMarketing.marketing;
    expect(checkSubmission(noMarketing, {})).toMatchObject({ step: "documents", missingFiles: requiredSlots(false).filter((s) => !s.startsWith("marketing")) });
    const documentsOnly = Object.fromEntries(requiredSlots(false).filter((s) => !s.startsWith("marketing")).map((s) => [s, 1]));
    expect(checkSubmission(noMarketing, documentsOnly)).toEqual({ ok: false, step: "marketing", message: STEP_NOT_SAVED_MESSAGE.marketing });
    const noInterview = { ...FULL };
    delete noInterview.interview;
    expect(checkSubmission(noInterview, documentsOnly)).toMatchObject({ step: "marketing", missingFiles: ["marketing-follow-proof", "marketing-broadcast-proof", "marketing-twibbon-proof", "marketing-story-proof"] });
  });

  test("a deleted or absent file counts for nothing; dtks is required only with a ya", () => {
    const ya: DraftFormData = { ...FULL, documents: { dtksRegistered: "ya" } };
    expect(checkSubmission(ya, allFiles)).toMatchObject({ ok: false, step: "documents", missingFiles: ["dtks"] });
    expect(checkSubmission(ya, { ...allFiles, dtks: 1 }).ok).toBe(true);
    expect(checkSubmission(FULL, { ...allFiles, "self-photo": 0 })).toMatchObject({ step: "documents", missingFiles: ["self-photo"] });
  });

  test("a bucket that no longer passes: the first message, the first failing field", () => {
    const result = checkSubmission({ ...FULL, housing: { ...VALID.housing, motorcycles: 99, cars: 99 } } as DraftFormData, allFiles);
    expect(result).toEqual({ ok: false, step: "housing", message: "Maksimal 50", fields: { motorcycles: "Maksimal 50" } });
  });
});

describe("the application's id and the object's key", () => {
  test("applications/<year>/<application id>/<file id>.<ext> with the extension from the sniffed type, and nothing from the client", () => {
    const base = { year: 2026, applicationId: "app-1", fileId: "file-1" };
    expect(applicationFileKey({ ...base, contentType: "image/png" })).toBe("applications/2026/app-1/file-1.png");
    expect(applicationFileKey({ ...base, contentType: "image/jpeg" })).toBe("applications/2026/app-1/file-1.jpg");
    expect(applicationFileKey({ ...base, contentType: "image/webp" })).toBe("applications/2026/app-1/file-1.webp");
    expect(applicationFileKey({ ...base, contentType: "application/pdf" })).toBe("applications/2026/app-1/file-1.pdf");
    for (const other of ["image/gif", "image/svg+xml", "text/html", "", "../x"]) expect(applicationFileKey({ ...base, contentType: other }), other).toBeNull();
  });
});

describe("form_data version 3", () => {
  test("the version the type and the constant say is 3, and version 2 stays a valid stored shape (compile-time: this file is type-checked)", () => {
    expect(CURRENT_FORM_DATA_VERSION).toBe(3);
    const v2: StudentApplicationFormData = {
      formVersion: 2,
      identity: { nickname: "x", gender: "perempuan", religion: "Islam", homeAddress: "y" },
      household: { livingWith: [], father: { name: "a", occupation: "b", income: 1 }, mother: { name: "a", occupation: "b", income: 1 }, otherEarners: [], familySize: 1 },
      housing: { residenceStatus: "r", buildingArea: 1, motorcycles: 0, cars: 0, debt: null },
      organizations: [],
      documents: { fatherIncomeUrl: null, motherIncomeUrl: null, otherEarner1IncomeUrl: null, otherEarner2IncomeUrl: null, debtProofUrl: null, electricityBillUrl: "u", familyCardUrl: "u", parentPermissionUrl: "u", selfPhotoUrl: "u", dtksRegistered: false, dtksUrl: null, houseImagesUrl: "u", vehicleImagesUrl: "u" },
      marketing: { instagramUsername: "x", instagramFollowProofUrl: "u", broadcastProofUrl: "u", twibbonUploadUrl: "u", storyUploadUrl: "u" },
      interview: { motivationHigherEducation: "a", motivationSakem: "a", consistencyPlan: "a", attendanceCommitment: "a", parentResponse: "a", ifParentChangesMind: "a", agreedToSignedStatement: true },
    };
    expect(v2.formVersion).toBe(2);
  });

  test("what the submit stores is the shared module's output with the agreement as a boolean (the builder keeps the text it was asked with, which the admin's screen would read as 'Tidak')", () => {
    const checked = checkSubmission(VALID as unknown as DraftFormData, Object.fromEntries(requiredSlots(false).map((slot) => [slot, 1])));
    if (!checked.ok) throw new Error("fixture does not pass");
    const built = buildFormData(checked.values);
    const stored = formDataToStore(checked.values);
    expect(stored.formVersion).toBe(3);
    expect(stored.interview.agreedToSignedStatement).toBe(true);
    // Nothing else differs from the builder.
    expect({ ...stored, interview: { ...stored.interview, agreedToSignedStatement: built.interview.agreedToSignedStatement } }).toEqual(built);
    const asStored: StudentApplicationFormData = stored;
    expect(asStored.formVersion).toBe(3);
  });
});

describe("the presenters send explicit field lists (4.3, 5.1, 8.1, 10.1)", () => {
  const NOW = new Date(Date.UTC(2026, 9, 13, 3, 24, 56));

  test("the open batch: six keys, ISO dates", () => {
    expect(presentOpenBatch({ ...BATCH, description: "Teks" })).toEqual({ id: "b1", year: 2026, name: "Gen Uji", description: "Teks", opensAt: "2026-10-01T00:00:00.000Z", closesAt: "2026-11-15T00:00:00.000Z" });
    expect(Object.keys(presentOpenBatch({ ...BATCH, extra: "x", createdBy: "u" } as never)).sort()).toEqual(["closesAt", "description", "id", "name", "opensAt", "year"]);
  });

  test("the overview, in each state of `current`", () => {
    const base = { now: NOW, name: "Sari Dewi", history: [] };
    expect(presentOverview({ ...base, state: null })).toEqual({ now: "2026-10-13T03:24:56.000Z", student: { name: "Sari Dewi", firstName: "Sari" }, openBatch: null, current: { state: "none" }, history: [] });
    expect(presentOverview({ ...base, state: state() }).current).toEqual({ state: "none" });
    expect(presentOverview({ ...base, state: state({ draft: DRAFT }) }).current).toEqual({ state: "draft", updatedAt: "2026-10-05T00:00:00.000Z" });
    expect(presentOverview({ ...base, state: state({ application: { id: "a1", submittedAt: new Date(Date.UTC(2026, 9, 9)) } }) }).current).toEqual({ state: "submitted", submittedAt: "2026-10-09T00:00:00.000Z" });
    const history = presentOverview({ ...base, state: null, history: [{ id: "a1", year: 2025, name: "Gen Lama", submittedAt: new Date(0), publishedAt: new Date(1) }, { id: "a2", year: 2026, name: "Gen Baru", submittedAt: new Date(2), publishedAt: null }] }).history;
    expect(history.map((item) => item.published)).toEqual([true, false]);
    for (const item of history) expect(Object.keys(item).sort()).toEqual(["batch", "id", "published", "submittedAt"]);
  });

  test("files: the order of the form's slots, oldest first within one, the id breaking a tie; PDFs have no size in pixels", () => {
    const f = (id: string, slot: (typeof SLOT_IDS)[number], at: number) => ({ id, slot, contentType: "application/pdf", size: 10, width: null, height: null, createdAt: new Date(at) });
    const shown = presentFiles([f("b", "house-photos", 5), f("a", "house-photos", 5), f("c", "father-income", 9), f("d", "marketing-story-proof", 1), f("e", "house-photos", 2)]);
    expect(shown.map((file) => file.id)).toEqual(["c", "e", "a", "b", "d"]);
    expect(Object.keys(shown[0]!).sort()).toEqual(["contentType", "height", "id", "size", "slot", "uploadedAt", "width"]);
    expect(shown[0]).toMatchObject({ width: null, height: null, uploadedAt: "1970-01-01T00:00:00.009Z" });
  });

  test("the bootstrap in each gate: the draft only when open, the application only when submitted, no files when nothing is open", () => {
    const common = { now: NOW, user: { name: "A", email: "a@example.test", extra: "x" } as { name: string; email: string }, steps: {}, saved: [], missingFiles: [], files: [] };
    const none = presentCurrent({ ...common, gate: "no_open_batch", state: null });
    expect(none).toEqual({ now: "2026-10-13T03:24:56.000Z", gate: "no_open_batch", batch: null, application: null, user: { name: "A", email: "a@example.test" }, draft: null, files: [] });
    const open = presentCurrent({ ...common, gate: "open", state: state({ draft: DRAFT }), saved: ["identity"], steps: { identity: { x: 1 } }, missingFiles: ["family-card"] });
    expect(open.draft).toEqual({ id: "d1", updatedAt: "2026-10-05T00:00:00.000Z", lastStep: "identity", steps: { identity: { x: 1 } }, saved: ["identity"], missingFiles: ["family-card"] });
    expect(open.application).toBeNull();
    const submitted = presentCurrent({ ...common, gate: "submitted", state: state({ application: { id: "a1", submittedAt: new Date(0) }, draft: DRAFT }) });
    expect(submitted.draft).toBeNull();
    expect(submitted.application).toEqual({ id: "a1", submittedAt: "1970-01-01T00:00:00.000Z" });
  });

  test("a status item is built from the result rule: a status that slipped through for an unpublished batch still comes out `processing`", () => {
    const row = { id: "a1", batchId: "b1", year: 2026, name: "Gen Uji", submittedAt: new Date(0), status: "accepted" as const, reviewNotes: "rahasia", publishedAt: null };
    expect(presentStatusItem(row)).toEqual({ id: "a1", batch: { id: "b1", year: 2026, name: "Gen Uji" }, submittedAt: "1970-01-01T00:00:00.000Z", result: { state: "processing" } });
    expect(JSON.stringify(presentStatusItem(row))).not.toContain("rahasia");
  });
});

describe("the confirmation email's template", () => {
  test("the time is in Western Indonesian Time, in Indonesian, without Intl", () => {
    expect(formatWib(Date.UTC(2026, 9, 13, 3, 40))).toBe("13 Oktober 2026 pukul 10.40 WIB");
    expect(formatWib(Date.UTC(2026, 11, 31, 18, 5))).toBe("1 Januari 2027 pukul 01.05 WIB");
    expect(formatWib(Date.UTC(2026, 0, 1, 0, 0))).toBe("1 Januari 2026 pukul 07.00 WIB");
  });

  test("constant subject; the batch name is escaped in the HTML and is never in the subject; one link, to the status page; no token", () => {
    const email = applicationReceivedEmail("siswa@example.test", { batchName: `Gen <b>"6"</b> & 'lain'`, receivedAt: Date.UTC(2026, 9, 13, 3, 40), url: "https://sakola.test/portal/status" });
    expect(email).toMatchObject({ to: "siswa@example.test", purpose: "application-received", subject: "Pendaftaran Sakola Kembara kamu sudah kami terima" });
    expect(email.html).not.toContain("<b>");
    expect(email.html).toContain("Gen &lt;b&gt;&quot;6&quot;&lt;/b&gt; &amp; &#39;lain&#39;");
    expect(email.subject).not.toContain("Gen");
    expect(email.text).toContain("13 Oktober 2026 pukul 10.40 WIB");
    expect(email.text.match(/https?:\/\/\S+/g)).toEqual(["https://sakola.test/portal/status"]);
    expect(email.text).toContain("Hasil seleksi tidak dikirim lewat email");
  });
});
