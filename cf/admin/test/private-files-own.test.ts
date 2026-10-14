import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vitest";
import { runFilesHousekeeping } from "../src/private-files/housekeeping";
import { portalCall, portalSignedIn } from "./portal-helpers";
import { uniqueEmail } from "./helpers";
import { DAY } from "./public-helpers";
import {
  addDraft,
  addSubmitted,
  bytes,
  deleteFile,
  draftRows,
  emptyBucketBeforeEach,
  fileRows,
  openBatch,
  privateKeys,
  putFile,
  readOwnFile,
  seedFile,
  storage,
  student,
  upload,
} from "./private-files-helpers";

// The student's own files (SAKEM-083, P4): replace, delete and read (docs/cloudflare/portal-api.md, 11.2 to 11.4). The
// rule that runs through all of them: a student touches their own application's files and nobody else's, and a file that
// is not theirs is a 404 that looks exactly like a file that does not exist (never a 403, never a different body).

emptyBucketBeforeEach();

afterEach(() => {
  vi.restoreAllMocks();
});

async function ready() {
  const batch = await openBatch();
  const s = await student();
  return { s, batch };
}

/** The private bucket, with deletes that fail: R2 having a bad moment. Everything else is the real (emulated) bucket. */
function flakyDeletes(): R2Bucket {
  return new Proxy(env.PRIVATE_FILES, {
    get(target, property) {
      if (property === "delete") return () => Promise.reject(new Error("r2 is down"));
      const value = Reflect.get(target, property) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

const liveRows = async () => (await fileRows()).filter((row) => row.deleted_at === null);

describe("replace (?replace=<file id>)", () => {
  test("the new file takes the old one's place in one step: old row and object gone, counter and slot count right", async () => {
    const { s } = await ready();
    const old = await upload(s, "family-card", bytes.png(3000));
    await upload(s, "family-card", bytes.png(1000));
    const before = (await draftRows())[0]!.updated_at;
    const res = await putFile("family-card", bytes.jpeg(2000), { cookie: s.cookie, replace: old.file.id });
    expect(res.status).toBe(201);
    const done = (await res.json()) as Awaited<ReturnType<typeof upload>>;
    expect(done.file.id).not.toBe(old.file.id);
    // The slot was full (2 of 2): a replace does not need room, the replaced file does not count.
    expect(done.usage).toEqual({ slotCount: 2, slotMax: 2, applicationFiles: 2, applicationBytes: 3000 });

    const rows = await fileRows();
    expect(rows.map((row) => row.id).sort()).toEqual([...(await liveRows()).map((row) => row.id)].sort());
    expect(rows.some((row) => row.id === old.file.id)).toBe(false);
    expect(await privateKeys()).toHaveLength(2);
    expect(await storage()).toEqual({ bytes: 3000, files: 2 });
    expect((await draftRows())[0]!.updated_at).toBeGreaterThan(before);

    expect((await readOwnFile(old.file.id, s.cookie)).status).toBe(404);
    expect((await readOwnFile(done.file.id, s.cookie)).status).toBe(200);
  });

  test("a replace in a full one-file slot works; the same slot without ?replace is slot_full", async () => {
    const { s } = await ready();
    const first = await upload(s, "self-photo", bytes.png(500));
    expect((await putFile("self-photo", bytes.png(600), { cookie: s.cookie })).status).toBe(409);
    expect((await putFile("self-photo", bytes.png(600), { cookie: s.cookie, replace: first.file.id })).status).toBe(201);
    expect(await liveRows()).toHaveLength(1);
    expect(await storage()).toEqual({ bytes: 600, files: 1 });
  });

  test("a refused replacement keeps the old file: a bad type, a short body", async () => {
    const { s } = await ready();
    const first = await upload(s, "self-photo", bytes.png(500));
    expect((await putFile("self-photo", new TextEncoder().encode("not an image"), { cookie: s.cookie, replace: first.file.id })).status).toBe(415);
    expect((await putFile("self-photo", bytes.png(500), { cookie: s.cookie, replace: first.file.id, contentLength: 900 })).status).toBeGreaterThanOrEqual(400);
    expect(await liveRows()).toHaveLength(1);
    expect((await readOwnFile(first.file.id, s.cookie)).status).toBe(200);
    expect(await storage()).toEqual({ bytes: 500, files: 1 });
  });

  test("when R2 cannot delete the old object: still 201, the old row stays marked and is invisible, the cleanup finishes it", async () => {
    const { s } = await ready();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const old = await upload(s, "self-photo", bytes.png(500));
    const res = await putFile("self-photo", bytes.png(700), { cookie: s.cookie, replace: old.file.id, env: { PRIVATE_FILES: flakyDeletes() } });
    expect(res.status).toBe(201);
    const marked = (await fileRows()).find((row) => row.id === old.file.id);
    expect(marked?.deleted_at).not.toBeNull();
    expect((await readOwnFile(old.file.id, s.cookie)).status).toBe(404);
    // The counter still counts what is still in the bucket.
    expect(await storage()).toEqual({ bytes: 1200, files: 2 });
    expect(await privateKeys()).toHaveLength(2);

    // Within the first hour the cleanup leaves it alone (its own request may still be finishing); after, it finishes the job.
    expect(await runFilesHousekeeping(env, Date.now())).toEqual({ removed: 0, pending: 0 });
    expect(await runFilesHousekeeping(env, Date.now() + 2 * 60 * 60 * 1000)).toEqual({ removed: 1, pending: 0 });
    expect(await privateKeys()).toHaveLength(1);
    expect(await storage()).toEqual({ bytes: 700, files: 1 });
    expect((await fileRows()).map((row) => row.id)).not.toContain(old.file.id);
  });
});

describe("delete: DELETE .../files/:fileId", () => {
  test("a student's own file: 204 with no body; the row, the object and the file's share of the counter are gone; the draft stays and its version moves", async () => {
    const { s } = await ready();
    const keep = await upload(s, "family-card", bytes.png(800));
    const gone = await upload(s, "self-photo", bytes.png(1200));
    const before = (await draftRows())[0]!.updated_at;
    const res = await deleteFile(gone.file.id, s.cookie);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect((await fileRows()).map((row) => row.id)).toEqual([keep.file.id]);
    expect(await privateKeys()).toHaveLength(1);
    expect(await storage()).toEqual({ bytes: 800, files: 1 });
    expect(await draftRows()).toHaveLength(1);
    expect((await draftRows())[0]!.updated_at).toBeGreaterThan(before);
    // The slot has room again.
    expect((await putFile("self-photo", bytes.png(100), { cookie: s.cookie })).status).toBe(201);
  });

  test("another student's file, a file that is gone, an id nobody has, a malformed id: all the same 404 { error: not_found }", async () => {
    const { s, batch } = await ready();
    await upload(s, "family-card");
    const other = await student("lain");
    const othersDraft = await addDraft(other.id, batch.id);
    const theirs = await seedFile({ applicationId: othersDraft, year: batch.year });
    const gone = await seedFile({ applicationId: (await draftRows()).find((row) => row.user_id === s.id)!.id, year: batch.year, deleted: true });

    const answers = [];
    for (const id of [theirs.id, gone.id, crypto.randomUUID(), "not-an-id", "../../etc/passwd", theirs.id.toUpperCase()]) {
      const res = await deleteFile(id, s.cookie);
      answers.push([res.status, await res.json()]);
    }
    for (const answer of answers) expect(answer).toEqual([404, { error: "not_found" }]);
    // Nothing of the other student's was touched.
    expect(await privateKeys()).toContain(theirs.key);
    expect((await fileRows()).find((row) => row.id === theirs.id)?.deleted_at).toBeNull();
  });

  test("a student with no draft at all has nothing to delete: 404", async () => {
    const { s, batch } = await ready();
    const other = await student("lain");
    const theirs = await seedFile({ applicationId: await addDraft(other.id, batch.id), year: batch.year });
    const res = await deleteFile(theirs.id, s.cookie);
    expect(res.status).toBe(404);
    expect(await privateKeys()).toEqual([theirs.key]);
  });

  test("a file of the student's OWN draft in another batch is not reachable through the open one", async () => {
    const { s } = await ready();
    const older = await openBatch({ opensAt: new Date(Date.now() - 400 * DAY), closesAt: new Date(Date.now() - 300 * DAY) });
    const oldDraft = await addDraft(s.id, older.id);
    const file = await seedFile({ applicationId: oldDraft, year: older.year });
    // Their open-batch draft does not exist yet; with one, the old draft's file is still not theirs to delete here.
    await upload(s, "family-card");
    const res = await deleteFile(file.id, s.cookie);
    expect(res.status).toBe(404);
    expect(await privateKeys()).toContain(file.key);
  });

  test("the gate: no open batch 409, a batch closed on the draft 409, an application already sent 409, and the file stays", async () => {
    const { s, batch } = await ready();
    const done = await upload(s, "family-card");

    await env.DB.prepare("UPDATE admission_batches SET closes_at = ? WHERE id = ?").bind(Date.now() - 1000, batch.id).run();
    const closed = await deleteFile(done.file.id, s.cookie);
    expect([closed.status, ((await closed.json()) as { error: string }).error]).toEqual([409, "batch_closed"]);

    await env.DB.prepare("DELETE FROM application_drafts WHERE id = ?").bind(done.draft.id).run();
    const none = await deleteFile(done.file.id, s.cookie);
    expect([none.status, ((await none.json()) as { error: string }).error]).toEqual([409, "no_open_batch"]);

    await env.DB.prepare("UPDATE admission_batches SET closes_at = ? WHERE id = ?").bind(Date.now() + DAY, batch.id).run();
    await addSubmitted(s, batch.id, done.draft.id);
    const sent = await deleteFile(done.file.id, s.cookie);
    expect([sent.status, ((await sent.json()) as { error: string }).error]).toEqual([409, "already_submitted"]);
    expect(await privateKeys()).toHaveLength(1);
    expect((await fileRows())[0]!.deleted_at).toBeNull();
  });

  test("uploads and deletes share the limiter (20 a minute per student)", async () => {
    const { s } = await ready();
    for (let i = 0; i < 20; i++) expect((await deleteFile(crypto.randomUUID(), s.cookie)).status).toBe(404);
    const limited = await deleteFile(crypto.randomUUID(), s.cookie);
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { error: string }).error).toBe("rate_limited");
  });

  test("nobody, an admin account, an unverified address: 401, 403, 403", async () => {
    await openBatch();
    const id = crypto.randomUUID();
    expect((await deleteFile(id)).status).toBe(401);
    expect((await deleteFile(id, await portalSignedIn(uniqueEmail("pengurus"), "viewer"))).status).toBe(403);
    const s = await student();
    await env.DB.prepare("UPDATE users SET email_verified = 0 WHERE id = ?").bind(s.id).run();
    expect((await deleteFile(id, s.cookie)).status).toBe(403);
  });

  test("when R2 cannot delete the object: still 204, the row stays marked and is invisible to every reader, the cleanup finishes it", async () => {
    const { s } = await ready();
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
    const done = await upload(s, "family-card", bytes.png(900));
    const res = await deleteFile(done.file.id, s.cookie, { env: { PRIVATE_FILES: flakyDeletes() } });
    expect(res.status).toBe(204);
    expect((await readOwnFile(done.file.id, s.cookie)).status).toBe(404);
    expect(await liveRows()).toEqual([]);
    expect(await fileRows()).toHaveLength(1);
    expect(await privateKeys()).toHaveLength(1);
    expect(await storage()).toEqual({ bytes: 900, files: 1 });
    // A fixed line, with no key, id or count in it.
    expect(lines).toEqual(["[private-files] the objects of removed files could not be deleted; they stay marked for the daily cleanup"]);

    expect(await runFilesHousekeeping(env, Date.now() + 2 * 60 * 60 * 1000)).toEqual({ removed: 1, pending: 0 });
    expect(await fileRows()).toEqual([]);
    expect(await privateKeys()).toEqual([]);
    expect(await storage()).toEqual({ bytes: 0, files: 0 });
  });
});

describe("read: GET /portal/api/files/:fileId", () => {
  test("an image is served inline with the stored type, a PDF as an attachment, with exactly the headers of 11.4", async () => {
    const { s } = await ready();
    const image = await upload(s, "family-card", bytes.jpeg(2500));
    const document = await upload(s, "electricity-bill", bytes.pdf(4000));

    const img = await readOwnFile(image.file.id, s.cookie);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/jpeg");
    expect(img.headers.get("content-disposition")).toBe(`inline; filename="family-card-${image.file.id.slice(0, 8)}.jpg"`);
    expect(img.headers.get("cache-control")).toBe("private, no-store");
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
    expect(img.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(img.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(img.headers.get("content-length")).toBe("2500");
    expect(img.headers.get("referrer-policy")).toBe("no-referrer");
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(bytes.jpeg(2500));

    const pdf = await readOwnFile(document.file.id, s.cookie);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("content-disposition")).toBe(`attachment; filename="electricity-bill-${document.file.id.slice(0, 8)}.pdf"`);
    expect(new Uint8Array(await pdf.arrayBuffer())).toEqual(bytes.pdf(4000));

    // Nothing that would let a cache, a range, a cookie or another origin in.
    for (const name of ["etag", "last-modified", "accept-ranges", "content-range", "set-cookie", "access-control-allow-origin", "expires", "age"]) expect(img.headers.get(name), name).toBeNull();
  });

  test("Range and conditional headers are ignored: always a full 200", async () => {
    const { s } = await ready();
    const done = await upload(s, "family-card", bytes.png(3000));
    const res = await readOwnFile(done.file.id, s.cookie, { headers: { range: "bytes=0-9", "if-none-match": '"anything"', "if-modified-since": new Date().toUTCString() } });
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(3000);
  });

  test("a HEAD is not a read: 405, so it is never a way to learn a file exists", async () => {
    const { s } = await ready();
    const done = await upload(s, "family-card");
    expect((await readOwnFile(done.file.id, s.cookie, { method: "HEAD" })).status).toBe(405);
  });

  test("the student reads their file in any batch and after the submit; a file of an application that is not theirs never", async () => {
    const { s, batch } = await ready();
    const draftFile = await upload(s, "family-card", bytes.png(700));
    await env.DB.prepare("UPDATE admission_batches SET closes_at = ? WHERE id = ?").bind(Date.now() - 1000, batch.id).run();
    expect((await readOwnFile(draftFile.file.id, s.cookie)).status).toBe(200); // the batch closed on the draft

    await env.DB.prepare("DELETE FROM application_drafts WHERE id = ?").bind(draftFile.draft.id).run();
    const app = await addSubmitted(s, batch.id, crypto.randomUUID());
    const sent = await seedFile({ applicationId: app.id, year: batch.year, slot: "self-photo" });
    expect((await readOwnFile(sent.id, s.cookie)).status).toBe(200); // a submitted application's file, in a closed batch

    const other = await student("lain");
    const othersBatch = await openBatch();
    const othersApp = await addSubmitted(other, othersBatch.id);
    const theirs = await seedFile({ applicationId: othersApp.id, year: othersBatch.year });
    const res = await readOwnFile(theirs.id, s.cookie);
    expect([res.status, await res.json()]).toEqual([404, { error: "not_found" }]);
  });

  test("another student's file, a deleted one, an unknown id and junk are one and the same 404", async () => {
    const { s, batch } = await ready();
    const other = await student("lain");
    const theirs = await seedFile({ applicationId: await addDraft(other.id, batch.id), year: batch.year });
    const mine = await upload(s, "family-card");
    await env.DB.prepare("UPDATE application_files SET deleted_at = ? WHERE id = ?").bind(Date.now(), mine.file.id).run();
    const seen = new Set<string>();
    for (const id of [theirs.id, mine.file.id, crypto.randomUUID(), "x", "../../etc/passwd", "%2e%2e", theirs.id.toUpperCase(), `${theirs.id}/extra`]) {
      const res = await readOwnFile(id, s.cookie);
      expect(res.status, id).toBe(404);
      seen.add(JSON.stringify(await res.json()));
    }
    expect([...seen]).toEqual(['{"error":"not_found"}']);
  });

  test("nobody 401, an admin account 403, the limiter (60 a minute per student) 429", async () => {
    const { s } = await ready();
    const done = await upload(s, "family-card");
    expect((await readOwnFile(done.file.id)).status).toBe(401);
    expect((await readOwnFile(done.file.id, await portalSignedIn(uniqueEmail("pengurus"), "super_admin"))).status).toBe(403);
    for (let i = 0; i < 60; i++) expect((await readOwnFile(done.file.id, s.cookie)).status).toBe(200);
    const limited = await readOwnFile(done.file.id, s.cookie);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
  });

  test("the row says there is a file and the bucket does not: 404 and one fixed line", async () => {
    const { s } = await ready();
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
    const done = await upload(s, "family-card");
    await env.PRIVATE_FILES.delete((await privateKeys())[0]!);
    expect((await readOwnFile(done.file.id, s.cookie)).status).toBe(404);
    expect(lines).toEqual(["[private-files] a file row has no object in the bucket"]);
  });

  test("without the bucket binding: 503 storage_unavailable", async () => {
    const { s } = await ready();
    const done = await upload(s, "family-card");
    const res = await portalCall(`/portal/api/files/${done.file.id}`, { cookie: s.cookie, env: { PRIVATE_FILES: undefined } });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("storage_unavailable");
  });
});

describe("ownership, every route, the other way round", () => {
  test("a student cannot upload into, replace in, delete from or read from another student's draft: there is no id to send", async () => {
    const { s, batch } = await ready();
    const other = await student("lain");
    const othersDraft = await addDraft(other.id, batch.id);
    const theirs = await seedFile({ applicationId: othersDraft, year: batch.year, slot: "self-photo" });

    // Their own upload lands in their own draft, whatever the request says.
    const mine = await putFile("self-photo", bytes.png(300), { cookie: s.cookie, headers: { "x-application-id": othersDraft }, query: `?applicationId=${othersDraft}&application_id=${othersDraft}` });
    expect(mine.status).toBe(201);
    const row = (await fileRows()).find((entry) => entry.id !== theirs.id)!;
    expect(row.application_id).not.toBe(othersDraft);
    expect((await draftRows()).find((draft) => draft.user_id === s.id)!.id).toBe(row.application_id);

    // The other student's file in the slot does not count against theirs, and cannot be replaced by them.
    expect((await putFile("self-photo", bytes.png(300), { cookie: s.cookie, replace: theirs.id })).status).toBe(404);
    expect((await deleteFile(theirs.id, s.cookie)).status).toBe(404);
    expect((await readOwnFile(theirs.id, s.cookie)).status).toBe(404);
    expect(await privateKeys()).toContain(theirs.key);
    expect((await fileRows()).find((entry) => entry.id === theirs.id)?.deleted_at).toBeNull();
  });

  test("a student's own session cannot be used by another account's cookie (a value signed for another user)", async () => {
    const { s } = await ready();
    const done = await upload(s, "family-card");
    const other = await student("lain");
    expect((await readOwnFile(done.file.id, other.cookie)).status).toBe(404);
  });
});
