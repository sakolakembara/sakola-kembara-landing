import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vitest";
import { runCleanup } from "../src/cron/cleanup";
import type { Bindings } from "../src/env";
import { runFilesHousekeeping } from "../src/private-files/housekeeping";
import { removeObjects } from "../src/private-files/remove";
import worker from "../src/worker";
import { addApplication, addBatch } from "./pendaftaran-helpers";
import { DAY } from "./public-helpers";
import { emptyBucketBeforeEach, fileRows, privateKeys, seedFile, storage } from "./private-files-helpers";

// The two chores of the private bucket that the daily Cron Trigger does (src/private-files/housekeeping.ts), and the
// promise next to them: NOTHING IS DELETED AUTOMATICALLY (Dzul, 2026-10-13). The chores finish what a person already
// asked for (a delete whose object could not be removed at the time) and recount the storage counter; they never age a
// file out, and no retention variable is read.

emptyBucketBeforeEach();

afterEach(() => {
  vi.restoreAllMocks();
});

const NOW = Date.UTC(2026, 9, 14, 3, 17); // the scheduled time of a run
const HOUR = 60 * 60 * 1000;

async function fireCron(overrides: Partial<Bindings> = {}, scheduledTime = NOW) {
  const ctx = createExecutionContext();
  await worker.scheduled!(createScheduledController({ scheduledTime, cron: "17 3 * * *" }), { ...env, ...overrides } as Bindings, ctx);
  await waitOnExecutionContext(ctx);
}

async function applicationWithFiles() {
  const batch = await addBatch();
  const application = await addApplication(batch.id);
  return { batch, application };
}

describe("finishing a delete that a person already asked for", () => {
  test("marked rows older than an hour lose their object and their row and their share of the counter; fresh marks and live files are left alone", async () => {
    const { batch, application } = await applicationWithFiles();
    const live = await seedFile({ applicationId: application.id, year: batch.year, slot: "family-card", size: 100 });
    const old = await seedFile({ applicationId: application.id, year: batch.year, slot: "self-photo", size: 200, deleted: NOW - 2 * HOUR });
    const fresh = await seedFile({ applicationId: application.id, year: batch.year, slot: "debt-proof", size: 300, deleted: NOW - 10 * 60 * 1000 });

    expect(await runFilesHousekeeping(env, NOW)).toEqual({ removed: 1, pending: 0 });
    expect(await privateKeys()).toEqual([fresh.key, live.key].sort());
    expect((await fileRows()).map((row) => row.id).sort()).toEqual([live.id, fresh.id].sort());
    expect(await storage()).toEqual({ bytes: 400, files: 2 });
    expect(old.key).not.toBe(live.key);

    // An hour later the fresh mark is old enough too.
    expect(await runFilesHousekeeping(env, NOW + 2 * HOUR)).toEqual({ removed: 1, pending: 0 });
    expect(await privateKeys()).toEqual([live.key]);
    expect(await storage()).toEqual({ bytes: 100, files: 1 });
    // And then there is nothing to do.
    expect(await runFilesHousekeeping(env, NOW + 3 * HOUR)).toEqual({ removed: 0, pending: 0 });
  });

  test("a marked file of an application that is gone (the year of its batch is unknown) is found by trying every batch year", async () => {
    const older = await addBatch();
    const newer = await addBatch();
    const gone = crypto.randomUUID(); // in neither table: the account and its draft were deleted
    const file = await seedFile({ applicationId: gone, year: older.year, slot: "family-card", size: 150, deleted: NOW - 3 * HOUR });
    expect(newer.year).not.toBe(older.year);
    expect(await runFilesHousekeeping(env, NOW)).toEqual({ removed: 1, pending: 0 });
    expect(await privateKeys()).toEqual([]);
    expect(await fileRows()).toEqual([]);
    expect(file.size).toBe(150);
  });

  test("when the bucket refuses, the row stays marked and is counted as pending; the next run tries again", async () => {
    const { batch, application } = await applicationWithFiles();
    await seedFile({ applicationId: application.id, year: batch.year, size: 100, deleted: NOW - 2 * HOUR });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const flaky = new Proxy(env.PRIVATE_FILES, {
      get(target, property) {
        if (property === "delete") return () => Promise.reject(new Error("r2 is down"));
        const value = Reflect.get(target, property) as unknown;
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    expect(await runFilesHousekeeping({ ...env, PRIVATE_FILES: flaky }, NOW)).toEqual({ removed: 0, pending: 1 });
    expect(await fileRows()).toHaveLength(1);
    expect(await runFilesHousekeeping(env, NOW)).toEqual({ removed: 1, pending: 0 });
    expect(await fileRows()).toEqual([]);
  });

  test("a run has a bounded cost: at most 200 files, the rest goes tomorrow", async () => {
    const { application } = await applicationWithFiles();
    await env.DB.exec(
      `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 230)
       INSERT INTO application_files (id, application_id, slot, content_type, size, checksum, deleted_at)
       SELECT printf('%08x-0000-4000-8000-%012x', x, x), '${application.id}', 'house-photos', 'image/png', 10, '00000000000000000000000000000000', ${NOW - 2 * HOUR} FROM n`.replace(/\s+/g, " "),
    );
    expect((await runFilesHousekeeping(env, NOW)).removed).toBe(200);
    expect((await runFilesHousekeeping(env, NOW)).removed).toBe(30);
    expect(await fileRows()).toEqual([]);
  });

  test("without the bucket binding the run does nothing and does not fail", async () => {
    const { batch, application } = await applicationWithFiles();
    await seedFile({ applicationId: application.id, year: batch.year, deleted: NOW - 2 * HOUR });
    expect(await runFilesHousekeeping({ ...env, PRIVATE_FILES: undefined } as unknown as Bindings, NOW)).toEqual({ removed: 0, pending: 0 });
    expect(await fileRows()).toHaveLength(1);
  });
});

describe("removing rows", () => {
  test("only a MARKED row is ever deleted or taken out of the counter, whatever ids are asked for: a live file's row stays", async () => {
    const { batch, application } = await applicationWithFiles();
    const live = await seedFile({ applicationId: application.id, year: batch.year, slot: "family-card", size: 100 });
    const marked = await seedFile({ applicationId: application.id, year: batch.year, slot: "self-photo", size: 200, deleted: NOW - 2 * HOUR });
    const removed = await removeObjects(env, [{ id: live.id, size: 100, keys: [live.key] }, { id: marked.id, size: 200, keys: [marked.key] }], NOW);
    expect(removed).toBe(2); // both were asked for; the statement itself decides which rows go
    expect((await fileRows()).map((row) => row.id)).toEqual([live.id]);
    // The counter lost the marked file's share only.
    expect(await storage()).toEqual({ bytes: 100, files: 1 });
  });
});

describe("the storage counter is recounted from the file rows", () => {
  test("a reservation that was never given back (too high) and a counter that fell behind (too low) are both put right", async () => {
    const { batch, application } = await applicationWithFiles();
    await seedFile({ applicationId: application.id, year: batch.year, size: 700 });
    await seedFile({ applicationId: application.id, year: batch.year, slot: "self-photo", size: 300, deleted: NOW - 10 * 60 * 1000 }); // marked, object still in the bucket: counts
    await env.DB.prepare("UPDATE private_storage SET bytes = 9999999, files = 77").run();
    await runFilesHousekeeping(env, NOW);
    expect(await storage()).toEqual({ bytes: 1000, files: 2 });
    await env.DB.prepare("UPDATE private_storage SET bytes = 0, files = 0").run();
    await runFilesHousekeeping(env, NOW);
    expect(await storage()).toEqual({ bytes: 1000, files: 2 });
  });
});

describe("nothing is deleted automatically (Dzul, 2026-10-13)", () => {
  test("no retention variable is read: with all three at 1 day, ancient files of a rejected application and a closed batch are all still there", async () => {
    const batch = await addBatch({ opensAt: new Date(NOW - 900 * DAY), closesAt: new Date(NOW - 800 * DAY), resultsPublishedAt: new Date(NOW - 790 * DAY) });
    const rejected = await addApplication(batch.id, { status: "rejected", reviewedAt: new Date(NOW - 790 * DAY) });
    const accepted = await addApplication(batch.id, { status: "accepted", reviewedAt: new Date(NOW - 790 * DAY) });
    const a = await seedFile({ applicationId: rejected.id, year: batch.year, size: 100, at: NOW - 800 * DAY });
    const b = await seedFile({ applicationId: accepted.id, year: batch.year, size: 100, at: NOW - 800 * DAY });
    await fireCron({ DRAFT_RETENTION_DAYS: "1", REJECTED_FILES_RETENTION_DAYS: "1", ACCEPTED_FILES_RETENTION_DAYS: "1", AUDIT_RETENTION_DAYS: "1" });
    expect(await privateKeys()).toEqual([a.key, b.key].sort());
    expect((await fileRows()).map((row) => row.deleted_at)).toEqual([null, null]);
    expect(await storage()).toEqual({ bytes: 200, files: 2 });
  });

  test("a draft whose batch closed long ago keeps its files (no draft sweep either)", async () => {
    const batch = await addBatch({ opensAt: new Date(NOW - 900 * DAY), closesAt: new Date(NOW - 800 * DAY) });
    const userId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO users (id, name, email, email_verified) VALUES (?, 'U', ?, 1)").bind(userId, `${userId}@example.test`).run();
    const draft = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO application_drafts (id, user_id, batch_id) VALUES (?, ?, ?)").bind(draft, userId, batch.id).run();
    const file = await seedFile({ applicationId: draft, year: batch.year, at: NOW - 800 * DAY });
    await fireCron({ DRAFT_RETENTION_DAYS: "1" });
    expect(await privateKeys()).toEqual([file.key]);
  });
});

describe("the scheduled handler", () => {
  test("runs the chores and logs one extra line of counts only when there was something to finish", async () => {
    const lines: string[] = [];
    for (const method of ["info", "log", "error", "warn"] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
    await fireCron();
    // A quiet day: only the cleanup's own line.
    expect(lines).toEqual(["[cron] cleanup: sessions=0 verifications=0 audit=0 retention=365"]);

    const { batch, application } = await applicationWithFiles();
    await seedFile({ applicationId: application.id, year: batch.year, deleted: NOW - 2 * HOUR });
    lines.length = 0;
    await fireCron();
    expect(lines).toEqual(["[cron] cleanup: sessions=0 verifications=0 audit=0 retention=365", "[cron] private files: removed=1 pending=0"]);
    expect(await fileRows()).toEqual([]);
  });

  test("the cleanup of sessions, tokens and audit rows still answers what it answered", async () => {
    expect(await runCleanup(env, NOW)).toEqual({ sessions: 0, verifications: 0, audit: 0, auditRetentionDays: 365 });
  });
});
