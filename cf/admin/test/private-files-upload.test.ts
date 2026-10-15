import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MAX_BYTES_PER_APPLICATION, MAX_FILE_BYTES, MAX_FILES_PER_APPLICATION } from "../shared/application-form/limits";
import { requiredSlots, SLOT_IDS, SLOTS } from "../shared/application-form/slots";
import { buildKey, KEY_PATTERN } from "../src/private-files/key";
import { limiterClock } from "./limiter-clock";
import { addApplication } from "./pendaftaran-helpers";
import { portalSignedIn } from "./portal-helpers";
import { uniqueEmail } from "./helpers";
import { DAY } from "./public-helpers";
import { disguises, gif, jpeg, padTo, png } from "./uploads-helpers";
import {
  addDraft,
  addSubmitted,
  bytes,
  draftRows,
  emptyBucketBeforeEach,
  fileRows,
  openBatch,
  privateKeys,
  putFile,
  seedFile,
  storage,
  streamOf,
  student,
  upload,
  type Uploaded,
} from "./private-files-helpers";

// The student's upload (SAKEM-083, P4): `PUT /portal/api/applications/current/files/:slot`, docs/cloudflare/portal-api.md,
// 11.2. The order of the checks, every refusal with its exact status, code and words, the bytes that must be real, the
// stream that must be exact, the storage counter that must balance, and the slot and application limits to the byte.
// Negative checks: scripts/negative-checks-portal-files.mjs.

emptyBucketBeforeEach();

afterEach(() => {
  vi.restoreAllMocks();
});

async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** A refusal's body: the code and the words, and nothing else a person could be hurt by. */
const refusal = async (res: Response) => json<{ error: string; message?: string; [extra: string]: unknown }>(res);

async function md5Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("MD5", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The student, signed in, with a batch that is open: what almost every test starts from. */
async function ready() {
  const batch = await openBatch();
  const s = await student();
  return { s, batch };
}

describe("a stored file", () => {
  test("201 with the file, the usage and the draft; the object, the row and the counter agree", async () => {
    const { s, batch } = await ready();
    const body = bytes.png(5000, 40, 30);
    const res = await putFile("family-card", body, { cookie: s.cookie });
    expect(res.status).toBe(201);
    const answer = await json<Uploaded>(res);

    expect(Object.keys(answer).sort()).toEqual(["draft", "file", "usage"]);
    expect(Object.keys(answer.file).sort()).toEqual(["contentType", "height", "id", "size", "slot", "uploadedAt", "width"]);
    expect(answer.file).toMatchObject({ slot: "family-card", contentType: "image/png", size: 5000, width: 40, height: 30 });
    expect(new Date(answer.file.uploadedAt).toISOString()).toBe(answer.file.uploadedAt);
    expect(answer.usage).toEqual({ slotCount: 1, slotMax: 2, applicationFiles: 1, applicationBytes: 5000 });
    expect(answer.draft.missingFiles).toEqual(requiredSlots(false).filter((slot) => slot !== "family-card"));

    // The draft was made by this upload, and its id is the application id in the file's key.
    const drafts = await draftRows();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ batch_id: batch.id, form_data: "{}", last_step: null });
    expect(answer.draft.id).toBe(drafts[0]!.id);

    const key = buildKey({ year: batch.year, applicationId: drafts[0]!.id, fileId: answer.file.id, type: "png" });
    expect(await privateKeys()).toEqual([key]);
    const object = await env.PRIVATE_FILES.get(key);
    expect(new Uint8Array(await object!.arrayBuffer())).toEqual(body);
    expect(object!.httpMetadata).toMatchObject({ contentType: "image/png", cacheControl: "private, no-store" });
    expect(object!.customMetadata ?? {}).toEqual({});

    const rows = await fileRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: answer.file.id, application_id: drafts[0]!.id, slot: "family-card", content_type: "image/png", size: 5000, width: 40, height: 30, deleted_at: null });
    // The checksum is the MD5 of the bytes, as R2 reports it.
    expect(rows[0]!.checksum).toBe(await md5Hex(body));
    expect(await storage()).toEqual({ bytes: 5000, files: 1 });
  });

  test("every accepted type is stored under its own extension with its sniffed content type; a PDF has no size", async () => {
    const { s, batch } = await ready();
    const cases = [
      ["house-photos", bytes.png(100), "image/png", "png", 40, 30],
      ["house-photos", bytes.jpeg(100), "image/jpeg", "jpg", 40, 30],
      ["house-photos", bytes.webp(100), "image/webp", "webp", 40, 30],
      ["house-photos", bytes.pdf(100), "application/pdf", "pdf", null, null],
    ] as const;
    for (const [slot, body, contentType, ext, width, height] of cases) {
      const done = await upload(s, slot, body);
      expect(done.file, ext).toMatchObject({ contentType, width, height, size: 100 });
      const draft = (await draftRows())[0]!;
      expect(await privateKeys()).toContain(`applications/${batch.year}/${draft.id}/${done.file.id}.${ext}`);
    }
  });

  test("the key has nothing of the client in it: not the file name, not the type it claimed, not a path it sent", async () => {
    const { s } = await ready();
    const res = await putFile("family-card", bytes.pdf(300), {
      cookie: s.cookie,
      claimedType: "text/html",
      headers: { "x-file-name": "../../Budi Santoso KK.pdf", "content-disposition": 'attachment; filename="Budi Santoso KK.pdf"' },
      query: "?name=../../etc/passwd&filename=Kartu%20Keluarga%20Budi.pdf",
    });
    expect(res.status).toBe(201);
    const [key] = await privateKeys();
    expect(key).toMatch(KEY_PATTERN);
    expect(key).not.toMatch(/budi|santoso|passwd|etc|\.\.|html|kartu/i);
    // The row has no file name column at all.
    expect(Object.keys((await fileRows())[0]!).sort()).toEqual(["application_id", "checksum", "content_type", "created_at", "deleted_at", "height", "id", "size", "slot", "width"]);
  });

  test("the client's content type is never read: the bytes decide", async () => {
    const { s } = await ready();
    // A PNG that calls itself text: stored as a PNG.
    expect((await upload(s, "house-photos", bytes.png(100), { claimedType: "text/plain" })).file.contentType).toBe("image/png");
    // A script that calls itself an image: refused.
    const res = await putFile("house-photos", disguises.html, { cookie: s.cookie, claimedType: "image/png" });
    expect(res.status).toBe(415);
    expect(await privateKeys()).toHaveLength(1);
  });

  test("a second file reuses the draft and the usage counts both; a DTKS student has dtks among the missing", async () => {
    const { s } = await ready();
    const first = await upload(s, "family-card", bytes.png(1000));
    const second = await upload(s, "self-photo", bytes.jpeg(2000));
    expect(second.draft.id).toBe(first.draft.id);
    expect(second.usage).toEqual({ slotCount: 1, slotMax: 1, applicationFiles: 2, applicationBytes: 3000 });
    expect(await draftRows()).toHaveLength(1);

    await env.DB.prepare("UPDATE application_drafts SET form_data = ? WHERE id = ?")
      .bind(JSON.stringify({ documents: { dtksRegistered: "ya" } }), first.draft.id)
      .run();
    const third = await upload(s, "electricity-bill", bytes.pdf(500));
    expect(third.draft.missingFiles).toContain("dtks");
    expect(third.draft.missingFiles).not.toContain("electricity-bill");
  });

  test("each file write moves the draft's version, at least a millisecond each time", async () => {
    const { s } = await ready();
    const first = await upload(s, "family-card");
    const afterFirst = (await draftRows())[0]!.updated_at;
    await upload(s, "self-photo");
    const afterSecond = (await draftRows())[0]!.updated_at;
    expect(afterSecond).toBeGreaterThan(afterFirst);
    expect(first.draft.id).toBeTruthy();
  });

  test("two first uploads at once make ONE draft, and both files belong to it", async () => {
    const { s } = await ready();
    const [a, b] = await Promise.all([putFile("family-card", bytes.png(800), { cookie: s.cookie }), putFile("self-photo", bytes.jpeg(900), { cookie: s.cookie })]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const drafts = await draftRows();
    expect(drafts).toHaveLength(1);
    const rows = await fileRows();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.application_id))).toEqual(new Set([drafts[0]!.id]));
    expect(await storage()).toEqual({ bytes: 1700, files: 2 });
    expect(await privateKeys()).toHaveLength(2);
  });
});

describe("the order of the checks (11.2): the first failure answers", () => {
  test("nobody signed in: 401, and nothing was read", async () => {
    await openBatch();
    const res = await putFile("family-card", bytes.png(100));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    expect(await fileRows()).toEqual([]);
    expect(await storage()).toEqual({ bytes: 0, files: 0 });
  });

  test("an admin account on the portal: 403 student_only; an unverified address: 403 email_not_verified", async () => {
    await openBatch();
    const admin = await portalSignedIn(uniqueEmail("pengurus"), "editor");
    const res = await putFile("family-card", bytes.png(100), { cookie: admin });
    expect(res.status).toBe(403);
    expect((await refusal(res)).error).toBe("student_only");

    const s = await student();
    await env.DB.prepare("UPDATE users SET email_verified = 0 WHERE id = ?").bind(s.id).run();
    const unverified = await putFile("family-card", bytes.png(100), { cookie: s.cookie });
    expect(unverified.status).toBe(403);
    expect((await refusal(unverified)).error).toBe("email_not_verified");
    expect(await fileRows()).toEqual([]);
  });

  test("a cookie of the admin's audience is no session here", async () => {
    await openBatch();
    const res = await putFile("family-card", bytes.png(100), { cookie: "better-auth.session_token=anything" });
    expect(res.status).toBe(401);
  });

  test("the limiter (20 a minute per student) comes before the slot, the length and the body", async () => {
    const { s } = await ready();
    for (let i = 0; i < 20; i++) expect((await putFile("no-such-slot", bytes.png(10), { cookie: s.cookie })).status).toBe(404);
    const limited = await putFile("no-such-slot", bytes.png(10), { cookie: s.cookie });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(await limited.json()).toEqual({ error: "rate_limited", message: "Terlalu banyak unggahan. Silakan tunggu satu menit lalu coba lagi.", retryAfterSeconds: 60 });
    // Another student has a bucket of their own (the key is the user id, not the address), and a minute later the first has theirs back.
    const other = await student("lain");
    expect((await putFile("no-such-slot", bytes.png(10), { cookie: other.cookie })).status).toBe(404);
    limiterClock.advance(60_000);
    expect((await putFile("no-such-slot", bytes.png(10), { cookie: s.cookie })).status).toBe(404);
  });

  test("an unknown slot: 404 unknown_slot", async () => {
    const { s } = await ready();
    for (const slot of ["nope", "FAMILY-CARD", "family_card", "family-card%2F", "dtks-extra", "..%2F"]) {
      const res = await putFile(slot, bytes.png(100), { cookie: s.cookie });
      expect(res.status, slot).toBe(404);
      expect((await refusal(res)).error, slot).toBe("unknown_slot");
    }
  });

  test("no Content-Length: 411; not a number: 411; zero: 400 empty_file; over 10 MB: 413 before a byte is read", async () => {
    const { s } = await ready();
    const none = await putFile("family-card", streamOf([bytes.png(100)]), { cookie: s.cookie });
    expect(none.status).toBe(411);
    expect(await none.json()).toEqual({ error: "length_required", message: "Ukuran file tidak diketahui. Coba unggah lagi." });
    for (const junk of ["abc", "-5", "1.5", "1e3", "12345678901234"]) {
      const res = await putFile("family-card", bytes.png(100), { cookie: s.cookie, headers: { "content-length": junk }, contentLength: null });
      expect(res.status, junk).toBe(411);
    }
    const empty = await putFile("family-card", new Uint8Array(0), { cookie: s.cookie });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "empty_file", message: "File kosong." });

    // Refused on the header alone: the body is never touched, not even when it is not there.
    const huge = await putFile("family-card", bytes.png(100), { cookie: s.cookie, contentLength: MAX_FILE_BYTES + 1 });
    expect(huge.status).toBe(413);
    expect(await huge.json()).toEqual({ error: "too_large", message: "Ukuran file maksimal 10 MB.", maxBytes: 10_000_000 });
    expect(await fileRows()).toEqual([]);
    expect(await storage()).toEqual({ bytes: 0, files: 0 });
  });

  test("exactly 10,000,000 bytes is accepted, streamed through R2", async () => {
    const { s } = await ready();
    const res = await putFile("family-card", bytes.pdf(MAX_FILE_BYTES), { cookie: s.cookie });
    expect(res.status).toBe(201);
    expect((await json<Uploaded>(res)).file.size).toBe(MAX_FILE_BYTES);
    const [key] = await privateKeys();
    expect((await env.PRIVATE_FILES.head(key!))!.size).toBe(MAX_FILE_BYTES);
    expect(await storage()).toEqual({ bytes: MAX_FILE_BYTES, files: 1 });
  });

  describe("the gate", () => {
    test("no batch at all: 409 no_open_batch; a batch that has not opened, or has closed, is not open", async () => {
      const s = await student();
      const none = await putFile("family-card", bytes.png(100), { cookie: s.cookie });
      expect(none.status).toBe(409);
      expect(await none.json()).toEqual({ error: "no_open_batch", message: "Belum ada batch pendaftaran yang dibuka. Silakan kembali saat pendaftaran berikutnya diumumkan." });

      await openBatch({ opensAt: new Date(Date.now() + DAY), closesAt: new Date(Date.now() + 2 * DAY) });
      await openBatch({ opensAt: new Date(Date.now() - 3 * DAY), closesAt: new Date(Date.now() - DAY) });
      const closed = await putFile("family-card", bytes.png(100), { cookie: s.cookie });
      expect((await refusal(closed)).error).toBe("no_open_batch");
      expect(await fileRows()).toEqual([]);
      expect(await draftRows()).toEqual([]);
    });

    test("the batch closed on a draft that is still there: 409 batch_closed", async () => {
      const s = await student();
      const batch = await openBatch({ opensAt: new Date(Date.now() - 3 * DAY), closesAt: new Date(Date.now() - DAY) });
      await addDraft(s.id, batch.id);
      const res = await putFile("family-card", bytes.png(100), { cookie: s.cookie });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "batch_closed", message: "Pendaftaran untuk batch ini sudah ditutup. Isianmu tidak bisa disimpan atau dikirim." });
      expect(await fileRows()).toEqual([]);
    });

    test("an application for the open batch: 409 already_submitted, and the draft is not made again", async () => {
      const { s, batch } = await ready();
      await addSubmitted(s, batch.id);
      const res = await putFile("family-card", bytes.png(100), { cookie: s.cookie });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "already_submitted", message: "Kamu sudah mengirim pendaftaran untuk batch ini. Cek status di halaman Portal Siswa." });
      expect(await draftRows()).toEqual([]);
      expect(await fileRows()).toEqual([]);
    });

    test("an application for an OLD batch does not stop an upload to the open one; two open batches: the latest opens_at wins", async () => {
      const s = await student();
      const old = await openBatch({ opensAt: new Date(Date.now() - 400 * DAY), closesAt: new Date(Date.now() - 300 * DAY) });
      await addSubmitted(s, old.id);
      const older = await openBatch({ opensAt: new Date(Date.now() - 5 * DAY), closesAt: new Date(Date.now() + 5 * DAY) });
      const newer = await openBatch({ opensAt: new Date(Date.now() - 2 * DAY), closesAt: new Date(Date.now() + 9 * DAY) });
      const done = await upload(s, "family-card");
      expect((await draftRows())[0]!.batch_id).toBe(newer.id);
      expect(await privateKeys()).toEqual([expect.stringContaining(`applications/${newer.year}/`)]);
      expect(older.id).not.toBe(newer.id);
      expect(done.draft.id).toBe((await draftRows())[0]!.id);
    });

    test("a student sees only their own draft and application when deciding (another's application is nothing to them)", async () => {
      const { s, batch } = await ready();
      const other = await student("lain");
      await addSubmitted(other, batch.id);
      expect((await putFile("family-card", bytes.png(100), { cookie: s.cookie })).status).toBe(201);
    });
  });

  test("?replace names nothing live of this draft in this slot: 404 file_not_found (another student's, another slot's, a deleted one, junk)", async () => {
    const { s, batch } = await ready();
    const mine = await upload(s, "family-card");
    const other = await student("lain");
    const othersDraft = await addDraft(other.id, batch.id);
    const theirs = await seedFile({ applicationId: othersDraft, year: batch.year, slot: "family-card" });
    const gone = await seedFile({ applicationId: mine.draft.id, year: batch.year, slot: "family-card", deleted: true });
    const otherSlot = await upload(s, "self-photo");

    for (const [label, id] of [
      ["another student's file", theirs.id],
      ["a file of another slot", otherSlot.file.id],
      ["a deleted file", gone.id],
      ["an id nobody has", crypto.randomUUID()],
      ["not an id", "../../x"],
      ["empty", ""],
    ] as const) {
      const res = await putFile("family-card", bytes.png(100), { cookie: s.cookie, query: `?replace=${encodeURIComponent(id)}` });
      expect(res.status, label).toBe(404);
      expect(await res.json(), label).toEqual({ error: "file_not_found" });
    }
    expect((await fileRows()).filter((row) => row.deleted_at === null)).toHaveLength(3); // mine, the other student's, the other slot's
    expect(await privateKeys()).toHaveLength(4);
  });

  describe("the slot has room (to the file)", () => {
    test.each([
      ["father-income", 1],
      ["debt-proof", 3],
      ["family-card", 2],
      ["self-photo", 1],
      ["house-photos", 6],
    ] as const)("%s holds %i: the next is 409 slot_full with max", async (slot, max) => {
      const { s } = await ready();
      // `self-photo` takes images only; everything else takes a PDF too.
      for (let i = 0; i < max; i++) await upload(s, slot, bytes.png(200 + i));
      const res = await putFile(slot, bytes.png(200), { cookie: s.cookie });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "slot_full", message: "Slot ini sudah penuh. Hapus satu berkas dulu atau ganti berkas yang ada.", max });
      expect(await privateKeys()).toHaveLength(max);
      expect((await storage()).files).toBe(max);
      expect(SLOTS[slot].maxFiles).toBe(max);
    });

    test("a deleted file does not count; another slot is not affected", async () => {
      const { s } = await ready();
      const first = await upload(s, "self-photo");
      await env.DB.prepare("UPDATE application_files SET deleted_at = ? WHERE id = ?").bind(Date.now(), first.file.id).run();
      expect((await putFile("self-photo", bytes.png(100), { cookie: s.cookie })).status).toBe(201);
      expect((await putFile("family-card", bytes.png(100), { cookie: s.cookie })).status).toBe(201);
    });

    test("two uploads at once into a slot with one place left: one is stored, the other is slot_full, and nothing is left over", async () => {
      const { s } = await ready();
      const [a, b] = await Promise.all([putFile("self-photo", bytes.png(700), { cookie: s.cookie }), putFile("self-photo", bytes.jpeg(900), { cookie: s.cookie })]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const loser = a.status === 409 ? a : b;
      expect((await refusal(loser)).error).toBe("slot_full");
      expect(await privateKeys()).toHaveLength(1);
      expect(await fileRows()).toHaveLength(1);
      const kept = (await fileRows())[0]!;
      expect(await storage()).toEqual({ bytes: kept.size, files: 1 });
    });
  });

  describe("the application has room", () => {
    test("40 live files: 409 application_full (rows put in directly: the sixteen slots hold only 35)", async () => {
      const { s, batch } = await ready();
      const draft = await addDraft(s.id, batch.id);
      for (let i = 0; i < MAX_FILES_PER_APPLICATION; i++) {
        await env.DB.prepare("INSERT INTO application_files (id, application_id, slot, content_type, size, checksum) VALUES (?, ?, 'house-photos', 'image/png', 10, ?)")
          .bind(crypto.randomUUID(), draft, "0".repeat(32))
          .run();
      }
      const res = await putFile("self-photo", bytes.png(100), { cookie: s.cookie });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "application_full", message: "Jumlah berkas sudah mencapai batas." });
      expect((await fileRows()).length).toBe(MAX_FILES_PER_APPLICATION);
    });

    test("100,000,000 bytes: to the byte, 413 application_too_large; a replace counts without the file it replaces", async () => {
      const { s, batch } = await ready();
      const draft = await addDraft(s.id, batch.id);
      // Ten files of 9,500,000 in the sixteen slots' room: 95,000,000 bytes, so 5,000,000 more fit and 5,000,001 do not.
      const ids: string[] = [];
      for (let i = 0; i < 10; i++) {
        const id = crypto.randomUUID();
        ids.push(id);
        await env.DB.prepare("INSERT INTO application_files (id, application_id, slot, content_type, size, checksum) VALUES (?, ?, ?, 'application/pdf', 9500000, ?)")
          .bind(id, draft, ["electricity-bill", "family-card", "parent-permission", "debt-proof", "house-photos"][i % 5], "0".repeat(32))
          .run();
      }
      const over = await putFile("self-photo", bytes.png(5_000_001), { cookie: s.cookie });
      expect(over.status).toBe(413);
      expect(await over.json()).toEqual({ error: "application_too_large", message: "Total ukuran berkas sudah mencapai batas." });

      // A replace of a 9,500,000 file by one of 14 MB is not possible (10 MB per file), but by 10,000,000 it is: 95,000,000 - 9,500,000 + 10,000,000.
      const swap = await putFile("electricity-bill", bytes.pdf(MAX_FILE_BYTES), { cookie: s.cookie, replace: ids[0]! });
      expect(swap.status).toBe(201);

      const fits = await putFile("self-photo", bytes.png(4_500_000), { cookie: s.cookie });
      expect(fits.status).toBe(201);
      const live = (await fileRows()).filter((row) => row.deleted_at === null);
      expect(live.reduce((sum, row) => sum + row.size, 0)).toBeLessThanOrEqual(MAX_BYTES_PER_APPLICATION);
    });
  });

  describe("the storage budget", () => {
    test("the counter takes the bytes before they are written: over the budget is 503 storage_full and nothing is stored", async () => {
      const { s } = await ready();
      const res = await putFile("family-card", bytes.png(2000), { cookie: s.cookie, env: { PRIVATE_FILES_BUDGET_BYTES: "1999" } });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "storage_full", message: "Penyimpanan berkas sedang penuh. Hubungi panitia lewat WhatsApp." });
      expect(await privateKeys()).toEqual([]);
      expect(await fileRows()).toEqual([]);
      expect(await storage()).toEqual({ bytes: 0, files: 0 });
      // Not even a draft: nothing was written before the bytes were.
      expect(await draftRows()).toEqual([]);
    });

    test("to the byte: a file that fits exactly is stored, the next byte is not", async () => {
      const { s } = await ready();
      expect((await putFile("family-card", bytes.png(2000), { cookie: s.cookie, env: { PRIVATE_FILES_BUDGET_BYTES: "2000" } })).status).toBe(201);
      expect(await storage()).toEqual({ bytes: 2000, files: 1 });
      const next = await putFile("family-card", bytes.png(1), { cookie: s.cookie, env: { PRIVATE_FILES_BUDGET_BYTES: "2000" }, contentLength: 1 });
      expect(next.status).toBe(503);
      expect(await storage()).toEqual({ bytes: 2000, files: 1 });
    });

    test("two uploads at once cannot both take the last bytes", async () => {
      const { s } = await ready();
      const budget = { PRIVATE_FILES_BUDGET_BYTES: "3000" };
      const [a, b] = await Promise.all([putFile("family-card", bytes.png(2000), { cookie: s.cookie, env: budget }), putFile("house-photos", bytes.png(2000), { cookie: s.cookie, env: budget })]);
      expect([a.status, b.status].sort()).toEqual([201, 503]);
      expect(await storage()).toEqual({ bytes: 2000, files: 1 });
      expect(await privateKeys()).toHaveLength(1);
    });

    test("a refusal after the reservation gives it back: a bad type, a broken header, a short body", async () => {
      const { s } = await ready();
      for (const body of [disguises.exe, png(0, 0), disguises.html]) await putFile("family-card", body, { cookie: s.cookie });
      await putFile("family-card", streamOf([bytes.png(500)]), { cookie: s.cookie, contentLength: 5000 });
      expect(await storage()).toEqual({ bytes: 0, files: 0 });
      expect(await privateKeys()).toEqual([]);
    });

    test("a variable that is unreadable is the code's default, not zero and not unlimited", async () => {
      const { s } = await ready();
      const slots = ["house-photos", "vehicle-photos"] as const;
      for (const [index, value] of [undefined, "", "0", "-1", "abc", "8e9", "1.5"].entries()) {
        expect((await putFile(slots[index % 2]!, bytes.png(100), { cookie: s.cookie, env: { PRIVATE_FILES_BUDGET_BYTES: value } })).status, String(value)).toBe(201);
      }
    });
  });

  test("the bucket binding is missing: 503 storage_unavailable, nothing reserved", async () => {
    const { s } = await ready();
    const res = await putFile("family-card", bytes.png(100), { cookie: s.cookie, env: { PRIVATE_FILES: undefined } });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "storage_unavailable", message: "Penyimpanan berkas sedang tidak tersedia. Coba lagi nanti." });
    expect(await storage()).toEqual({ bytes: 0, files: 0 });
    expect(await draftRows()).toEqual([]);
  });
});

describe("what a file really is (the bytes, never the name or the claimed type)", () => {
  test.each([
    ["an executable", disguises.exe],
    ["an HTML page", disguises.html],
    ["an SVG", disguises.svg],
    ["a zip", disguises.zip],
    ["plain text", disguises.text],
    ["a GIF-looking file", disguises.gifLookalike],
    ["PDF text later than byte 0", disguises.lateAndPdfish],
  ])("%s: 415 unsupported_type with the slot's types", async (_label, body) => {
    const { s } = await ready();
    const res = await putFile("family-card", body, { cookie: s.cookie, claimedType: "image/png" });
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({
      error: "unsupported_type",
      message: "Tipe file tidak didukung. Gunakan: PNG, JPEG, WebP, PDF.",
      allowed: ["image/png", "image/jpeg", "image/webp", "application/pdf"],
    });
    expect(await privateKeys()).toEqual([]);
    expect(await draftRows()).toEqual([]);
  });

  test("a GIF is refused everywhere (no slot takes one), and a PDF is refused where only images go (self-photo)", async () => {
    const { s } = await ready();
    expect((await putFile("house-photos", gif(10, 10), { cookie: s.cookie })).status).toBe(415);
    const res = await putFile("self-photo", bytes.pdf(100), { cookie: s.cookie });
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "unsupported_type", message: "Tipe file tidak didukung. Gunakan: PNG, JPEG, WebP.", allowed: ["image/png", "image/jpeg", "image/webp"] });
    expect((await putFile("self-photo", bytes.webp(100), { cookie: s.cookie })).status).toBe(201);
  });

  test("a right signature with a broken or cut header: 422 invalid_file; absurd dimensions: 422 dimensions_too_large; a JPEG header past 1 MiB: 422 unreadable_size", async () => {
    const { s } = await ready();
    const broken = await putFile("family-card", png(0, 0), { cookie: s.cookie });
    expect(broken.status).toBe(422);
    expect(await broken.json()).toEqual({ error: "invalid_file", message: "File rusak atau tidak bisa dibaca. Coba simpan ulang lalu unggah lagi." });
    const cut = await putFile("family-card", png(10, 10).subarray(0, 12), { cookie: s.cookie });
    expect((await refusal(cut)).error).toBe("invalid_file");

    const huge = await putFile("family-card", png(10_001, 10), { cookie: s.cookie });
    expect(huge.status).toBe(422);
    expect(await huge.json()).toEqual({
      error: "dimensions_too_large",
      message: "Dimensi gambar terlalu besar (maksimal 10.000 piksel per sisi dan 50 megapiksel).",
      maxSide: 10000,
      maxPixels: 50000000,
    });
    expect((await putFile("family-card", png(7_100, 7_100), { cookie: s.cookie })).status).toBe(422); // 50.4 MP
    expect((await putFile("family-card", png(7_000, 7_000), { cookie: s.cookie })).status).toBe(201); // 49 MP

    const late = await putFile("house-photos", padTo(jpeg(10, 10, 1_200_000), 1_300_000), { cookie: s.cookie });
    expect(late.status).toBe(422);
    expect((await refusal(late)).error).toBe("unreadable_size");
  });

  test("a refused file leaves nothing: no object, no row, no draft, no counter", async () => {
    const { s } = await ready();
    await putFile("family-card", disguises.exe, { cookie: s.cookie });
    await putFile("family-card", png(0, 0), { cookie: s.cookie });
    expect(await privateKeys()).toEqual([]);
    expect(await fileRows()).toEqual([]);
    expect(await draftRows()).toEqual([]);
    expect(await storage()).toEqual({ bytes: 0, files: 0 });
  });
});

describe("the body is exactly what Content-Length says", () => {
  test("shorter than declared (within the sniffed window): 400 body_mismatch, nothing is stored", async () => {
    const { s } = await ready();
    const res = await putFile("family-card", streamOf([bytes.png(1000)]), { cookie: s.cookie, contentLength: 3000 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "body_mismatch", message: "Unggahan terputus. Coba lagi." });
    expect(await privateKeys()).toEqual([]);
    expect(await fileRows()).toEqual([]);
    expect(await storage()).toEqual({ bytes: 0, files: 0 });
  });

  test("shorter than declared after the sniffed window (a 3 MiB claim, 2 MiB sent): nothing is stored either", async () => {
    const { s } = await ready();
    const res = await putFile("family-card", streamOf([bytes.png(2 * 1024 * 1024)]), { cookie: s.cookie, contentLength: 3 * 1024 * 1024 });
    expect(res.status).toBe(400);
    expect((await refusal(res)).error).toBe("body_mismatch");
    expect(await privateKeys()).toEqual([]);
    expect(await storage()).toEqual({ bytes: 0, files: 0 });
  });

  test("longer than declared: 400 body_mismatch, nothing is stored", async () => {
    const { s } = await ready();
    const res = await putFile("family-card", streamOf([bytes.png(1000), new Uint8Array(1000)]), { cookie: s.cookie, contentLength: 1500 });
    expect(res.status).toBe(400);
    expect((await refusal(res)).error).toBe("body_mismatch");
    expect(await privateKeys()).toEqual([]);
    expect(await storage()).toEqual({ bytes: 0, files: 0 });
    // And one whose excess arrives after the window.
    const late = await putFile("family-card", streamOf([bytes.png(2 * 1024 * 1024), new Uint8Array(500)]), { cookie: s.cookie, contentLength: 2 * 1024 * 1024 });
    expect(late.status).toBe(400);
    expect(await privateKeys()).toEqual([]);
    expect(await storage()).toEqual({ bytes: 0, files: 0 });
  });

  test("an abort (the connection drops) in the head and after it: nothing is stored, the counter balances", async () => {
    const { s } = await ready();
    const early = await putFile("family-card", streamOf([bytes.png(500)], true), { cookie: s.cookie, contentLength: 5000 });
    expect(early.status).toBe(400);
    const later = await putFile("family-card", streamOf([bytes.png(1536 * 1024)], true), { cookie: s.cookie, contentLength: 3 * 1024 * 1024 });
    expect(later.status).toBe(400);
    expect((await refusal(later)).error).toBe("body_mismatch");
    expect(await privateKeys()).toEqual([]);
    expect(await fileRows()).toEqual([]);
    expect(await storage()).toEqual({ bytes: 0, files: 0 });
  });

  // 200 chunks of 1,500 bytes, each its own read: real work (2 s when other runs share the machine, against the default limit of 5 s).
  test("a body that arrives in small chunks is stored whole and exact (the head is built from several reads)", { timeout: 60_000 }, async () => {
    const { s } = await ready();
    const body = bytes.png(300_000);
    const chunks: Uint8Array[] = [];
    for (let offset = 0; offset < body.length; offset += 1500) chunks.push(body.subarray(offset, offset + 1500));
    const res = await putFile("family-card", streamOf(chunks), { cookie: s.cookie, contentLength: body.length });
    expect(res.status).toBe(201);
    const [key] = await privateKeys();
    expect(new Uint8Array(await (await env.PRIVATE_FILES.get(key!))!.arrayBuffer())).toEqual(body);
  });
});

/**
 * A body of 2 MiB in two pieces: the first (the head the Worker sniffs) at once, the second only after `beforeRest` has
 * run. A stream's first pull happens when the request is made, so a change put there would land BEFORE the Worker reads the
 * gate (and the gate, not the guarded insert, would answer); the second pull comes after the Worker has read its head,
 * which is the moment these tests need: the world changes between the checks and the guarded insert.
 */
function inTwoParts(beforeRest: () => Promise<void>) {
  const file = bytes.png(2 * 1024 * 1024);
  const parts = [file.subarray(0, 1_100_000), file.subarray(1_100_000)];
  let next = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (next === 1) await beforeRest();
      controller.enqueue(parts[next++]!);
      if (next === parts.length) controller.close();
    },
  });
  return { stream, length: file.length };
}

describe("when the world changes under an upload", () => {
  test("the draft is submitted while the body is on its way: 409 already_submitted, the object is removed, the reservation given back", async () => {
    const { s, batch } = await ready();
    const first = await upload(s, "self-photo", bytes.png(400));
    const { stream, length } = inTwoParts(async () => {
      // The submit lands after the checks: the application exists and the draft is gone.
      await env.DB.prepare("DELETE FROM application_drafts WHERE id = ?").bind(first.draft.id).run();
      await addApplication(batch.id, { id: first.draft.id, userId: s.id, email: s.email });
    });
    const res = await putFile("family-card", stream, { cookie: s.cookie, contentLength: length });
    expect(res.status).toBe(409);
    expect((await refusal(res)).error).toBe("already_submitted");
    expect(await privateKeys()).toHaveLength(1); // only the first file's object
    expect((await fileRows()).map((row) => row.slot)).toEqual(["self-photo"]);
    expect((await storage()).bytes).toBe(400);
  });

  test("the batch closes while the body is on its way: 409 batch_closed, the object is removed", async () => {
    const { s, batch } = await ready();
    const first = await upload(s, "self-photo", bytes.png(400));
    const { stream, length } = inTwoParts(async () => {
      await env.DB.prepare("UPDATE admission_batches SET closes_at = ? WHERE id = ?").bind(Date.now() - 1000, batch.id).run();
    });
    const res = await putFile("family-card", stream, { cookie: s.cookie, contentLength: length });
    expect(res.status).toBe(409);
    expect((await refusal(res)).error).toBe("batch_closed");
    expect(await privateKeys()).toHaveLength(1);
    expect((await fileRows()).map((row) => row.id)).toEqual([first.file.id]);
    expect((await storage()).bytes).toBe(400);
  });

  test("the slot fills up while the body is on its way (another upload lands first): 409 slot_full, the object is removed", async () => {
    const { s } = await ready();
    const { stream, length } = inTwoParts(async () => {
      expect((await putFile("self-photo", bytes.png(300), { cookie: s.cookie })).status).toBe(201);
    });
    const res = await putFile("self-photo", stream, { cookie: s.cookie, contentLength: length });
    expect(res.status).toBe(409);
    expect((await refusal(res)).error).toBe("slot_full");
    expect(await privateKeys()).toHaveLength(1);
    expect((await storage()).bytes).toBe(300);
  });

  test("D1 fails only when the answer's usage is read, after the file is stored: still 201, and the reservation stays (it is the file's share of the counter)", async () => {
    const { s } = await ready();
    const sqlOf = new WeakMap<object, string>();
    const realPrepare = env.DB.prepare.bind(env.DB);
    const realBatch = env.DB.batch.bind(env.DB);
    vi.spyOn(env.DB, "prepare").mockImplementation((sql: string) => {
      const statement = realPrepare(sql);
      sqlOf.set(statement, sql);
      const bind = statement.bind.bind(statement);
      statement.bind = (...values: unknown[]) => {
        const bound = bind(...values);
        sqlOf.set(bound, sql);
        return bound;
      };
      return statement;
    });
    vi.spyOn(env.DB, "batch").mockImplementation(((statements: D1PreparedStatement[]) => {
      if (statements.some((statement) => (sqlOf.get(statement) ?? "").includes("json_extract(form_data"))) return Promise.reject(new Error("d1 is down"));
      return realBatch(statements);
    }) as typeof env.DB.batch);
    const res = await putFile("family-card", bytes.png(800), { cookie: s.cookie });
    vi.restoreAllMocks();
    expect(res.status).toBe(201);
    const answer = await json<Uploaded>(res);
    expect(answer.usage).toMatchObject({ slotCount: 1, slotMax: 2, applicationFiles: 1, applicationBytes: 800 });
    expect(await fileRows()).toHaveLength(1);
    expect(await privateKeys()).toHaveLength(1);
    expect(await storage()).toEqual({ bytes: 800, files: 1 });
  });

  test("D1 fails when the file row is written: 500, the object is removed, the reservation is given back", async () => {
    const { s } = await ready();
    const lines: string[] = [];
    for (const method of ["log", "info", "warn", "error"] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
    await env.DB.exec("CREATE TRIGGER fail_file_insert BEFORE INSERT ON application_files BEGIN SELECT RAISE(ABORT, 'no'); END");
    try {
      const res = await putFile("family-card", bytes.png(800), { cookie: s.cookie });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "internal" });
    } finally {
      await env.DB.exec("DROP TRIGGER fail_file_insert");
    }
    expect(await privateKeys()).toEqual([]);
    expect(await storage()).toEqual({ bytes: 0, files: 0 });
    // One line: the Worker's own, the message of the error and nothing of the request.
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[portal\] unhandled error: /);
  });

  test("R2 refuses the put: 500, nothing stored, the reservation is given back", async () => {
    const { s } = await ready();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = {
      put: () => Promise.reject(new Error("r2 is down")),
      delete: () => Promise.resolve(),
    } as unknown as R2Bucket;
    const res = await putFile("family-card", bytes.png(800), { cookie: s.cookie, env: { PRIVATE_FILES: broken } });
    expect(res.status).toBe(500);
    expect(await storage()).toEqual({ bytes: 0, files: 0 });
    expect(await fileRows()).toEqual([]);
  });
});

describe("every slot takes an upload", () => {
  test("all sixteen slots accept a file of their own, and the usage says how full each is", async () => {
    const { s } = await ready();
    let last: Uploaded | undefined;
    for (const slot of SLOT_IDS) last = await upload(s, slot, bytes.png(100));
    expect(last!.usage.applicationFiles).toBe(16);
    expect(last!.draft.missingFiles).toEqual([]);
    expect(await privateKeys()).toHaveLength(16);
  });
});
