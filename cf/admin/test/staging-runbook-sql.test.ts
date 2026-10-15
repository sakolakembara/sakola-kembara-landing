import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import runbook from "../../../docs/cloudflare/staging-runbook.md?raw";
import { addDraft, addSubmitted, emptyBucketBeforeEach, fileRows, openBatch, seedFile, storage, student } from "./private-files-helpers";

// The SQL of the staging runbook's step 22 (SAKEM-098) that deletes ONE invented applicant: the owner pastes it into a real
// database, so it is run here, as written in the document, against the real schema (every migration, foreign keys on) with
// other people's rows next to it. The test reads the heredocs out of docs/cloudflare/staging-runbook.md, so a change to the
// document is a change to what is tested; the owner's shell fills in `$E`, and so does this test.

emptyBucketBeforeEach();

/** The `cat > <dir>/<name>.sql <<SQL ... SQL` blocks of the runbook, by file name. */
function heredocs(text: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of text.matchAll(/^cat > \S*\/([\w-]+\.sql) <<SQL\n([\s\S]*?)\nSQL$/gm)) found.set(match[1]!, match[2]!);
  return found;
}

/** The statements of a file: comments dropped, split where a line ends in `;` (none of them holds one inside a string). */
function statements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*(?:\n|$)/)
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "");
}

const blocks = heredocs(runbook);
const filled = (name: string, email: string) => blocks.get(name)!.replaceAll("$E", email);

async function run(name: string, email: string): Promise<Record<string, unknown>[]> {
  let last: Record<string, unknown>[] = [];
  for (const statement of statements(filled(name, email))) last = (await env.DB.prepare(statement).all<Record<string, unknown>>()).results;
  return last;
}

const count = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())!.n;

/** One student with a submitted application and some files (two live, one already marked deleted, as a failed purge leaves it). */
async function applicant(batch: { id: string; year: number }, label: string) {
  const person = await student(label);
  const application = await addSubmitted(person, batch.id);
  const live = [await seedFile({ applicationId: application.id, year: batch.year, slot: "family-card" }), await seedFile({ applicationId: application.id, year: batch.year, slot: "self-photo", kind: "jpeg" })];
  await seedFile({ applicationId: application.id, year: batch.year, slot: "debt-proof", deleted: true });
  return { person, application, live };
}

/** One student who started and never sent: a draft with a file. */
async function drafter(batch: { id: string; year: number }, label: string) {
  const person = await student(label);
  const draftId = await addDraft(person.id, batch.id);
  const file = await seedFile({ applicationId: draftId, year: batch.year, slot: "family-card" });
  return { person, draftId, file };
}

describe("the runbook's cleanup of one invented applicant (step 22)", () => {
  test("the document holds the three files, each marked, and nothing else of this kind", () => {
    expect([...blocks.keys()].sort()).toEqual(["cleanup.sql", "precheck.sql", "verify.sql"]);
    expect(blocks.get("precheck.sql")).toContain("-- runbook-test: precheck");
    expect(blocks.get("cleanup.sql")).toContain("-- runbook-test: cleanup");
    expect(blocks.get("verify.sql")).toContain("-- runbook-test: verify");
    // The command lines that run them are the ones of the document, with the real database and no other flag than the usual ones.
    for (const name of ["precheck", "cleanup", "verify"]) {
      expect(runbook).toContain(`pnpm exec wrangler d1 execute sakem-staging --env staging --remote --file /private/tmp/sakem-e2e/${name}.sql`);
    }
    expect(statements(blocks.get("cleanup.sql")!)).toHaveLength(4);
  });

  test("the precheck counts the applicant's LIVE files (it says so before a purge, 0 after), and counts nobody else's", async () => {
    const batch = await openBatch();
    const target = await applicant(batch, "uji");
    await applicant(batch, "lain");
    expect(await run("precheck.sql", target.person.email)).toEqual([{ live_files: 2 }]);
    // what the admin's purge leaves behind when the bucket refused: the rows marked, none live
    await env.DB.prepare("UPDATE application_files SET deleted_at = ? WHERE application_id = ? AND deleted_at IS NULL").bind(Date.now(), target.application.id).run();
    expect(await run("precheck.sql", target.person.email)).toEqual([{ live_files: 0 }]);
    // an address that does not exist has none
    expect(await run("precheck.sql", "nobody@example.invalid")).toEqual([{ live_files: 0 }]);
  });

  test("a submitted applicant: the files rows, the application, the account, its sessions and the counter's share go; every other student's rows, files and bytes stay", async () => {
    const batch = await openBatch();
    const target = await applicant(batch, "uji");
    const other = await applicant(batch, "lain");
    const drafting = await drafter(batch, "draf");
    // the admin's purge went first (item 10): the live files are marked
    await env.DB.prepare("UPDATE application_files SET deleted_at = ? WHERE application_id = ? AND deleted_at IS NULL").bind(Date.now(), target.application.id).run();
    // the audit row of an open stays: ids only, and its actor is not a foreign key of anything
    await env.DB.prepare("INSERT INTO audit_log (id, actor_email, action, resource_type, resource_id, metadata, created_at) VALUES (?, ?, 'application_file.view', 'application_file', ?, '{}', ?)")
      .bind(crypto.randomUUID(), "admin@example.test", target.live[0]!.id, Date.now())
      .run();
    expect(await count("SELECT count(*) AS n FROM session WHERE user_id = ?", target.person.id)).toBeGreaterThan(0);

    await run("cleanup.sql", target.person.email);

    expect(await count("SELECT count(*) AS n FROM users WHERE email = ?", target.person.email)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM session WHERE user_id = ?", target.person.id)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM account WHERE user_id = ?", target.person.id)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM student_applications WHERE id = ?", target.application.id)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM application_files WHERE application_id = ?", target.application.id)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM audit_log WHERE action = 'application_file.view'")).toBe(1);

    // the others are as they were
    expect(await count("SELECT count(*) AS n FROM users WHERE id IN (?, ?)", other.person.id, drafting.person.id)).toBe(2);
    expect(await count("SELECT count(*) AS n FROM student_applications WHERE id = ?", other.application.id)).toBe(1);
    expect(await count("SELECT count(*) AS n FROM application_drafts WHERE id = ?", drafting.draftId)).toBe(1);
    expect((await fileRows()).filter((row) => row.application_id === other.application.id)).toHaveLength(3);
    expect((await fileRows()).filter((row) => row.application_id === drafting.draftId)).toHaveLength(1);

    // the counter is the bytes of the LIVE files that remain, not what it was
    const liveRows = (await fileRows()).filter((row) => row.deleted_at === null);
    expect(await storage()).toEqual({ bytes: liveRows.reduce((sum, row) => sum + row.size, 0), files: liveRows.length });
    expect(liveRows).toHaveLength(3); // the other applicant's two and the draft's one
  });

  test("a draft that was never sent: the draft, its files and the account go (the draft goes with the account, the files by the script)", async () => {
    const batch = await openBatch();
    const target = await drafter(batch, "draf");
    const other = await applicant(batch, "lain");
    expect(await run("precheck.sql", target.person.email)).toEqual([{ live_files: 1 }]); // the student's delete button, or the dashboard, comes first
    await env.DB.prepare("UPDATE application_files SET deleted_at = ? WHERE application_id = ?").bind(Date.now(), target.draftId).run();
    expect(await run("precheck.sql", target.person.email)).toEqual([{ live_files: 0 }]);

    await run("cleanup.sql", target.person.email);

    expect(await count("SELECT count(*) AS n FROM users WHERE id = ?", target.person.id)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM application_drafts WHERE id = ?", target.draftId)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM application_files WHERE application_id = ?", target.draftId)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM student_applications WHERE id = ?", other.application.id)).toBe(1);
    expect((await fileRows()).filter((row) => row.application_id === other.application.id && row.deleted_at === null)).toHaveLength(2);
  });

  test("the verification reads zero for the applicant, and it only deletes a STUDENT (an admin with the same address is never touched)", async () => {
    const batch = await openBatch();
    const target = await applicant(batch, "uji");
    await env.DB.prepare("UPDATE application_files SET deleted_at = ? WHERE application_id = ?").bind(Date.now(), target.application.id).run();
    await run("cleanup.sql", target.person.email);
    const [row] = await run("verify.sql", target.person.email);
    expect(row).toMatchObject({ users: 0, applications: 0, files: 0, bytes: 0 });

    // the role is in the statement: an address that belongs to an admin keeps its account
    const admin = await student("pengurus");
    await env.DB.prepare("UPDATE users SET role = 'editor' WHERE id = ?").bind(admin.id).run();
    await run("cleanup.sql", admin.email);
    expect(await count("SELECT count(*) AS n FROM users WHERE id = ?", admin.id)).toBe(1);
  });

  test("run twice, or for an address nobody has, it changes nothing but the recount", async () => {
    const batch = await openBatch();
    const other = await applicant(batch, "lain");
    const before = await storage();
    await run("cleanup.sql", "nobody@example.invalid");
    await run("cleanup.sql", "nobody@example.invalid");
    expect(await storage()).toEqual(before);
    expect(await count("SELECT count(*) AS n FROM student_applications WHERE id = ?", other.application.id)).toBe(1);
  });

  test("the batch is removed by its own statement, which the database refuses while an application or a draft still points at it", async () => {
    expect(runbook).toContain(`DELETE FROM admission_batches WHERE name = '<batch name>'`);
    const batch = await openBatch({ name: "Uji Staging" });
    const target = await applicant(batch, "uji");
    const remove = () => env.DB.prepare("DELETE FROM admission_batches WHERE name = 'Uji Staging'").run();
    await expect(remove()).rejects.toThrow();
    await env.DB.prepare("UPDATE application_files SET deleted_at = ? WHERE application_id = ?").bind(Date.now(), target.application.id).run();
    await run("cleanup.sql", target.person.email);
    await remove();
    expect(await count("SELECT count(*) AS n FROM admission_batches WHERE id = ?", batch.id)).toBe(0);
  });
});
