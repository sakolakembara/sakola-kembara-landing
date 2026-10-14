import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vitest";
import { STEP_IDS, STEP_NOT_SAVED_MESSAGE, type StepId } from "../shared/application-form/steps";
import { auditStatement } from "../src/db/audit";
import { mailbox } from "../src/email/send";
import { dbOf } from "../src/portal/queries";
import portalWorker from "../src/portal/worker";
import type { Bindings } from "../src/env";
import { profileSections } from "../spa/src/pages/applications/answers";
import type { ApplicationDetail } from "../spa/src/pages/applications/model";
import { call, fakeNetwork, freshIp, signedInCookie, uniqueEmail } from "./helpers";
import { limiterBindings, limiterClock, withFrozenDate } from "./limiter-clock";
import { addApplication, addBatch, audit } from "./pendaftaran-helpers";
import { PORTAL_ORIGIN, PORTAL_SECRET, portalCall } from "./portal-helpers";
import {
  addFileRow,
  addRequiredFiles,
  applicationOf,
  captureConsole,
  CURRENT,
  countRows,
  draftOf,
  get,
  json,
  MARKERS,
  OVERVIEW,
  openBatch,
  putStep,
  racing,
  readyToSubmit,
  saveAll,
  STATUS,
  student,
  SUBMIT,
  submit,
  VALID,
} from "./portal-applications-helpers";
import { DAY } from "./public-helpers";

// POST /portal/api/applications/current/submit (docs/cloudflare/portal-api.md, section 9): the order of the checks,
// the transformation to form_data version 3, the one transaction, the double submit, the anti-duplicate window and
// the confirmation email.

afterEach(() => {
  vi.restoreAllMocks();
});

/** A draft written straight into the table, bypassing the route (which would refuse an invalid bucket). */
async function insertDraft(userId: string, batchId: string, formData: Record<string, unknown>) {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO application_drafts (id, user_id, batch_id, form_data, last_step) VALUES (?1, ?2, ?3, ?4, 'identity')").bind(id, userId, batchId, JSON.stringify(formData)).run();
  return id;
}

const complete = (over: Partial<Record<StepId, unknown>> = {}) => ({ ...VALID, ...over }) as Record<string, unknown>;
const without = (step: StepId) => {
  const copy = complete();
  delete copy[step];
  return copy;
};

describe("the checks, in the order of the contract (9.1)", () => {
  test("the body first (cheap, before D1): not JSON 415, too big 413, unparseable 400; the contract's `{}` passes", async () => {
    const who = await student(); // no batch: anything that reaches the gate is a 409
    // Six calls against a limit of three a minute: a new minute before each (the limiter is the test's own clock).
    const send = (init: Parameters<typeof portalCall>[1]) => {
      limiterClock.advance(61_000);
      return portalCall(SUBMIT, { method: "POST", cookie: who.cookie, ...init });
    };
    expect((await send({ headers: { "content-type": "text/plain" }, body: "{}" })).status).toBe(415);
    expect((await send({ headers: { "content-type": "application/json" }, body: "{nope" })).status).toBe(400);
    expect((await send({ headers: { "content-type": "application/json" }, body: "" })).status).toBe(400);
    const big = await send({ headers: { "content-type": "application/json" }, body: JSON.stringify({ pad: "x".repeat(16 * 1024) }) });
    expect(big.status).toBe(413);
    expect(await json(big)).toEqual({ error: "body_too_large", maxBytes: 16 * 1024 });
    expect((await send({ json: {} })).status).toBe(409);
    // No body at all and no content type: not a JSON route call.
    expect((await portalCall(SUBMIT, { method: "POST", cookie: who.cookie })).status).toBe(415);
  });

  test("no batch is open: 409 no_open_batch; a draft whose batch closed: 409 batch_closed; an application already sent: 409 already_submitted", async () => {
    const who = await student();
    const none = await submit(who);
    expect(none.status).toBe(409);
    expect(await json(none)).toEqual({ error: "no_open_batch", message: "Belum ada batch pendaftaran yang dibuka. Silakan kembali saat pendaftaran berikutnya diumumkan." });

    const batch = await openBatch();
    await saveAll(who);
    await env.DB.prepare("UPDATE admission_batches SET opens_at = ?, closes_at = ? WHERE id = ?").bind(Date.now() - 20 * DAY, Date.now() - DAY, batch.id).run();
    const closed = await submit(who);
    expect(closed.status).toBe(409);
    expect((await json(closed)).error).toBe("batch_closed");

    const other = await student("lain");
    const open = await openBatch();
    await addApplication(open.id, { userId: other.id });
    const again = await submit(other);
    expect(again.status).toBe(409);
    expect(await json(again)).toEqual({ error: "already_submitted", message: "Kamu sudah mengirim pendaftaran untuk batch ini. Cek status di halaman Portal Siswa." });
    expect(await countRows("student_applications")).toBe(1);
    expect(await countRows("audit_log")).toBe(0);
  });

  test("a student who saved nothing: 404 no_draft with the legacy sentence", async () => {
    await openBatch();
    const who = await student();
    const res = await submit(who);
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: "no_draft", message: "Belum ada isian yang tersimpan. Isi formulir pendaftaran dulu." });
  });

  test("a bucket that was never saved is the legacy 'belum lengkap' line with its step, for each of the seven (the first missing one answers)", async () => {
    const batch = await openBatch();
    for (const step of STEP_IDS) {
      const who = await student(`tanpa-${step}`);
      const id = await insertDraft(who.id, batch.id, without(step));
      // Every required file is there, so nothing but the missing bucket can be what is wrong.
      await addRequiredFiles(id);
      const res = await submit(who);
      expect(res.status, step).toBe(422);
      expect(await res.json(), step).toEqual({ error: "incomplete", message: STEP_NOT_SAVED_MESSAGE[step], step });
    }
    expect(STEP_NOT_SAVED_MESSAGE).toEqual({
      identity: "Isian identitas belum lengkap.",
      household: "Isian keluarga belum lengkap.",
      housing: "Isian tempat tinggal belum lengkap.",
      organizations: "Isian organisasi belum lengkap.",
      documents: "Isian berkas belum lengkap.",
      marketing: "Isian marketing belum lengkap.",
      interview: "Isian interview belum lengkap.",
    });
  });

  test("a bucket that no longer passes: 422 with its step, the first message of its rules, and the first failing field", async () => {
    const batch = await openBatch();
    const who = await student();
    const id = await insertDraft(who.id, batch.id, complete({ household: { ...VALID.household, fatherIncome: "Rp1.200.000", familySize: 0 } }));
    await addRequiredFiles(id);
    const res = await submit(who);
    expect(res.status).toBe(422);
    expect(await json(res)).toEqual({ error: "incomplete", message: 'Hilangkan "Rp". Contoh benar: 1.200.000', step: "household", fields: { fatherIncome: 'Hilangkan "Rp". Contoh benar: 1.200.000' } });
  });

  test("a stored bucket that is not even an object: 422 with the generic line and no field", async () => {
    const batch = await openBatch();
    const who = await student();
    const id = await insertDraft(who.id, batch.id, complete({ housing: "bukan objek" }));
    await addRequiredFiles(id);
    const res = await submit(who);
    expect(res.status).toBe(422);
    expect(await json(res)).toEqual({ error: "incomplete", message: "Periksa kembali isian formulir.", step: "housing", fields: {} });
  });

  test("two buckets are wrong: the first in the legacy order answers (identity, household, housing, organizations, documents, marketing, interview)", async () => {
    const batch = await openBatch();
    // interview invalid, identity missing: identity.
    const a = await student("a");
    await insertDraft(a.id, batch.id, { ...without("identity"), interview: { ...VALID.interview, agreedToSignedStatement: "tidak" } });
    expect((await json(await submit(a))).step).toBe("identity");
    // housing invalid, interview missing: housing.
    const b = await student("b");
    await insertDraft(b.id, batch.id, { ...without("interview"), housing: { ...VALID.housing, cars: 99 } });
    expect((await json(await submit(b))).step).toBe("housing");
    // interview refuses the agreement: the legacy sentence.
    const c = await student("c");
    const id = await insertDraft(c.id, batch.id, complete({ interview: { ...VALID.interview, agreedToSignedStatement: "tidak" } }));
    await addRequiredFiles(id);
    const refused = await submit(c);
    expect(await json(refused)).toMatchObject({ step: "interview", message: "Pendaftaran hanya dapat dilanjutkan jika kamu bersedia menandatangani surat pernyataan bermaterai." });
  });

  test("5b: once `documents` passes its required files must be there; the message lists their labels, and `missingFiles` their ids", async () => {
    const batch = await openBatch();
    const who = await student();
    const id = await insertDraft(who.id, batch.id, complete());
    await addFileRow(id, "electricity-bill");
    await addFileRow(id, "parent-permission");
    await addFileRow(id, "house-photos");
    await addFileRow(id, "vehicle-photos");
    const res = await submit(who);
    expect(res.status).toBe(422);
    expect(await json(res)).toEqual({
      error: "incomplete",
      message: "Berkas wajib belum lengkap: Scan Kartu Keluarga, Foto Diri.",
      step: "documents",
      missingFiles: ["family-card", "self-photo"],
    });
  });

  test("5b: `dtks` is required only when the student said ya, and a deleted file does not count", async () => {
    const batch = await openBatch();
    const who = await student();
    const id = await insertDraft(who.id, batch.id, complete({ documents: { dtksRegistered: "ya" } }));
    await addRequiredFiles(id);
    const missing = await (await submit(who)).json();
    expect(missing).toMatchObject({ step: "documents", missingFiles: ["dtks"], message: "Berkas wajib belum lengkap: Surat Keterangan Tidak Mampu (SKTM) terdaftar DTKS." });
    await addFileRow(id, "dtks", { deletedAt: Date.now() });
    expect((await json(await submit(who))).missingFiles).toEqual(["dtks"]);
  });

  test("5b: the marketing proofs are checked after the marketing bucket passes and before the interview", async () => {
    const batch = await openBatch();
    const who = await student();
    // Interview missing AND two proofs missing: the proofs answer (marketing comes first).
    const id = await insertDraft(who.id, batch.id, without("interview"));
    await addRequiredFiles(id);
    await env.DB.prepare("UPDATE application_files SET deleted_at = ? WHERE application_id = ? AND slot IN ('marketing-twibbon-proof', 'marketing-story-proof')").bind(Date.now(), id).run();
    const res = await submit(who);
    expect(res.status).toBe(422);
    expect(await json(res)).toEqual({
      error: "incomplete",
      message: "Berkas wajib belum lengkap: Bukti Upload Twibbon di Feed Instagram, Bukti Share Poster di Story Instagram.",
      step: "marketing",
      missingFiles: ["marketing-twibbon-proof", "marketing-story-proof"],
    });
  });

  test("5b: the documents' files are checked after the documents bucket and BEFORE the marketing bucket (documents come first)", async () => {
    const batch = await openBatch();
    const who = await student();
    const id = await insertDraft(who.id, batch.id, without("marketing"));
    await addFileRow(id, "electricity-bill");
    const res = await submit(who);
    expect((await json(res)).step).toBe("documents");
    await addRequiredFiles(id);
    expect(await json(await submit(who))).toMatchObject({ step: "marketing", message: "Isian marketing belum lengkap." });
  });

  test("the soft anti-duplicate: another student's application with the same WhatsApp number in the last hour is 409 duplicate_whatsapp (identity); older than an hour, or another number, is fine", async () => {
    const batch = await openBatch();
    const lain = await student("lain");
    await addApplication(batch.id, { userId: lain.id, whatsapp: VALID.identity.whatsapp as string, submittedAt: new Date(Date.now() - 30 * 60_000) });
    const { who } = await ready();
    const res = await submit(who);
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({ error: "duplicate_whatsapp", message: "Pendaftaran dari nomor WhatsApp ini baru saja dikirim. Mohon tunggu sebelum mencoba lagi.", step: "identity" });
    expect(await countRows("student_applications")).toBe(1);
    expect(await countRows("audit_log")).toBe(0);
    expect((await draftOf(who.id))?.user_id).toBe(who.id);
  });

  test("the window is exactly one hour, measured on the server's clock: an application at now - 1 h still counts, one millisecond older does not", async () => {
    const batch = await openBatch();
    const lain = await student("lain");
    const { who } = await ready();
    await withFrozenDate(async (clock) => {
      const rival = await addApplication(batch.id, { userId: lain.id, whatsapp: VALID.identity.whatsapp as string, submittedAt: new Date(clock.now - 60 * 60_000) });
      expect((await submit(who)).status, "at exactly one hour").toBe(409);
      await env.DB.prepare("UPDATE student_applications SET submitted_at = ? WHERE id = ?").bind(clock.now - 60 * 60_000 - 1, rival.id).run();
      expect((await submit(who)).status, "one millisecond past it").toBe(201);
    });
  });

  test("another number is not a duplicate, and neither is the same number of an application that was not sent in the last hour", async () => {
    const batch = await openBatch();
    const lain = await student("lain");
    await addApplication(batch.id, { userId: lain.id, whatsapp: "6289999999999", submittedAt: new Date(Date.now() - 60_000) });
    const old = await student("lama");
    const oldBatch = await addBatch({ opensAt: new Date(Date.now() - 80 * DAY), closesAt: new Date(Date.now() - 60 * DAY) });
    await addApplication(oldBatch.id, { userId: old.id, whatsapp: VALID.identity.whatsapp as string, submittedAt: new Date(Date.now() - 2 * 3600_000) });
    const { who } = await ready();
    expect((await submit(who)).status).toBe(201);
  });
});

/** A student with a complete draft and its files, on an open batch. */
async function ready() {
  const who = await student();
  await saveAll(who);
  const draft = (await draftOf(who.id))!;
  await addRequiredFiles(draft.id);
  return { who, draft };
}

describe("a complete application is submitted", () => {
  test("201 with the application's id (the draft's), the time and the batch; one row, one audit row, no draft; the files are untouched", async () => {
    const { batch, who, draft } = await readyToSubmit();
    const res = await submit(who);
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(Object.keys(body).sort()).toEqual(["applicationId", "batch", "submittedAt"]);
    expect(body.applicationId).toBe(draft.id);
    expect(body.batch).toEqual({ id: batch.id, year: batch.year, name: batch.name });
    expect(Math.abs(Date.parse(body.submittedAt) - Date.now())).toBeLessThan(10_000);

    const row = (await applicationOf(who.id))!;
    expect(row).toMatchObject({
      id: draft.id,
      user_id: who.id,
      batch_id: batch.id,
      full_name: MARKERS.fullName,
      email: who.email.toLowerCase(),
      whatsapp: MARKERS.whatsapp,
      school_name: MARKERS.school,
      graduation_year: "2027 (Kelas 12)",
      branch_preference: "Cililin",
      motivation: null,
      economic_background: null,
      status: "pending",
      review_notes: null,
      reviewed_by: null,
      reviewed_at: null,
    });
    expect(new Date(row.submitted_at).toISOString()).toBe(body.submittedAt);
    expect(row.updated_at).toBe(row.submitted_at);
    expect(await draftOf(who.id)).toBeNull();
    expect(await countRows("student_applications")).toBe(1);
    expect(await countRows("application_drafts")).toBe(0);
    // The files were uploaded against the draft's id, which is now the application's: no row moved.
    expect((await env.DB.prepare("SELECT count(*) AS n FROM application_files WHERE application_id = ?").bind(draft.id).first<{ n: number }>())!.n).toBe(10);
  });

  test("form_data is version 3, written exactly as the contract says: rupiah to numbers, earners, debt, organizations (the empty row dropped), documents and marketing without links", async () => {
    const batch = await openBatch();
    const who = await student();
    const household = {
      ...VALID.household,
      livingWith: ["Ayah", "Ibu", "Nenek"],
      hasOtherEarner1: true,
      earner1Relation: "Kakak",
      earner1Income: "2.500.000",
      hasOtherEarner2: true,
      earner2Relation: "Paman/Bibi",
      earner2Income: "800000",
      familySize: "5",
    };
    const housing = { residenceStatus: "Mengontrak/Menyewa", buildingArea: "42", motorcycles: 2, cars: 0, hasDebt: true, debtType: "KUR", debtAmount: "15.000.000", debtInstallmentMonths: "24", debtDescription: "Untuk usaha orang tua" };
    const organizations = { hasOrganizations: true, entries: [{ name: "OSIS", position: "Ketua" }, { name: "", position: "" }, { name: "Karang Taruna", position: "Anggota" }] };
    await saveAll(who, { household, housing, organizations, documents: { dtksRegistered: "ya" } });
    const draft = (await draftOf(who.id))!;
    await addRequiredFiles(draft.id, { dtks: true });
    expect((await submit(who)).status).toBe(201);

    const stored = JSON.parse((await applicationOf(who.id))!.form_data);
    expect(stored).toEqual({
      formVersion: 3,
      identity: { nickname: "Rahasia", gender: "perempuan", religion: "Islam", homeAddress: MARKERS.address },
      household: {
        livingWith: ["Ayah", "Ibu", "Nenek"],
        father: { name: MARKERS.fatherName, occupation: "Petani", income: 1_200_000 },
        mother: { name: "Ibu Rahasia", occupation: "Ibu rumah tangga", income: 0 },
        otherEarners: [{ relation: "Kakak", income: 2_500_000 }, { relation: "Paman/Bibi", income: 800_000 }],
        familySize: 5,
      },
      housing: { residenceStatus: "Mengontrak/Menyewa", buildingArea: 42, motorcycles: 2, cars: 0, debt: { type: "KUR", amount: 15_000_000, installmentMonths: 24, description: "Untuk usaha orang tua" } },
      organizations: [{ name: "OSIS", position: "Ketua" }, { name: "Karang Taruna", position: "Anggota" }],
      documents: { dtksRegistered: true },
      marketing: { instagramUsername: "rahasia.contoh" },
      interview: { ...VALID.interview, agreedToSignedStatement: true },
    });
    // Nothing of the legacy links is there.
    expect(JSON.stringify(stored)).not.toMatch(/Url"/);
    expect((await applicationOf(who.id))!.batch_id).toBe(batch.id);
  });

  test("the agreement is stored as the boolean true, and the admin's Pendaftar detail (the real admin route, read by the screen's own rules) shows 'Siap Materai: Ya'", async () => {
    const { who } = await readyToSubmit();
    expect((await submit(who)).status).toBe(201);

    // The draft holds the wizard's value, the application the boolean.
    const row = (await applicationOf(who.id))!;
    expect(JSON.parse(row.form_data).interview.agreedToSignedStatement).toBe(true);

    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["pendaftaran"]);
    const detail = await call(`/api/admin/applications/${row.id}`, { cookie });
    expect(detail.status).toBe(200);
    const { item } = (await detail.json()) as { item: ApplicationDetail };
    expect(item.formData).toMatchObject({ formVersion: 3, interview: { agreedToSignedStatement: true } });
    const answer = profileSections(item)
      .flatMap((section) => section.rows)
      .find((candidate) => candidate.label === "Siap Materai");
    expect(answer?.value).toEqual({ type: "text", text: "Ya" });
  });

  test("no debt, no organizations, no other earners: debt is null, organizations is [], otherEarners is []", async () => {
    const { who } = await readyToSubmit();
    expect((await submit(who)).status).toBe(201);
    const stored = JSON.parse((await applicationOf(who.id))!.form_data);
    expect(stored.housing.debt).toBeNull();
    expect(stored.organizations).toEqual([]);
    expect(stored.household.otherEarners).toEqual([]);
    expect(stored.documents).toEqual({ dtksRegistered: false });
  });

  test("the audit row: one, `application.submit`, resource `application`, the student as actor, and ONLY the batch id and year as metadata (no school, no branch, no name)", async () => {
    const { batch, who, draft } = await readyToSubmit();
    await submit(who);
    const rows = await audit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_email: who.email.toLowerCase(), action: "application.submit", resource_type: "application", resource_id: draft.id });
    expect(JSON.parse(rows[0]!.metadata as string)).toEqual({ batchId: batch.id, batchYear: batch.year });
    const stored = await env.DB.prepare("SELECT actor_id FROM audit_log").first<{ actor_id: string }>();
    expect(stored!.actor_id).toBe(who.id);
    const text = JSON.stringify(rows);
    for (const secret of [MARKERS.school, MARKERS.fullName, MARKERS.whatsapp, MARKERS.address, "Cililin"]) expect(text, secret).not.toContain(secret);
  });

  test("the audit row is the row `auditStatement` writes for the same entry (the raw statement of the submit cannot drift from the helper)", async () => {
    const { batch, who, draft } = await readyToSubmit();
    await submit(who);
    const fromRoute = (await env.DB.prepare("SELECT * FROM audit_log WHERE action = 'application.submit'").first<Record<string, unknown>>())!;
    await env.DB.prepare("DELETE FROM audit_log").run();
    await auditStatement(dbOf(env.DB), { id: who.id, email: who.email }, { action: "application.submit", resourceType: "application", resourceId: draft.id, metadata: { batchId: batch.id, batchYear: batch.year } });
    const fromHelper = (await env.DB.prepare("SELECT * FROM audit_log").first<Record<string, unknown>>())!;
    expect(Object.keys(fromRoute).sort()).toEqual(Object.keys(fromHelper).sort());
    for (const key of Object.keys(fromHelper)) {
      if (key === "id" || key === "created_at") continue;
      expect(fromRoute[key], key).toEqual(fromHelper[key]);
    }
    expect(typeof fromRoute.created_at).toBe(typeof fromHelper.created_at);
    expect(Math.abs((fromRoute.created_at as number) - Date.now())).toBeLessThan(10_000);
  });

  test("after it: the bootstrap says submitted, the overview too, and the status page has the application, still `processing`", async () => {
    const { batch, who, draft } = await readyToSubmit();
    const sent = await json(await submit(who));
    const current = await json(await get(CURRENT, who));
    expect(current).toMatchObject({ gate: "submitted", draft: null, application: { id: draft.id, submittedAt: sent.submittedAt } });
    expect(current.files).toHaveLength(10);
    const overview = await json(await get(OVERVIEW, who));
    expect(overview.current).toEqual({ state: "submitted", submittedAt: sent.submittedAt });
    expect(overview.history).toEqual([{ id: draft.id, batch: { year: batch.year, name: batch.name }, submittedAt: sent.submittedAt, published: false }]);
    expect((await json(await get(STATUS, who))).items).toEqual([{ id: draft.id, batch: { id: batch.id, year: batch.year, name: batch.name }, submittedAt: sent.submittedAt, result: { state: "processing" } }]);
  });

  test("a second submit is 409 already_submitted and changes nothing; so does a step save", async () => {
    const { who } = await readyToSubmit();
    expect((await submit(who)).status).toBe(201);
    const again = await submit(who);
    expect(again.status).toBe(409);
    expect((await json(again)).error).toBe("already_submitted");
    expect((await putStep(who, "identity", VALID.identity)).status).toBe(409);
    expect(await countRows("student_applications")).toBe(1);
    expect(await countRows("audit_log")).toBe(1);
    expect(await countRows("application_drafts")).toBe(0);
  });

  test("a double click (two submits at once): one 201, one 409 already_submitted, one application, one audit row, one email", async () => {
    const { who } = await readyToSubmit();
    const [one, two] = await Promise.all([submit(who), submit(who)]);
    expect([one.status, two.status].sort()).toEqual([201, 409]);
    const refused = one.status === 409 ? one : two;
    expect((await json(refused)).error).toBe("already_submitted");
    expect(await countRows("student_applications")).toBe(1);
    expect(await countRows("audit_log")).toBe(1);
    expect(mailbox.messages.filter((m) => m.purpose === "application-received")).toHaveLength(1);
  });

  test("a student's submit does not touch another student's draft or application", async () => {
    const { who } = await readyToSubmit("ana");
    const budi = await student("budi");
    await putStep(budi, "identity", { ...VALID.identity, whatsapp: "6282222222222" });
    const before = await draftOf(budi.id);
    expect((await submit(who)).status).toBe(201);
    expect(await draftOf(budi.id)).toEqual(before);
    expect(await applicationOf(budi.id)).toBeNull();
    expect((await json(await get(CURRENT, budi))).gate).toBe("open");
  });
});

describe("one transaction: a draft that changed, vanished or was submitted writes nothing", () => {
  const nothingWritten = async () => {
    expect(await countRows("student_applications")).toBe(0);
    expect(await countRows("audit_log")).toBe(0);
    expect(mailbox.messages.filter((m) => m.purpose === "application-received")).toHaveLength(0);
  };

  test("a step saved after the check: 409 draft_changed, no application, no audit row, no email, and the draft is still there", async () => {
    const { who, draft } = await readyToSubmit();
    const db = racing(env.DB, /INSERT INTO student_applications/, () => env.DB.prepare("UPDATE application_drafts SET updated_at = updated_at + 5 WHERE id = ?").bind(draft.id).run());
    const res = await submit(who, { env: { DB: db } });
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({ error: "draft_changed", message: "Isianmu berubah saat dikirim. Periksa lagi lalu kirim ulang." });
    await nothingWritten();
    expect((await draftOf(who.id))?.id).toBe(draft.id);
  });

  test("a real step save between the check and the write is caught the same way", async () => {
    const { who } = await readyToSubmit();
    const db = racing(env.DB, /INSERT INTO student_applications/, async () => void (await putStep(who, "marketing", { instagramUsername: "baru.saja" })));
    const res = await submit(who, { env: { DB: db } });
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("draft_changed");
    await nothingWritten();
    // And the student's next submit, on what they saved, goes through.
    expect((await submit(who)).status).toBe(201);
  });

  test("a draft that vanished after the check: 409 draft_changed and nothing is written", async () => {
    const { who, draft } = await readyToSubmit();
    const db = racing(env.DB, /INSERT INTO student_applications/, () => env.DB.prepare("DELETE FROM application_drafts WHERE id = ?").bind(draft.id).run());
    const res = await submit(who, { env: { DB: db } });
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("draft_changed");
    await nothingWritten();
  });

  test("a second submit that won the race: this one answers already_submitted and writes nothing of its own (one application, one audit row)", async () => {
    const { who, draft } = await readyToSubmit();
    // What the other request's batch leaves behind: the application with the draft's id, the draft gone, one audit row.
    const db = racing(env.DB, /INSERT INTO student_applications/, async () => {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO student_applications (id, user_id, batch_id, full_name, email, whatsapp, school_name, graduation_year) SELECT id, user_id, batch_id, 'X', 'x@example.test', '62812', 'S', '2027' FROM application_drafts WHERE id = ?").bind(draft.id),
        env.DB.prepare("DELETE FROM application_drafts WHERE id = ?").bind(draft.id),
      ]);
    });
    const res = await submit(who, { env: { DB: db } });
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("already_submitted");
    expect(await countRows("student_applications")).toBe(1);
    expect(await countRows("audit_log")).toBe(0);
    expect(mailbox.messages.filter((m) => m.purpose === "application-received")).toHaveLength(0);
  });

  test("the batch closes between the check and the write: nothing is written, and the answer is batch_closed", async () => {
    const { batch, who } = await readyToSubmit();
    const db = racing(env.DB, /INSERT INTO student_applications/, () => env.DB.prepare("UPDATE admission_batches SET closes_at = ? WHERE id = ?").bind(Date.now() - 1000, batch.id).run());
    const res = await submit(who, { env: { DB: db } });
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("batch_closed");
    await nothingWritten();
  });

  test("the unique index is the last line: an application that exists for the pair (a state the route never makes) refuses the insert and the whole batch, and the answer is already_submitted", async () => {
    const { batch, who } = await readyToSubmit();
    const db = racing(env.DB, /INSERT INTO student_applications/, async () => void (await addApplication(batch.id, { userId: who.id })));
    const res = await submit(who, { env: { DB: db } });
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("already_submitted");
    expect(await countRows("student_applications")).toBe(1);
    expect(await countRows("audit_log")).toBe(0);
    expect(await draftOf(who.id)).not.toBeNull();
  });
});

describe("the confirmation email", () => {
  /** Calls the Worker with a context of the test's own, so what happens before and after `waitUntil` can be told apart. */
  async function submitWithContext(cookie: string, overrides: Partial<Bindings> = {}) {
    const ctx = createExecutionContext();
    const headers = new Headers({ cookie, origin: PORTAL_ORIGIN, "cf-connecting-ip": freshIp(), "content-type": "application/json" });
    const res = await portalWorker.fetch!(new Request(`${PORTAL_ORIGIN}${SUBMIT}`, { method: "POST", headers, body: "{}" }), { ...env, BETTER_AUTH_SECRET: PORTAL_SECRET, ...limiterBindings(), ...overrides } as Bindings, ctx);
    return { res, finish: () => waitOnExecutionContext(ctx) };
  }

  test("it is sent AFTER the answer (waitUntil): when the 201 is out nothing has been sent yet", async () => {
    const { who } = await readyToSubmit();
    mailbox.clear();
    const { res, finish } = await submitWithContext(who.cookie);
    expect(res.status).toBe(201);
    expect(mailbox.messages.filter((m) => m.purpose === "application-received")).toHaveLength(0);
    await finish();
    expect(mailbox.messages.filter((m) => m.purpose === "application-received")).toHaveLength(1);
  });

  test("one email to the account, the constant subject, the batch name, the time received, the status link and nothing of the application", async () => {
    const { batch, who } = await readyToSubmit();
    mailbox.clear();
    await submit(who);
    const sent = mailbox.messages.filter((m) => m.purpose === "application-received");
    expect(sent).toHaveLength(1);
    const email = sent[0]!;
    expect(email.to).toBe(who.email);
    expect(email.subject).toBe("Pendaftaran Sakola Kembara kamu sudah kami terima");
    for (const part of [email.text, email.html]) {
      expect(part).toContain(batch.name);
      expect(part).toContain(`${PORTAL_ORIGIN}/portal/status`);
      expect(part).toMatch(/\d{1,2} \w+ 20\d\d pukul \d\d\.\d\d WIB/);
      expect(part).toContain("tidak perlu mengirim ulang berkas");
      // No answer, no file, no document name, no token.
      for (const secret of [MARKERS.fullName, MARKERS.whatsapp, MARKERS.address, MARKERS.school, MARKERS.fatherName, MARKERS.answer, "Cililin", "Kartu Keluarga", "SKTM", "token"]) expect(part, secret).not.toContain(secret);
    }
    expect(email.subject).not.toContain(batch.name);
  });

  test("the link points at the origin the student used (a workers.dev staging host works the same)", async () => {
    const { who } = await readyToSubmit();
    mailbox.clear();
    const res = await portalCall(SUBMIT, { method: "POST", cookie: who.cookie, json: {} });
    expect(res.status).toBe(201);
    expect(mailbox.messages.at(-1)!.text).toContain("https://sakola.test/portal/status");
  });

  test("the provider answers 500: the submit is still 201 and saved, and the log names the purpose and the status only", async () => {
    const { who, draft } = await readyToSubmit();
    const network = fakeNetwork();
    network.resendStatus = 500;
    const { lines, restore } = captureConsole();
    let res: Response;
    try {
      res = await submit(who, { env: { RESEND_API_KEY: "re_test_key", EMAIL_FROM: "Sakola <no-reply@sakola.test>" } });
    } finally {
      restore();
    }
    expect(res.status).toBe(201);
    expect(network.resend).toHaveLength(1);
    expect((await applicationOf(who.id))?.id).toBe(draft.id);
    const text = lines.join("\n");
    expect(text).toContain("application-received");
    expect(text).toContain("HTTP 500");
    for (const secret of [who.email, MARKERS.fullName, "re_test_key", "sakola.test"]) expect(text, secret).not.toContain(secret);
  });

  test("the provider is unreachable (fetch rejects): the submit is still 201", async () => {
    const { who } = await readyToSubmit();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network is down"));
    const res = await submit(who, { env: { RESEND_API_KEY: "re_test_key", EMAIL_FROM: "Sakola <no-reply@sakola.test>" } });
    expect(res.status).toBe(201);
    expect(await countRows("student_applications")).toBe(1);
  });

  test("a submit that is refused sends nothing", async () => {
    const who = await student();
    await openBatch();
    mailbox.clear();
    expect((await submit(who)).status).toBe(404);
    expect(mailbox.messages.filter((m) => m.purpose === "application-received")).toHaveLength(0);
  });
});

describe("what the common checks say for a submit", () => {
  test("an unverified address: 403 email_not_verified with the submit's own sentence", async () => {
    const who = await student();
    await env.DB.prepare("UPDATE users SET email_verified = 0 WHERE id = ?").bind(who.id).run();
    const res = await submit(who);
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({ error: "email_not_verified", message: "Verifikasi email kamu dulu sebelum mengirim pendaftaran." });
    // Every other route keeps the guard's sentence.
    const other = await get(OVERVIEW, who);
    expect((await json(other)).message).toBe("Verifikasi email kamu dulu sebelum melanjutkan. Cek inbox atau folder spam untuk tautan verifikasi.");
  });

  test("an admin account keeps the guard's student_only refusal", async () => {
    const who = await student();
    await env.DB.prepare("UPDATE users SET role = 'editor' WHERE id = ?").bind(who.id).run();
    const res = await submit(who);
    expect(res.status).toBe(403);
    expect((await json(res)).error).toBe("student_only");
  });

  test("the limiter: the legacy sentence, three a minute", async () => {
    const who = await student();
    for (let i = 0; i < 3; i++) expect((await submit(who)).status).toBe(409);
    const refused = await submit(who);
    expect(refused.status).toBe(429);
    expect(await json(refused)).toEqual({ error: "rate_limited", message: "Terlalu banyak percobaan pengiriman. Silakan tunggu beberapa menit lalu coba lagi.", retryAfterSeconds: 60 });
  });
});

describe("privacy: a whole application, from the first step to the status page, leaves no answer in a console line", () => {
  test("no name, number, address, school, answer, email address or id in any line", async () => {
    const { lines, restore } = captureConsole();
    let who: Awaited<ReturnType<typeof student>>;
    try {
      await openBatch();
      who = await student();
      await saveAll(who);
      await putStep(who, "identity", { ...VALID.identity, fullName: "x" }); // a refused step
      const draft = (await draftOf(who.id))!;
      await addRequiredFiles(draft.id);
      await submit(who);
      await submit(who); // a refused submit
      for (const path of [OVERVIEW, CURRENT, STATUS]) await get(path, who);
    } finally {
      restore();
    }
    const text = lines.join("\n");
    for (const secret of [MARKERS.fullName, MARKERS.whatsapp, MARKERS.address, MARKERS.school, MARKERS.fatherName, MARKERS.answer, who!.email, who!.id, "Rahasia"]) {
      expect(text, secret).not.toContain(secret);
    }
  });
});

