import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vitest";
import { auditRetentionDays, runCleanup } from "../src/cron/cleanup";
import type { Bindings } from "../src/env";
import worker from "../src/worker";
import { uniqueEmail } from "./helpers";

// src/cron/cleanup.ts and the `scheduled` export of src/worker.ts.

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 12, 3, 17); // the scheduled time of a run

afterEach(() => {
  vi.restoreAllMocks();
});

async function makeUser(): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO users (id, name, email, email_verified) VALUES (?, 'U', ?, 1)").bind(id, uniqueEmail("cron")).run();
  return id;
}

async function addSession(userId: string, expiresAt: number, label: string) {
  await env.DB.prepare("INSERT INTO session (id, expires_at, token, user_id) VALUES (?, ?, ?, ?)").bind(`s-${label}`, expiresAt, `t-${label}`, userId).run();
}

async function addVerification(expiresAt: number, label: string) {
  await env.DB.prepare("INSERT INTO verification (id, identifier, value, expires_at) VALUES (?, ?, ?, ?)").bind(`v-${label}`, `hash-${label}`, "value", expiresAt).run();
}

async function addAudit(ageDays: number, label: string) {
  await env.DB.prepare("INSERT INTO audit_log (id, actor_email, action, created_at) VALUES (?, 'a@example.test', 'x.y', ?)").bind(`a-${label}`, NOW - ageDays * DAY).run();
}

async function ids(table: "session" | "verification" | "audit_log"): Promise<string[]> {
  const { results } = await env.DB.prepare(`SELECT id FROM ${table} ORDER BY id`).all<{ id: string }>();
  return results.map((row) => row.id);
}

/** What the platform does at the cron time: calls `scheduled` with a controller, then waits for waitUntil. */
async function fireCron(overrides: Partial<Bindings> = {}, scheduledTime = NOW) {
  const ctx = createExecutionContext();
  await worker.scheduled!(createScheduledController({ scheduledTime, cron: "17 3 * * *" }), { ...env, ...overrides } as Bindings, ctx);
  await waitOnExecutionContext(ctx);
}

describe("the cleanup", () => {
  test("deletes expired sessions and keeps the live ones (including one that expires exactly later today)", async () => {
    const user = await makeUser();
    await addSession(user, NOW - 1, "just-expired");
    await addSession(user, NOW - 30 * DAY, "long-expired");
    await addSession(user, NOW + 1, "about-to-expire");
    await addSession(user, NOW + 7 * DAY, "fresh");

    const result = await runCleanup(env, NOW);
    expect(result.sessions).toBe(2);
    expect(await ids("session")).toEqual(["s-about-to-expire", "s-fresh"]);
  });

  test("deletes expired verification rows (reset links, invites, OAuth state) and keeps valid ones", async () => {
    await addVerification(NOW - 1000, "expired-reset");
    await addVerification(NOW - 8 * DAY, "expired-invite");
    await addVerification(NOW + 20 * 60 * 1000, "reset-in-use");
    await addVerification(NOW + 7 * DAY, "invite-in-use");

    const result = await runCleanup(env, NOW);
    expect(result.verifications).toBe(2);
    expect(await ids("verification")).toEqual(["v-invite-in-use", "v-reset-in-use"]);
  });

  test("deletes audit rows older than the retention and keeps the rest", async () => {
    await addAudit(400, "old");
    await addAudit(366, "just-old");
    await addAudit(364, "just-fresh");
    await addAudit(1, "yesterday");

    const result = await runCleanup({ ...env, AUDIT_RETENTION_DAYS: "365" }, NOW);
    expect(result).toMatchObject({ audit: 2, auditRetentionDays: 365 });
    expect(await ids("audit_log")).toEqual(["a-just-fresh", "a-yesterday"]);
  });

  test("the retention is a variable: 30 days keeps less", async () => {
    await addAudit(31, "a");
    await addAudit(29, "b");
    expect((await runCleanup({ ...env, AUDIT_RETENTION_DAYS: "30" }, NOW)).audit).toBe(1);
    expect(await ids("audit_log")).toEqual(["a-b"]);
  });

  // Negative check: make an unreadable retention delete everything.
  test("an unset, zero, negative, fractional or unreadable retention keeps every audit row", async () => {
    await addAudit(5000, "ancient");
    for (const value of [undefined, "", "0", "-5", "1.5", "abc", "30 days", "Infinity", "NaN", " "]) {
      const result = await runCleanup({ ...env, AUDIT_RETENTION_DAYS: value }, NOW);
      expect(result, String(value)).toMatchObject({ audit: 0, auditRetentionDays: null });
    }
    expect(await ids("audit_log")).toEqual(["a-ancient"]);
  });

  test("auditRetentionDays", () => {
    expect(auditRetentionDays("365")).toBe(365);
    expect(auditRetentionDays(" 90 ")).toBe(90);
    for (const bad of [undefined, "", "0", "-1", "1.5", "x", "1e3", "Infinity"]) expect(auditRetentionDays(bad), String(bad)).toBeNull();
  });

  test("a second run finds nothing to do", async () => {
    const user = await makeUser();
    await addSession(user, NOW - 1, "x");
    await addVerification(NOW - 1, "x");
    await addAudit(400, "x");
    expect(await runCleanup(env, NOW)).toEqual({ sessions: 1, verifications: 1, audit: 1, auditRetentionDays: 365 });
    expect(await runCleanup(env, NOW)).toEqual({ sessions: 0, verifications: 0, audit: 0, auditRetentionDays: 365 });
  });

  test("a run has a bounded cost: at most 5000 rows per table, the rest goes tomorrow", async () => {
    const user = await makeUser();
    await env.DB.exec(
      `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 5200)
       INSERT INTO session (id, expires_at, token, user_id) SELECT 'bulk-' || x, ${NOW - DAY}, 'bulk-token-' || x, '${user}' FROM n`.replace(/\s+/g, " "),
    );
    expect((await runCleanup(env, NOW)).sessions).toBe(5000);
    expect((await runCleanup(env, NOW)).sessions).toBe(200);
    expect(await ids("session")).toEqual([]);
  });

  test("other tables are never touched", async () => {
    const user = await makeUser();
    await env.DB.prepare("INSERT INTO account (id, account_id, provider_id, user_id, password) VALUES ('acc', ?, 'credential', ?, 'x')").bind(user, user).run();
    await env.DB.prepare("INSERT INTO announcements (id, title, body, severity, active) VALUES ('an', 'Judul', 'Isi pengumuman', 'info', 1)").run();
    await addSession(user, NOW - DAY, "x");
    await runCleanup(env, NOW);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM users").first<{ n: number }>())!.n).toBe(1);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM account").first<{ n: number }>())!.n).toBe(1);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM announcements").first<{ n: number }>())!.n).toBe(1);
  });
});

describe("the scheduled handler", () => {
  test("is exported and runs the cleanup at the scheduled time, not at 'now'", async () => {
    expect(typeof worker.scheduled).toBe("function");
    const user = await makeUser();
    const future = Date.now() + 40 * DAY; // 40 days from the real clock: live today, expired by the scheduled time
    await addSession(user, future, "later");
    await addSession(user, future + 20 * DAY, "much-later");
    await fireCron({}, future + DAY);
    expect(await ids("session")).toEqual(["s-much-later"]);
  });

  test("logs one line with counts and the retention, nothing that identifies anyone", async () => {
    const lines: string[] = [];
    for (const method of ["info", "log", "error", "warn"] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
    const user = await makeUser();
    await addSession(user, NOW - 1, "x");
    await addAudit(400, "x");
    await fireCron();
    expect(lines).toEqual(["[cron] cleanup: sessions=1 verifications=0 audit=1 retention=365"]);
  });

  test("a failure is logged by message and rethrown, so the run shows as failed", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
    await env.DB.exec("ALTER TABLE verification RENAME TO verification_gone");
    try {
      await expect(fireCron()).rejects.toThrow();
    } finally {
      await env.DB.exec("ALTER TABLE verification_gone RENAME TO verification");
    }
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[cron\] cleanup failed: /);
  });

  test("the fetch handler still works next to it", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch!(new Request("https://admin.test/api/config", { headers: { "cf-connecting-ip": "203.0.113.5" } }), env as Bindings, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
  });
});
