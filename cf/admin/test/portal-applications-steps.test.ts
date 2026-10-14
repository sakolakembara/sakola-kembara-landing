import { env } from "cloudflare:workers";
import { describe, expect, test, vi } from "vitest";
import { JSON_BODY_MAX_BYTES, STEP_BODY_MAX_BYTES } from "../shared/application-form/limits";
import { SLOT_IDS } from "../shared/application-form/slots";
import { STEP_IDS } from "../shared/application-form/steps";
import { applicationFileKey } from "../src/portal/rules";
import { addApplication, addBatch } from "./pendaftaran-helpers";
import { portalCall } from "./portal-helpers";
import {
  addFileRow,
  applicationOf,
  captureConsole,
  CURRENT,
  countRows,
  draftOf,
  get,
  json,
  openBatch,
  putStep,
  racing,
  saveAll,
  setStorage,
  stepPath,
  storage,
  student,
  VALID,
} from "./portal-applications-helpers";
import { DAY } from "./public-helpers";

// PUT /portal/api/applications/current/steps/:step (docs/cloudflare/portal-api.md, section 8): the order of the checks
// (the step name, the gate, the body, the rules, the write), what is stored, and what a step save never touches. The
// field rules and every message of section 7 are pinned by test/portal-foundation-form.test.ts, which runs the same
// functions: here a few of them go through the route to show the route runs them and writes nothing when they fail.

const formOf = async (userId: string) => JSON.parse((await draftOf(userId))!.form_data) as Record<string, any>;

describe("the order of the checks: the step name, the gate, the body, the rules, the write", () => {
  test("a step that is not one of the seven is 404 unknown_step, before the gate and the body", async () => {
    const who = await student(); // no batch is open: a known step would be a 409
    for (const step of ["", "identitas", "Identity", "IDENTITY", "interview2", "__proto__", "constructor", "../me", "identity%2f", "marketing%20"]) {
      const res = await portalCall(stepPath(step || "%20"), { method: "PUT", cookie: who.cookie, json: {} });
      expect(res.status, JSON.stringify(step)).toBe(404);
    }
    const res = await putStep(who, "nope", { x: 1 });
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: "unknown_step" });
  });

  test("no batch is open: 409 no_open_batch with the legacy sentence, whatever the body is, and nothing is written", async () => {
    const who = await student();
    for (const res of [await putStep(who, "identity", VALID.identity), await putStep(who, "identity", { rubbish: true }), await portalCall(stepPath("identity"), { method: "PUT", cookie: who.cookie, headers: { "content-type": "text/plain" }, body: "x" })]) {
      expect(res.status).toBe(409);
      expect(await json(res)).toEqual({ error: "no_open_batch", message: "Belum ada batch pendaftaran yang dibuka. Silakan kembali saat pendaftaran berikutnya diumumkan." });
    }
    expect(await countRows("application_drafts")).toBe(0);
  });

  test("a batch that has not opened yet, or has closed, is not open (409 no_open_batch)", async () => {
    const who = await student();
    await addBatch({ opensAt: new Date(Date.now() + DAY), closesAt: new Date(Date.now() + 5 * DAY) });
    await addBatch({ opensAt: new Date(Date.now() - 9 * DAY), closesAt: new Date(Date.now() - DAY) });
    const res = await putStep(who, "identity", VALID.identity);
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("no_open_batch");
    expect(await countRows("application_drafts")).toBe(0);
  });

  test("a draft whose batch closed after the student started: 409 batch_closed (it stays in D1, unchanged)", async () => {
    const batch = await openBatch();
    const who = await student();
    expect((await putStep(who, "identity", VALID.identity)).status).toBe(200);
    const before = await draftOf(who.id);
    await env.DB.prepare("UPDATE admission_batches SET opens_at = ?, closes_at = ? WHERE id = ?").bind(Date.now() - 20 * DAY, Date.now() - DAY, batch.id).run();
    const res = await putStep(who, "household", VALID.household);
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({ error: "batch_closed", message: "Pendaftaran untuk batch ini sudah ditutup. Isianmu tidak bisa disimpan atau dikirim." });
    expect(await draftOf(who.id)).toEqual(before);
  });

  test("a student who has an application for the batch: 409 already_submitted, and no second draft is opened", async () => {
    const batch = await openBatch();
    const who = await student();
    await addApplication(batch.id, { userId: who.id });
    const res = await putStep(who, "identity", VALID.identity);
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({ error: "already_submitted", message: "Kamu sudah mengirim pendaftaran untuk batch ini. Cek status di halaman Portal Siswa." });
    expect(await countRows("application_drafts")).toBe(0);
  });

  test("the gate is checked before the body: a bad body on a closed door is the 409, not a 415, 413 or 400", async () => {
    const who = await student();
    const res = await portalCall(stepPath("identity"), { method: "PUT", cookie: who.cookie, headers: { "content-type": "application/json" }, body: "{not json" });
    expect(res.status).toBe(409);
  });

  test("the body: 415 json_required for anything but application/json, 400 invalid_json for a body that is not JSON", async () => {
    await openBatch();
    const who = await student();
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "application/xml", ""]) {
      const res = await portalCall(stepPath("identity"), { method: "PUT", cookie: who.cookie, headers: type ? { "content-type": type } : {}, body: JSON.stringify(VALID.identity) });
      expect(res.status, type || "(none)").toBe(415);
      expect(await res.json(), type || "(none)").toEqual({ error: "json_required" });
    }
    for (const body of ["{not json", "", "{", "undefined", '{"a":1}}']) {
      const res = await portalCall(stepPath("identity"), { method: "PUT", cookie: who.cookie, headers: { "content-type": "application/json" }, body });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json(), JSON.stringify(body)).toEqual({ error: "invalid_json" });
    }
    expect(await countRows("application_drafts")).toBe(0);
  });

  test("the body is at most 32 KiB, counted in bytes: the declared length refuses at once, and a body that declares nothing (or lies) is cut at the limit", async () => {
    await openBatch();
    const who = await student();
    const pad = (bytes: number) => {
      const base = JSON.stringify({ ...VALID.interview, pad: "" });
      return JSON.stringify({ ...VALID.interview, pad: "x".repeat(bytes - new TextEncoder().encode(base).length) });
    };
    const exact = pad(STEP_BODY_MAX_BYTES);
    const over = pad(STEP_BODY_MAX_BYTES + 1);
    expect(new TextEncoder().encode(exact).length).toBe(STEP_BODY_MAX_BYTES);
    expect(STEP_BODY_MAX_BYTES).toBe(32 * 1024);

    const send = (body: string, declared?: string) =>
      portalCall(stepPath("interview"), { method: "PUT", cookie: who.cookie, headers: { "content-type": "application/json", ...(declared ? { "content-length": declared } : {}) }, body });
    // Exactly at the limit passes the size check (the unknown key is dropped, the rest is valid).
    expect((await send(exact)).status).toBe(200);
    expect(Object.keys((await formOf(who.id)).interview)).not.toContain("pad");
    // Over it: by the declared length, and by the stream when nothing is declared.
    for (const res of [await send(over, String(STEP_BODY_MAX_BYTES + 1)), await send(over)]) {
      expect(res.status).toBe(413);
      expect(await json(res)).toEqual({ error: "body_too_large", maxBytes: STEP_BODY_MAX_BYTES });
    }
    // A lie about the length (a small number on a big body): the body is a mismatch for the runtime, and never reaches the rules as a big one.
    expect((await send("x".repeat(STEP_BODY_MAX_BYTES * 2), "10")).status).not.toBe(200);
    // Multi-byte text counts in bytes: 16,400 characters of three bytes each are over, though under the limit as characters.
    const multi = JSON.stringify({ ...VALID.interview, pad: "é".repeat(STEP_BODY_MAX_BYTES / 2 + 100) });
    expect((await send(multi)).status).toBe(413);
  });

  test("a body that is JSON but not an object is 400 invalid with no field", async () => {
    await openBatch();
    const who = await student();
    for (const body of [[], 42, "text", null, true]) {
      const res = await putStep(who, "identity", body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json(), JSON.stringify(body)).toEqual({ error: "invalid", message: "Periksa kembali isian formulir.", fields: {} });
    }
    expect(await countRows("application_drafts")).toBe(0);
  });
});

describe("the rules run through the route and a failed step writes nothing", () => {
  test("the example of the contract (section 15): four fields, the legacy messages, 400, nothing stored", async () => {
    await openBatch();
    const who = await student();
    const res = await putStep(who, "household", {
      livingWith: ["Ayah", "Ibu"],
      fatherName: "Bapak Contoh",
      fatherOccupation: "Petani",
      fatherIncome: "Rp1.200.000",
      motherName: "Ibu Contoh",
      motherOccupation: "Ibu rumah tangga",
      motherIncome: "0",
      hasOtherEarner1: true,
      earner1Relation: "",
      earner1Income: "1.500.000,00",
      hasOtherEarner2: false,
      familySize: 0,
    });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({
      error: "invalid",
      message: "Periksa kembali isian formulir.",
      fields: {
        fatherIncome: 'Hilangkan "Rp". Contoh benar: 1.200.000',
        earner1Relation: "Wajib diisi",
        earner1Income: "Hilangkan koma. Contoh benar: 1.200.000",
        familySize: "Minimal 1 (termasuk kamu)",
      },
    });
    expect(await countRows("application_drafts")).toBe(0);
  });

  test("a step that fails leaves the buckets already saved, the resume point and the version exactly as they were", async () => {
    await openBatch();
    const who = await student();
    expect((await putStep(who, "identity", VALID.identity)).status).toBe(200);
    const before = await draftOf(who.id);
    const res = await putStep(who, "housing", { ...VALID.housing, buildingArea: -1 });
    expect(res.status).toBe(400);
    expect((await json(res)).fields).toEqual({ buildingArea: "Tidak boleh negatif" });
    expect(await draftOf(who.id)).toEqual(before);
  });

  test("nested fields are dotted paths and only the first message per field is kept", async () => {
    await openBatch();
    const who = await student();
    const res = await putStep(who, "organizations", { hasOrganizations: true, entries: [{ name: "OSIS", position: "" }, { name: "", position: "Ketua" }] });
    expect(res.status).toBe(400);
    expect((await json(res)).fields).toEqual({ "entries.0.position": "Jabatan wajib diisi", "entries.1.name": "Nama organisasi wajib diisi" });
  });

  test("every bucket has its route: a valid body saves, an empty object fails with the fields of that step", async () => {
    await openBatch();
    const who = await student();
    for (const step of STEP_IDS) {
      const empty = await putStep(who, step, {});
      // `organizations` is the one bucket an empty object passes (a toggle that is off).
      expect(empty.status, `${step} {}`).toBe(step === "organizations" ? 200 : 400);
      if (step !== "organizations") expect(Object.keys((await json(empty)).fields).length, `${step} {}`).toBeGreaterThan(0);
      expect((await putStep(who, step, VALID[step])).status, step).toBe(200);
    }
  });
});

describe("what a saved step is", () => {
  test("the first save creates the draft (one row, an id made now, the batch and the owner) and answers with its shape", async () => {
    const batch = await openBatch();
    const who = await student();
    const res = await putStep(who, "household", VALID.household);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(Object.keys(body).sort()).toEqual(["draft", "removedSlots", "savedAt", "step"]);
    expect(Object.keys(body.draft).sort()).toEqual(["id", "missingFiles", "saved", "updatedAt"]);
    const row = (await draftOf(who.id))!;
    expect(body).toEqual({
      step: "household",
      savedAt: new Date(row.updated_at).toISOString(),
      draft: { id: row.id, updatedAt: new Date(row.updated_at).toISOString(), saved: ["household"], missingFiles: expect.any(Array) },
      removedSlots: [],
    });
    expect(row).toMatchObject({ user_id: who.id, batch_id: batch.id, last_step: "household" });
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.created_at).toBe(row.updated_at);
    expect(Math.abs(row.created_at - Date.now())).toBeLessThan(10_000);
    expect(await countRows("application_drafts")).toBe(1);
  });

  test("a second save keeps the draft (same id), adds a bucket, moves the resume point and the version forward", async () => {
    await openBatch();
    const who = await student();
    const first = await json(await putStep(who, "identity", VALID.identity));
    const second = await json(await putStep(who, "housing", VALID.housing));
    expect(second.draft.id).toBe(first.draft.id);
    expect(second.draft.saved).toEqual(["identity", "housing"]);
    expect(Date.parse(second.draft.updatedAt)).toBeGreaterThan(Date.parse(first.draft.updatedAt));
    const row = (await draftOf(who.id))!;
    expect(row.last_step).toBe("housing");
    expect(row.created_at).toBeLessThan(row.updated_at);
    expect(await countRows("application_drafts")).toBe(1);
  });

  test("the version only grows: saves in the same millisecond still move it (a frozen clock)", async () => {
    await openBatch();
    const who = await student();
    const versions: number[] = [];
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now());
      for (const step of ["identity", "household", "housing"] as const) {
        const res = await putStep(who, step, VALID[step]);
        expect(res.status).toBe(200);
        versions.push((await draftOf(who.id))!.updated_at);
      }
    } finally {
      vi.useRealTimers();
    }
    expect(versions[1]).toBeGreaterThan(versions[0]!);
    expect(versions[2]).toBeGreaterThan(versions[1]!);
  });

  test("what is stored is the validated input: trimmed, whatsapp without spaces, instagram without its @, unknown keys dropped, a toggle that is off leaves its fields out", async () => {
    await openBatch();
    const who = await student();
    await putStep(who, "identity", { ...VALID.identity, fullName: "  Nama Dengan Spasi  ", whatsapp: " 6281 2345 6789 ", extra: "dibuang", isAdmin: true });
    await putStep(who, "marketing", { instagramUsername: "@sari.contoh " });
    await putStep(who, "household", { ...VALID.household, hasOtherEarner1: false, earner1Relation: "Kakak", earner1Income: "9.000.000", familySize: "4" });
    const form = await formOf(who.id);
    expect(form.identity.fullName).toBe("Nama Dengan Spasi");
    expect(form.identity.whatsapp).toBe("628123456789");
    expect(form.identity).not.toHaveProperty("extra");
    expect(form.identity).not.toHaveProperty("isAdmin");
    expect(form.marketing).toEqual({ instagramUsername: "sari.contoh" });
    expect(form.household).not.toHaveProperty("earner1Relation");
    expect(form.household).not.toHaveProperty("earner1Income");
    // "as sent": a count stays what it was (a numeric string here), a rupiah amount stays text ("1.200.000").
    expect(form.household.familySize).toBe("4");
    expect(form.household.fatherIncome).toBe("1.200.000");
  });

  test("a save REPLACES its bucket and touches no other (a bucket of other fields is not merged)", async () => {
    await openBatch();
    const who = await student();
    await putStep(who, "identity", VALID.identity);
    await putStep(who, "organizations", { hasOrganizations: true, entries: [{ name: "OSIS", position: "Ketua" }, { name: "Karang Taruna", position: "Anggota" }] });
    const before = await formOf(who.id);
    expect(before.organizations.entries).toHaveLength(2);
    await putStep(who, "organizations", { hasOrganizations: false });
    const after = await formOf(who.id);
    expect(after.organizations).toEqual({ hasOrganizations: false, entries: [] });
    expect(after.identity).toEqual(before.identity);
    expect(Object.keys(after)).toEqual(Object.keys(before));
  });

  test("the same body twice is the same bucket: 200 both times, one draft", async () => {
    await openBatch();
    const who = await student();
    const one = await putStep(who, "interview", VALID.interview);
    const formAfterOne = await formOf(who.id);
    const two = await putStep(who, "interview", VALID.interview);
    expect([one.status, two.status]).toEqual([200, 200]);
    expect(await formOf(who.id)).toEqual(formAfterOne);
    expect(await countRows("application_drafts")).toBe(1);
  });

  test("two steps saved at once do not overwrite each other, and a draft that does not exist yet is created once", async () => {
    await openBatch();
    const who = await student();
    const steps = ["identity", "household", "housing", "organizations", "marketing", "interview"] as const;
    const results = await Promise.all(steps.map((step) => putStep(who, step, VALID[step])));
    expect(results.map((res) => res.status)).toEqual(steps.map(() => 200));
    expect(await countRows("application_drafts")).toBe(1);
    const form = await formOf(who.id);
    expect(Object.keys(form).sort()).toEqual([...steps].sort());
    for (const step of steps) expect(form[step], step).toBeTruthy();
    // The drafts of the answers agree on one id.
    expect(new Set((await Promise.all(results.map((r) => json(r.clone())))).map((b) => b.draft.id)).size).toBe(1);
  });

  test("the answer's `saved` lists the buckets in the order of the seven, whatever order they were saved in, and `missingFiles` follows the DTKS answer", async () => {
    await openBatch();
    const who = await student();
    await putStep(who, "interview", VALID.interview);
    const body = await json(await putStep(who, "identity", VALID.identity));
    expect(body.draft.saved).toEqual(["identity", "interview"]);
    expect(body.draft.missingFiles).toHaveLength(10);
    expect((await json(await putStep(who, "documents", { dtksRegistered: "ya" }))).draft.missingFiles).toHaveLength(11);
    expect((await json(await putStep(who, "documents", { dtksRegistered: "tidak" }))).draft.missingFiles).toHaveLength(10);
  });

  test("a save of one student never touches another's draft", async () => {
    await openBatch();
    const ana = await student("ana");
    const budi = await student("budi");
    await putStep(budi, "identity", VALID.identity);
    const before = await draftOf(budi.id);
    await putStep(ana, "identity", { ...VALID.identity, nickname: "Ana" });
    await putStep(ana, "household", VALID.household);
    expect(await draftOf(budi.id)).toEqual(before);
    expect((await formOf(ana.id)).identity.nickname).toBe("Ana");
  });

  test("nothing is audited, nothing is emailed, and no answer is in a console line", async () => {
    await openBatch();
    const who = await student();
    const { lines, restore } = captureConsole();
    try {
      for (const step of STEP_IDS) await putStep(who, step, VALID[step]);
      await putStep(who, "identity", { ...VALID.identity, fullName: "x" });
    } finally {
      restore();
    }
    expect(await countRows("audit_log")).toBe(0);
    expect(lines.join("\n")).not.toMatch(/Rahasia|6281200012345|Jl\. /);
  });
});

describe("the guards of the statement itself (the world changes between the read and the write)", () => {
  test("a batch that closes between the gate and the write: 409, and nothing is written", async () => {
    const batch = await openBatch();
    const who = await student();
    const db = racing(env.DB, /INSERT INTO application_drafts/, () => env.DB.prepare("UPDATE admission_batches SET opens_at = ?, closes_at = ? WHERE id = ?").bind(Date.now() - 20 * DAY, Date.now() - DAY, batch.id).run());
    const res = await putStep(who, "identity", VALID.identity, { env: { DB: db } });
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("no_open_batch");
    expect(await countRows("application_drafts")).toBe(0);
  });

  test("an application that appears between the gate and the write: 409 already_submitted, and no draft is made", async () => {
    const batch = await openBatch();
    const who = await student();
    const db = racing(env.DB, /INSERT INTO application_drafts/, async () => void (await addApplication(batch.id, { userId: who.id })));
    const res = await putStep(who, "identity", VALID.identity, { env: { DB: db } });
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("already_submitted");
    expect(await countRows("application_drafts")).toBe(0);
  });

  test("an existing draft whose batch closes meanwhile: 409 batch_closed and the draft keeps the bucket it had", async () => {
    const batch = await openBatch();
    const who = await student();
    await putStep(who, "identity", VALID.identity);
    const before = await draftOf(who.id);
    const db = racing(env.DB, /INSERT INTO application_drafts/, () => env.DB.prepare("UPDATE admission_batches SET closes_at = ? WHERE id = ?").bind(Date.now() - 1000, batch.id).run());
    const res = await putStep(who, "household", VALID.household, { env: { DB: db } });
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("batch_closed");
    expect(await draftOf(who.id)).toEqual(before);
  });
});

describe("the DTKS answer decides whether the SKTM file may exist", () => {
  async function withDtksFile(extra: { contentType?: string; size?: number } = {}) {
    const batch = await openBatch();
    const who = await student();
    await putStep(who, "documents", { dtksRegistered: "ya" });
    const draft = (await draftOf(who.id))!;
    const size = extra.size ?? 4321;
    const contentType = extra.contentType ?? "application/pdf";
    const fileId = await addFileRow(draft.id, "dtks", { contentType, size });
    const keep = await addFileRow(draft.id, "family-card", { size: 1000 });
    await setStorage(size + 1000, 2);
    const key = applicationFileKey({ year: batch.year, applicationId: draft.id, fileId, contentType })!;
    await env.PRIVATE_FILES.put(key, "bytes");
    return { batch, who, draft, fileId, keep, key, size };
  }

  test("saving `documents` with ya keeps the file and answers removedSlots []", async () => {
    const { who, key, fileId } = await withDtksFile();
    const res = await putStep(who, "documents", { dtksRegistered: "ya" });
    expect((await json(res)).removedSlots).toEqual([]);
    expect(await env.PRIVATE_FILES.get(key)).not.toBeNull();
    expect(await env.DB.prepare("SELECT deleted_at FROM application_files WHERE id = ?").bind(fileId).first()).toEqual({ deleted_at: null });
  });

  test("saving it with tidak removes the dtks file (row and object), gives its bytes back to the counter, and lists the slot", async () => {
    const { who, key, fileId, keep, size } = await withDtksFile();
    const res = await putStep(who, "documents", { dtksRegistered: "tidak" });
    expect(res.status).toBe(200);
    expect((await json(res)).removedSlots).toEqual(["dtks"]);
    expect(await env.PRIVATE_FILES.get(key)).toBeNull();
    expect(await env.DB.prepare("SELECT id FROM application_files WHERE id = ?").bind(fileId).first()).toBeNull();
    // The other file, and the bytes of this one given back: 5,321 bytes in 2 files became 1,000 in 1.
    expect(await env.DB.prepare("SELECT id FROM application_files WHERE id = ?").bind(keep).first()).not.toBeNull();
    expect(await storage()).toMatchObject({ bytes: 1000, files: 1 });
    expect(size).toBe(4321);
    // And the draft now says tidak, so the file list the wizard reads has no dtks and no dtks is required.
    const current = await json(await get(CURRENT, who));
    expect(current.files.map((f: { slot: string }) => f.slot)).toEqual(["family-card"]);
    expect(current.draft.steps.documents).toEqual({ dtksRegistered: "tidak" });
  });

  test("tidak with no dtks file removes nothing, writes nothing to the counter, and answers []", async () => {
    const batch = await openBatch();
    const who = await student();
    await putStep(who, "documents", { dtksRegistered: "ya" });
    const draft = (await draftOf(who.id))!;
    await addFileRow(draft.id, "family-card");
    await setStorage(500, 1);
    await env.DB.prepare("UPDATE private_storage SET updated_at = 1234").run();
    const res = await putStep(who, "documents", { dtksRegistered: "tidak" });
    expect((await json(res)).removedSlots).toEqual([]);
    expect(await storage()).toEqual({ bytes: 500, files: 1 });
    expect((await env.DB.prepare("SELECT updated_at FROM private_storage").first<{ updated_at: number }>())!.updated_at).toBe(1234);
    expect(batch.id).toBeTruthy();
  });

  test("other buckets saved with a dtks file in place leave it alone; only `documents` with tidak removes it", async () => {
    const { who, fileId } = await withDtksFile();
    for (const step of ["identity", "marketing", "interview"] as const) expect((await putStep(who, step, VALID[step])).status).toBe(200);
    expect(await env.DB.prepare("SELECT id FROM application_files WHERE id = ?").bind(fileId).first()).not.toBeNull();
  });

  test("a dtks file of ANOTHER student's draft is not touched", async () => {
    const mine = await withDtksFile();
    const other = await student("lain");
    await putStep(other, "documents", { dtksRegistered: "ya" });
    const otherDraft = (await draftOf(other.id))!;
    const otherFile = await addFileRow(otherDraft.id, "dtks");
    await putStep(mine.who, "documents", { dtksRegistered: "tidak" });
    expect(await env.DB.prepare("SELECT deleted_at FROM application_files WHERE id = ?").bind(otherFile).first()).toEqual({ deleted_at: null });
  });

  test("a bucket that cannot delete its object: the answer is still 200, the row stays MARKED deleted (bytes already given back), the log names no id", async () => {
    const { who, fileId, key } = await withDtksFile();
    const failing = { ...env, PRIVATE_FILES: { delete: async () => { throw new Error("r2 is down"); } } } as unknown as typeof env.PRIVATE_FILES;
    const { lines, restore } = captureConsole();
    let res: Response;
    try {
      res = await putStep(who, "documents", { dtksRegistered: "tidak" }, { env: { PRIVATE_FILES: failing } });
    } finally {
      restore();
    }
    expect(res.status).toBe(200);
    expect((await json(res)).removedSlots).toEqual(["dtks"]);
    const row = await env.DB.prepare("SELECT deleted_at FROM application_files WHERE id = ?").bind(fileId).first<{ deleted_at: number | null }>();
    expect(row?.deleted_at).toBeGreaterThan(0);
    expect(await storage()).toMatchObject({ bytes: 1000, files: 1 });
    expect(await env.PRIVATE_FILES.get(key)).not.toBeNull();
    const text = lines.join("\n");
    expect(text).toContain("could not be deleted");
    expect(text).not.toContain(fileId);
    expect(text).not.toContain(key);
  });

  test("an unreadable counter row (it is missing) does not stop the removal", async () => {
    const { who, key, fileId } = await withDtksFile();
    await env.DB.prepare("DELETE FROM private_storage").run();
    expect((await putStep(who, "documents", { dtksRegistered: "tidak" })).status).toBe(200);
    expect(await env.PRIVATE_FILES.get(key)).toBeNull();
    expect(await env.DB.prepare("SELECT id FROM application_files WHERE id = ?").bind(fileId).first()).toBeNull();
  });
});

describe("the limits of the contract are the module's", () => {
  test("the numbers the route uses are the shared module's: 16 KiB for a JSON body, 32 KiB for a step; sixteen slots", () => {
    expect(JSON_BODY_MAX_BYTES).toBe(16 * 1024);
    expect(STEP_BODY_MAX_BYTES).toBe(32 * 1024);
    expect(SLOT_IDS).toHaveLength(16);
    void applicationOf;
  });
});
