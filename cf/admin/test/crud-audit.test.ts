import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, test } from "vitest";
import { withAudit } from "../src/api/crud";
import * as schema from "../src/db/schema";

// `withAudit` against the real D1 (docs/cloudflare/admin-crud.md#8-audit-rows): the audit row is part of
// the same batch as the change and exists only if the change did.

const db = () => drizzle(env.DB, { schema });
const actor = { id: "actor-1", email: "Admin@Example.Test" };

async function auditRows() {
  return (await env.DB.prepare("SELECT actor_id, actor_email, action, resource_type, resource_id, metadata, created_at FROM audit_log ORDER BY rowid").all<{
    actor_id: string | null;
    actor_email: string;
    action: string;
    resource_type: string;
    resource_id: string;
    metadata: string | null;
    created_at: number;
  }>()).results;
}

async function titles() {
  return (await env.DB.prepare("SELECT title FROM announcements ORDER BY title").all<{ title: string }>()).results.map((row) => row.title);
}

const announcement = (id: string, title = "Judul") => ({ id, title, body: "Isi pengumuman" });

/** `audit_log.actor_id` is a foreign key: the actor has to exist. */
async function createUser(id: string, email: string) {
  await env.DB.prepare("INSERT INTO users (id, name, email, email_verified, role) VALUES (?, 'Aktor', ?, 1, 'editor')").bind(id, email).run();
}

beforeEach(async () => {
  await createUser("actor-1", "admin@example.test");
});

describe("withAudit", () => {
  test("a change that took effect writes one audit row, and the results are the change's own", async () => {
    const before = Date.now();
    const [rows] = await withAudit(
      db(),
      actor,
      { action: "announcement.create", resourceType: "announcement", resourceId: "a1", fields: ["title", "body"], label: "Judul" },
      [db().insert(schema.announcements).values(announcement("a1")).returning({ id: schema.announcements.id })],
    );
    expect(rows).toEqual([{ id: "a1" }]); // not the audit row's result
    expect(await titles()).toEqual(["Judul"]);

    const [row, ...rest] = await auditRows();
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      actor_id: "actor-1",
      actor_email: "admin@example.test", // lower-cased, like db/audit.ts
      action: "announcement.create",
      resource_type: "announcement",
      resource_id: "a1",
    });
    expect(JSON.parse(row!.metadata!)).toEqual({ fields: ["title", "body"], label: "Judul" });
    expect(row!.created_at).toBeGreaterThanOrEqual(before - 1000); // the database's clock default
  });

  test("an update or delete that matched nothing writes no audit row (this is what makes a lost race leave no trace)", async () => {
    await env.DB.prepare("INSERT INTO announcements (id, title, body) VALUES ('a1', 'Judul', 'Isi pengumuman')").run();

    const [updated] = await withAudit(db(), actor, { action: "announcement.update", resourceType: "announcement", resourceId: "a1", fields: ["title"] }, [
      db().update(schema.announcements).set({ title: "Baru" }).where(eq(schema.announcements.id, "no-such-row")).returning(),
    ]);
    expect(updated).toEqual([]);

    const [deleted] = await withAudit(db(), actor, { action: "announcement.delete", resourceType: "announcement", resourceId: "a1" }, [
      db().delete(schema.announcements).where(eq(schema.announcements.id, "no-such-row")).returning({ id: schema.announcements.id }),
    ]);
    expect(deleted).toEqual([]);

    expect(await auditRows()).toEqual([]);
    expect(await titles()).toEqual(["Judul"]);
  });

  test("the audit row is written only when the LAST statement changed something", async () => {
    // changes() describes the statement just before the audit insert: a mutation placed first is not what it looks at.
    await env.DB.prepare("INSERT INTO announcements (id, title, body) VALUES ('a1', 'Judul', 'Isi pengumuman')").run();
    await withAudit(db(), actor, { action: "announcement.update", resourceType: "announcement", resourceId: "a1" }, [
      db().update(schema.announcements).set({ title: "Baru" }).where(eq(schema.announcements.id, "a1")).returning(),
      db().update(schema.announcements).set({ title: "Nada" }).where(eq(schema.announcements.id, "missing")).returning(),
    ]);
    expect(await titles()).toEqual(["Baru"]);
    expect(await auditRows()).toEqual([]);
  });

  test("a failing change writes no audit row, and a failing audit row undoes the change", async () => {
    // The change fails (a CHECK: the severity must be one of three): nothing is written.
    await expect(
      withAudit(db(), actor, { action: "announcement.create", resourceType: "announcement", resourceId: "bad" }, [
        db().insert(schema.announcements).values({ ...announcement("bad"), severity: "loud" as "info" }).returning(),
      ]),
    ).rejects.toThrow();
    expect(await auditRows()).toEqual([]);

    // The audit insert fails (its table is gone): the change is rolled back with it.
    await env.DB.exec("ALTER TABLE audit_log RENAME TO audit_log_gone");
    try {
      await expect(
        withAudit(db(), actor, { action: "announcement.create", resourceType: "announcement", resourceId: "a1" }, [db().insert(schema.announcements).values(announcement("a1")).returning()]),
      ).rejects.toThrow();
    } finally {
      await env.DB.exec("ALTER TABLE audit_log_gone RENAME TO audit_log");
    }
    expect(await titles()).toEqual([]);
  });

  test("no fields and no label is a row without metadata; the label is cut", async () => {
    await withAudit(db(), actor, { action: "announcement.delete", resourceType: "announcement", resourceId: "x" }, [db().insert(schema.announcements).values(announcement("x")).returning()]);
    await withAudit(db(), actor, { action: "announcement.update", resourceType: "announcement", resourceId: "y", label: "L".repeat(300) }, [
      db().insert(schema.announcements).values(announcement("y", "Dua")).returning(),
    ]);
    const [first, second] = await auditRows();
    expect(first!.metadata).toBeNull();
    expect((JSON.parse(second!.metadata!) as { label: string }).label).toHaveLength(120);
  });

  test("a value that looks like SQL is bound, never part of the statement", async () => {
    const hostile = "x'); DROP TABLE audit_log; --";
    await createUser(hostile, "hostile@example.test");
    await withAudit(db(), { id: hostile, email: "Hostile@Example.Test" }, { action: "announcement.create", resourceType: "announcement", resourceId: hostile, label: hostile }, [
      db().insert(schema.announcements).values(announcement("a1")).returning(),
    ]);
    const [row] = await auditRows();
    expect(row).toMatchObject({ actor_id: hostile, resource_id: hostile });
    expect((JSON.parse(row!.metadata!) as { label: string }).label).toBe(hostile);
  });
});
