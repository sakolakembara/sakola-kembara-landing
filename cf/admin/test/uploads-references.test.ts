import { env } from "cloudflare:workers";
import { getTableName, is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, test } from "vitest";
import * as schema from "../src/db/schema";
import { isReferencedSql, labelsInRow, referencingLabelsSql, uploadReferences } from "../src/uploads/references";

// The registry of columns that can point at an uploaded file
// (src/uploads/references.ts). Deleting an upload is refused while any of them
// references it, so a column that is missing from the registry is a file that
// can be deleted under a live page. This test fails when a table gains a
// column that looks like it holds a file, an image or a link and nobody
// decided what to do about it.

/** Names that hold (or may hold) a path or a URL. The "content_" ones hold HTML or markdown with <img> and links inside. */
const LOOKS_LIKE_A_FILE_OR_LINK = /(^|_)(image|file_?path|photo|picture|attachment|logo|avatar|thumbnail|cover|banner|url)$|^content_(html|markdown)$/;

/** Columns that match the pattern on purpose and cannot hold an upload, each with the reason. */
const NOT_UPLOADS: Record<string, string> = {
  "users.image": "Better Auth's profile picture: an external URL handed over by the sign-in provider, never an upload.",
  "blog_posts.source_url": "The WordPress address an imported article came from. Internal, never a link to an upload.",
};

function allColumns() {
  const tables = Object.values(schema).filter((value) => is(value, SQLiteTable)) as unknown as SQLiteTable[];
  return tables.flatMap((table) => {
    const config = getTableConfig(table);
    return config.columns.map((column) => ({ id: `${getTableName(table)}.${column.name}`, name: column.name }));
  });
}

describe("every column that can hold an upload is in the registry", () => {
  const registered = new Set(uploadReferences.map((reference) => `${getTableName(reference.column.table)}.${reference.column.name}`));

  test("no column that looks like a file, an image or a link is left out", () => {
    const unaccounted = allColumns()
      .filter((column) => LOOKS_LIKE_A_FILE_OR_LINK.test(column.name))
      .map((column) => column.id)
      .filter((id) => !registered.has(id) && !(id in NOT_UPLOADS));
    // To fix a failure: add the column to `uploadReferences` (src/uploads/references.ts), or to
    // NOT_UPLOADS above with the reason it can never point at an upload.
    expect(unaccounted).toEqual([]);
  });

  test("the allowlist has no stale entries and no entry that is also registered", () => {
    const existing = new Set(allColumns().map((column) => column.id));
    for (const id of Object.keys(NOT_UPLOADS)) {
      expect(existing.has(id), `${id} no longer exists`).toBe(true);
      expect(registered.has(id), `${id} is both registered and excluded`).toBe(false);
    }
    for (const id of registered) expect(existing.has(id), `${id} no longer exists`).toBe(true);
  });

  test("the places the admin already has are all there", () => {
    expect([...registered].sort()).toEqual(
      [
        "announcements.cta_url",
        "blog_posts.content_html",
        "blog_posts.content_markdown",
        "blog_posts.image",
        "reports.file_path",
        "shortlinks.target_url",
        "site_resources.external_url",
        "site_resources.file_path",
        "team_members.image",
      ].sort(),
    );
  });
});

describe("the SQL of the reference check", () => {
  const hostile = "/uploads/x'); DROP TABLE media; --%_";

  test("a path is only ever a bound parameter, never part of the statement text", () => {
    for (const sql of [isReferencedSql(hostile), referencingLabelsSql(hostile).sql]) {
      expect(sql.text).not.toContain("DROP");
      expect(sql.text).not.toContain(hostile);
      expect(sql.params).toContain(hostile);
      // One `?` for every parameter.
      expect(sql.text.split("?").length - 1).toBe(sql.params.length);
    }
  });

  test("it is valid SQL on the real schema and finds nothing in an empty database", async () => {
    const referenced = isReferencedSql(hostile);
    const row = await env.DB.prepare(`SELECT ${referenced.text} AS referenced`).bind(...referenced.params).first<{ referenced: number }>();
    expect(row?.referenced).toBe(0);
    const probe = referencingLabelsSql(hostile);
    const found = await env.DB.prepare(probe.sql.text).bind(...probe.sql.params).first<Record<string, unknown>>();
    expect(labelsInRow(probe.labels, found)).toEqual([]);
  });

  test("the labels come back in the row, by position", () => {
    const labels = ["A", "B", "C"];
    expect(labelsInRow(labels, { l0: 0, l1: 1, l2: 1 })).toEqual(["B", "C"]);
    expect(labelsInRow(labels, { l0: 0, l1: 0, l2: 0 })).toEqual([]);
    expect(labelsInRow(labels, null)).toEqual([]);
  });

  test("it stays within D1's limit of 100 bound parameters", () => {
    expect(referencingLabelsSql("/x").sql.params.length).toBeLessThan(100);
    expect(isReferencedSql("/x").params.length + 1).toBeLessThan(100);
  });
});
