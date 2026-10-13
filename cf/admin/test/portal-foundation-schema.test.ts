import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test } from "vitest";
import { seed } from "../scripts/seed-data";
import { DRAFT_FORM_DATA_MAX_LENGTH, MAX_FILE_BYTES } from "../shared/application-form/limits";
import { SLOT_IDS } from "../shared/application-form/slots";
import { STEP_IDS } from "../shared/application-form/steps";
import * as schema from "../src/db/schema";
import { SINGLETON_ROWS, TABLES_CHILD_FIRST } from "./tables";

// Migration 0012_portal_applications: the tables of the student portal, checked against the real SQLite in workerd,
// with raw SQL where the point is that the DATABASE refuses a value (not Drizzle, not the API). docs/cloudflare/
// portal-architecture.md, section 7.5.

const db = drizzle(env.DB, { schema });
const uid = () => crypto.randomUUID();
const CHECK = /CHECK constraint failed/;
const UNIQUE = /UNIQUE constraint failed/;
const FOREIGN_KEY = /FOREIGN KEY constraint failed/;

type Row = Record<string, string | number | null>;

async function insert(table: string, row: Row) {
  const columns = Object.keys(row);
  return env.DB.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
    .bind(...Object.values(row))
    .run();
}

async function scalar<T = unknown>(sql: string, ...binds: unknown[]): Promise<T> {
  return (await env.DB.prepare(sql).bind(...binds).first<{ v: T }>())!.v;
}

let n = 0;
async function aUser(): Promise<string> {
  const id = uid();
  await insert("users", { id, name: "Contoh Siswa", email: `siswa-${++n}@example.test` });
  return id;
}
let years = 0;
async function aBatch(): Promise<string> {
  const id = uid();
  await insert("admission_batches", { id, year: 2024 + (years++ % 77), name: "Contoh Batch", opens_at: 1_000, closes_at: 2_000 });
  return id;
}
async function aDraft(userId?: string, batchId?: string): Promise<{ id: string; userId: string; batchId: string }> {
  const id = uid();
  const user = userId ?? (await aUser());
  const batch = batchId ?? (await aBatch());
  await insert("application_drafts", { id, user_id: user, batch_id: batch });
  return { id, userId: user, batchId: batch };
}

const file = (patch: Row = {}): Row => ({ id: uid(), application_id: uid(), slot: "family-card", content_type: "application/pdf", size: 1234, checksum: "0123456789abcdef0123456789abcdef", ...patch });

describe("the migration", () => {
  test("thirteen migrations, 0000 to 0012, the last one is this", () => {
    expect(env.TEST_MIGRATIONS).toHaveLength(13);
    expect(env.TEST_MIGRATIONS.at(-1)!.name).toBe("0012_portal_applications.sql");
    expect(env.TEST_MIGRATIONS.map((migration) => migration.name.slice(0, 4))).toEqual(Array.from({ length: 13 }, (_, i) => String(i).padStart(4, "0")));
  });

  test("it makes the four tables and nothing else: student_applications is unchanged", async () => {
    const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('application_drafts', 'application_files', 'private_storage', 'email_daily') ORDER BY name").all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual(["application_drafts", "application_files", "email_daily", "private_storage"]);
    const columns = await env.DB.prepare("SELECT name FROM pragma_table_info('student_applications') ORDER BY cid").all<{ name: string }>();
    expect(columns.results.map((c) => c.name)).toEqual([
      "id", "user_id", "batch_id", "full_name", "email", "whatsapp", "school_name", "graduation_year", "branch_preference", "motivation",
      "economic_background", "form_data", "status", "review_notes", "reviewed_by", "reviewed_at", "submitted_at", "updated_at",
    ]);
  });

  test("the tables are listed in test/tables.ts, so setup empties them between tests", () => {
    for (const table of ["application_drafts", "application_files", "private_storage", "email_daily"]) expect(TABLES_CHILD_FIRST as readonly string[]).toContain(table);
    // Children first: a draft goes before the batch and the user it refers to.
    const order = (name: string) => (TABLES_CHILD_FIRST as readonly string[]).indexOf(name);
    expect(order("application_drafts")).toBeLessThan(order("admission_batches"));
    expect(order("application_drafts")).toBeLessThan(order("users"));
  });

  test("the SQL of the migration seeds the counter row with zeros, and only that row", () => {
    const sql = env.TEST_MIGRATIONS.at(-1)!.queries.join("\n");
    expect(sql).toMatch(/INSERT INTO `private_storage` \(`id`, `bytes`, `files`\) VALUES \('private-files', 0, 0\)/);
    expect(sql.match(/INSERT INTO/g)).toHaveLength(1);
  });

  test("the CHECK lists in the SQL are the lists the code names (slots, steps, sizes: one source in shared/application-form)", async () => {
    const files = await scalar<string>("SELECT sql AS v FROM sqlite_master WHERE type = 'table' AND name = 'application_files'");
    for (const slot of SLOT_IDS) expect(files, slot).toContain(`'${slot}'`);
    expect(files).toContain(`<= ${MAX_FILE_BYTES}`);
    const drafts = await scalar<string>("SELECT sql AS v FROM sqlite_master WHERE type = 'table' AND name = 'application_drafts'");
    for (const step of STEP_IDS) expect(drafts, step).toContain(`'${step}'`);
    expect(drafts).toContain(`<= ${DRAFT_FORM_DATA_MAX_LENGTH}`);
  });
});

describe("application_drafts", () => {
  test("a draft needs only its student and its batch: the form data starts as an empty object and the step as nothing", async () => {
    const { id } = await aDraft();
    const row = await env.DB.prepare("SELECT form_data, last_step, created_at, updated_at FROM application_drafts WHERE id = ?").bind(id).first<{ form_data: string; last_step: string | null; created_at: number; updated_at: number }>();
    expect(row!.form_data).toBe("{}");
    expect(row!.last_step).toBeNull();
    expect(row!.created_at).toBeGreaterThan(0);
    expect(row!.updated_at).toBeGreaterThan(0);
  });

  test("one draft per student per batch; another student, or another batch, is fine", async () => {
    const first = await aDraft();
    await expect(insert("application_drafts", { id: uid(), user_id: first.userId, batch_id: first.batchId })).rejects.toThrow(UNIQUE);
    await aDraft(undefined, first.batchId);
    await aDraft(first.userId, undefined);
    expect(await scalar("SELECT count(*) AS v FROM application_drafts")).toBe(3);
  });

  test("the student and the batch must exist (foreign keys)", async () => {
    await expect(insert("application_drafts", { id: uid(), user_id: uid(), batch_id: await aBatch() })).rejects.toThrow(FOREIGN_KEY);
    await expect(insert("application_drafts", { id: uid(), user_id: await aUser(), batch_id: uid() })).rejects.toThrow(FOREIGN_KEY);
  });

  test("deleting the account deletes the draft (cascade)", async () => {
    const { userId } = await aDraft();
    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
    expect(await scalar("SELECT count(*) AS v FROM application_drafts")).toBe(0);
  });

  test("a batch with a draft cannot be deleted (restrict): the admin's foreign-key-to-409 mapping answers in_use", async () => {
    const { batchId } = await aDraft();
    await expect(env.DB.prepare("DELETE FROM admission_batches WHERE id = ?").bind(batchId).run()).rejects.toThrow(FOREIGN_KEY);
    expect(await scalar("SELECT count(*) AS v FROM admission_batches WHERE id = ?", batchId)).toBe(1);
  });

  describe("form_data is a JSON object of at most 98,304 characters", () => {
    const withData = async (form_data: string) => insert("application_drafts", { id: uid(), user_id: await aUser(), batch_id: await aBatch(), form_data });

    test("objects pass", async () => {
      await withData("{}");
      await withData('{"identity":{"fullName":"Sari"}}');
    });
    test("anything that is not an object is refused by the database, as a CHECK failure (not a JSON error)", async () => {
      for (const bad of ["[]", "[1,2]", "null", "1", '"text"', "true", "not json", "{", "", '{"a":}']) {
        await expect(withData(bad), JSON.stringify(bad)).rejects.toThrow(CHECK);
      }
    });
    test("the length: 98,304 characters pass, one more does not", async () => {
      const padding = (length: number) => `{"a":"${"x".repeat(length - 8)}"}`;
      expect(padding(DRAFT_FORM_DATA_MAX_LENGTH)).toHaveLength(DRAFT_FORM_DATA_MAX_LENGTH);
      await withData(padding(DRAFT_FORM_DATA_MAX_LENGTH));
      await expect(withData(padding(DRAFT_FORM_DATA_MAX_LENGTH + 1))).rejects.toThrow(CHECK);
    });
    test("an update cannot get round it either", async () => {
      const { id } = await aDraft();
      await expect(env.DB.prepare("UPDATE application_drafts SET form_data = '[]' WHERE id = ?").bind(id).run()).rejects.toThrow(CHECK);
      await env.DB.prepare("UPDATE application_drafts SET form_data = json_set(form_data, '$.identity', json('{\"nickname\":\"Sari\"}')) WHERE id = ?").bind(id).run();
      expect(await scalar("SELECT form_data AS v FROM application_drafts WHERE id = ?", id)).toBe('{"identity":{"nickname":"Sari"}}');
    });
  });

  test("last_step is one of the seven buckets, or nothing", async () => {
    for (const step of STEP_IDS) await insert("application_drafts", { id: uid(), user_id: await aUser(), batch_id: await aBatch(), last_step: step });
    await insert("application_drafts", { id: uid(), user_id: await aUser(), batch_id: await aBatch(), last_step: null });
    for (const bad of ["review", "intro", "Identity", "", "identity "]) {
      await expect(insert("application_drafts", { id: uid(), user_id: await aUser(), batch_id: await aBatch(), last_step: bad }), JSON.stringify(bad)).rejects.toThrow(CHECK);
    }
  });

  test("a step save is a patch of one key: the other buckets are not touched", async () => {
    const { id } = await aDraft();
    const save = (step: string, value: object) =>
      env.DB.prepare("UPDATE application_drafts SET form_data = json_set(form_data, '$.' || ?, json(?)), last_step = ?, updated_at = ? WHERE id = ?").bind(step, JSON.stringify(value), step, Date.now(), id).run();
    await save("identity", { nickname: "Sari" });
    await save("household", { fatherName: "Bapak" });
    await save("identity", { nickname: "Dewi" });
    expect(JSON.parse(await scalar<string>("SELECT form_data AS v FROM application_drafts WHERE id = ?", id))).toEqual({ identity: { nickname: "Dewi" }, household: { fatherName: "Bapak" } });
    expect(await scalar("SELECT last_step AS v FROM application_drafts WHERE id = ?", id)).toBe("identity");
  });

  test("Drizzle round trip: the JSON column comes back as an object", async () => {
    const userId = await aUser();
    const batchId = await aBatch();
    await db.insert(schema.applicationDrafts).values({ userId, batchId, formData: { identity: { nickname: "Sari" } }, lastStep: "identity" });
    const [row] = await db.select().from(schema.applicationDrafts).where(eq(schema.applicationDrafts.userId, userId));
    expect(row!.formData).toEqual({ identity: { nickname: "Sari" } });
    expect(row!.lastStep).toBe("identity");
    expect(row!.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("application_files", () => {
  test("a file row needs its slot, its sniffed type, its size and its checksum; no client file name exists", async () => {
    await insert("application_files", file());
    const columns = await env.DB.prepare("SELECT name FROM pragma_table_info('application_files') ORDER BY cid").all<{ name: string }>();
    expect(columns.results.map((c) => c.name)).toEqual(["id", "application_id", "slot", "content_type", "size", "width", "height", "checksum", "created_at", "deleted_at"]);
  });

  test("all sixteen slots, and nothing else, as case-sensitive names", async () => {
    for (const slot of SLOT_IDS) await insert("application_files", file({ slot }));
    for (const bad of ["family_card", "Family-Card", "family-card ", "", "photo", "marketing-proof"]) {
      await expect(insert("application_files", file({ slot: bad })), JSON.stringify(bad)).rejects.toThrow(CHECK);
    }
  });

  test("the four types the bytes can be (no GIF, no SVG)", async () => {
    for (const content_type of ["image/png", "image/jpeg", "image/webp", "application/pdf"]) await insert("application_files", file({ content_type }));
    for (const bad of ["image/gif", "image/svg+xml", "text/html", "application/octet-stream", "IMAGE/PNG", ""]) {
      await expect(insert("application_files", file({ content_type: bad })), bad).rejects.toThrow(CHECK);
    }
  });

  test("a size is 1 byte to 10,000,000", async () => {
    for (const size of [1, 812_345, MAX_FILE_BYTES]) await insert("application_files", file({ size }));
    for (const size of [0, -1, MAX_FILE_BYTES + 1, 2 ** 40]) await expect(insert("application_files", file({ size })), String(size)).rejects.toThrow(CHECK);
  });

  test("width and height: both or neither, positive (a lone NULL would slip through a naive CHECK)", async () => {
    await insert("application_files", file({ width: null, height: null }));
    await insert("application_files", file({ width: 1, height: 1 }));
    await insert("application_files", file({ width: 4000, height: 3000 }));
    for (const [width, height] of [
      [100, null],
      [null, 100],
      [0, 100],
      [100, 0],
      [-1, 5],
      [5, -1],
      [0, 0],
    ] as const) {
      await expect(insert("application_files", file({ width, height })), `${width}x${height}`).rejects.toThrow(CHECK);
    }
  });

  test("the checksum is the 32 lowercase hex characters of an MD5", async () => {
    await insert("application_files", file({ checksum: "d41d8cd98f00b204e9800998ecf8427e" }));
    for (const bad of ["", "d41d8cd98f00b204e9800998ecf8427", "d41d8cd98f00b204e9800998ecf8427ee", "D41D8CD98F00B204E9800998ECF8427E", "g41d8cd98f00b204e9800998ecf8427e", "d41d8cd98f00b204e9800998ecf8427 "]) {
      await expect(insert("application_files", file({ checksum: bad })), JSON.stringify(bad)).rejects.toThrow(CHECK);
    }
  });

  test("application_id has NO foreign key: it is the draft's id, later the application's (one value, two tables)", async () => {
    const foreign = await env.DB.prepare("SELECT count(*) AS v FROM pragma_foreign_key_list('application_files')").first<{ v: number }>();
    expect(foreign!.v).toBe(0);
    // So a row can point at an id that is in neither table: that is an orphan, for the cleanup's sweep to find.
    const orphan = file();
    await insert("application_files", orphan);
    const found = await env.DB.prepare(
      "SELECT f.id FROM application_files f WHERE NOT EXISTS (SELECT 1 FROM application_drafts d WHERE d.id = f.application_id) AND NOT EXISTS (SELECT 1 FROM student_applications a WHERE a.id = f.application_id)",
    ).all<{ id: string }>();
    expect(found.results).toEqual([{ id: orphan.id }]);
  });

  test("deleted_at is nullable and a soft delete is an update", async () => {
    const row = file();
    await insert("application_files", row);
    expect(await scalar("SELECT deleted_at AS v FROM application_files WHERE id = ?", row.id)).toBeNull();
    await env.DB.prepare("UPDATE application_files SET deleted_at = ? WHERE id = ?").bind(Date.now(), row.id).run();
    expect(await scalar("SELECT deleted_at IS NOT NULL AS v FROM application_files WHERE id = ?", row.id)).toBe(1);
  });

  test("the index serves the file list and the per-slot count of an application", async () => {
    // origin 'c' = made by CREATE INDEX (the primary key's own index is 'pk').
    const index = await env.DB.prepare("SELECT name, \"unique\" AS u FROM pragma_index_list('application_files') WHERE origin = 'c'").all<{ name: string; u: number }>();
    expect(index.results).toEqual([{ name: "application_files_application_slot_idx", u: 0 }]);
    const columns = await env.DB.prepare("SELECT name FROM pragma_index_info('application_files_application_slot_idx') ORDER BY seqno").all<{ name: string }>();
    expect(columns.results.map((c) => c.name)).toEqual(["application_id", "slot"]);
    for (const query of [
      "SELECT * FROM application_files WHERE application_id = ? AND deleted_at IS NULL",
      "SELECT count(*) FROM application_files WHERE application_id = ? AND slot = ? AND deleted_at IS NULL",
    ]) {
      const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${query}`).bind(...(query.includes("slot = ?") ? ["x", "family-card"] : ["x"])).all<{ detail: string }>();
      expect(plan.results.map((p) => p.detail).join(" "), query).toContain("application_files_application_slot_idx");
    }
  });
});

describe("private_storage: the one counter of the private bucket", () => {
  test("the row exists with zeros (the migration's, put back by test/setup.ts after it empties the tables)", async () => {
    expect(await env.DB.prepare("SELECT id, bytes, files FROM private_storage").all()).toMatchObject({ results: [{ id: "private-files", bytes: 0, files: 0 }] });
    expect(Object.keys(SINGLETON_ROWS)).toEqual(["private_storage"]);
  });

  test("there is only one row, and the counters cannot go negative", async () => {
    await expect(insert("private_storage", { id: "another", bytes: 0, files: 0 })).rejects.toThrow(CHECK);
    await expect(insert("private_storage", { id: "private-files", bytes: 0, files: 0 })).rejects.toThrow(/UNIQUE|PRIMARY KEY/);
    await expect(env.DB.prepare("UPDATE private_storage SET bytes = -1").run()).rejects.toThrow(CHECK);
    await expect(env.DB.prepare("UPDATE private_storage SET files = -1").run()).rejects.toThrow(CHECK);
  });

  test("the budget guard of the design: one atomic UPDATE that changes nothing when the bytes do not fit", async () => {
    const reserve = (size: number, budget: number) =>
      env.DB.prepare("UPDATE private_storage SET bytes = bytes + ?1, files = files + 1 WHERE id = 'private-files' AND bytes + ?1 <= ?2").bind(size, budget).run();
    expect((await reserve(600, 1000)).meta.changes).toBe(1);
    expect((await reserve(400, 1000)).meta.changes).toBe(1); // exactly the budget
    expect((await reserve(1, 1000)).meta.changes).toBe(0); // one byte over: refused, nothing written
    expect(await env.DB.prepare("SELECT bytes, files FROM private_storage").first()).toEqual({ bytes: 1000, files: 2 });
  });
});

describe("email_daily: the Resend counter of the day", () => {
  test("day is a UTC date, YYYY-MM-DD; sent starts at 0 and is never negative", async () => {
    await insert("email_daily", { day: "2026-10-13" });
    expect(await scalar("SELECT sent AS v FROM email_daily WHERE day = '2026-10-13'")).toBe(0);
    for (const bad of ["2026-1-13", "20261013", "2026/10/13", "today", "", "2026-10-13T00:00", "2026-10-1x"]) {
      await expect(insert("email_daily", { day: bad }), bad).rejects.toThrow(CHECK);
    }
    await expect(insert("email_daily", { day: "2026-10-14", sent: -1 })).rejects.toThrow(CHECK);
  });

  test("the statement of the design (increment before each send, stop at the limit) works on D1, one row written per email", async () => {
    const take = (day: string, limit: number) =>
      env.DB.prepare("INSERT INTO email_daily (day, sent) VALUES (?1, 1) ON CONFLICT (day) DO UPDATE SET sent = sent + 1 WHERE sent < ?2 RETURNING sent").bind(day, limit).first<{ sent: number }>();
    expect(await take("2026-10-13", 3)).toEqual({ sent: 1 });
    expect(await take("2026-10-13", 3)).toEqual({ sent: 2 });
    expect(await take("2026-10-13", 3)).toEqual({ sent: 3 });
    expect(await take("2026-10-13", 3)).toBeNull(); // the day is spent: nothing returned, nothing written
    expect(await scalar("SELECT sent AS v FROM email_daily WHERE day = '2026-10-13'")).toBe(3);
    expect(await take("2026-10-14", 3)).toEqual({ sent: 1 }); // a new day starts again
  });
});

describe("the dev seed over a database that holds portal rows", () => {
  test("re-seeding empties drafts, files and email counters and resets the storage counter; a draft does not block it (its batch is RESTRICT)", async () => {
    const options = { password: "seed-test-password-123", now: Date.UTC(2026, 9, 12, 5, 0, 0) };
    await seed(env.DB, options);
    const student = await env.DB.prepare("SELECT id FROM users WHERE email = 'siswa-baru@example.test'").first<{ id: string }>();
    const batch = await env.DB.prepare("SELECT id FROM admission_batches ORDER BY year DESC LIMIT 1").first<{ id: string }>();
    const draft = await aDraft(student!.id, batch!.id);
    await insert("application_files", file({ application_id: draft.id }));
    await insert("email_daily", { day: "2026-10-12", sent: 7 });
    await env.DB.prepare("UPDATE private_storage SET bytes = 1234, files = 1").run();

    const result = await seed(env.DB, options);

    for (const table of ["application_drafts", "application_files", "email_daily"]) expect(await scalar(`SELECT count(*) AS v FROM ${table}`), table).toBe(0);
    expect(await env.DB.prepare("SELECT id, bytes, files FROM private_storage").all()).toMatchObject({ results: [{ id: "private-files", bytes: 0, files: 0 }] });
    expect(result.counts.private_storage).toBe(1);
  });
});
