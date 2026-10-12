// Which content rows point at an uploaded file, so a delete can refuse while
// one does. The ONE list below is the registry: a column that can hold an
// upload path or URL is listed here, and test/uploads-references.test.ts fails
// when a table gains a column that looks like one and is not listed.
//
// A column references the file when the path appears anywhere in it
// (`instr(column, path) > 0`): a column that holds the path itself, a link
// that points at it (a shortlink to a PDF), an absolute URL on the public
// files domain that merely ends with it, or a blog article's HTML or markdown
// with the path inside an <img> or a link. Matching is plain text: the path is
// a bound parameter, never part of the SQL text, and it is not a LIKE pattern,
// so a `%` or `_` in it matches only itself. A false "referenced" (a path
// quoted in a note) only means a delete is refused, which is the safe side.
//
// Table and column names in the SQL text come from the schema objects below,
// never from a request. Each check scans the table it names (the blog has
// about 80 rows, the others fewer). Deletes are rare, so that is the right
// trade over an index every save would have to maintain.
//
// The statements are plain D1 SQL (text and parameters) because they run in a
// `DB.batch` next to the audit insert, which Drizzle's batch cannot express.

import { getTableName } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import * as schema from "../db/schema";

export interface UploadReference {
  /** What the editor reads when a delete is refused: the menu that holds the reference. */
  label: string;
  column: AnySQLiteColumn;
}

/**
 * Add a line here when a table gets a column that can hold an upload (a new
 * menu with a file or an image, a new place a link can point). Later CRUD
 * does not need to call anything else: see src/uploads/store.ts.
 */
export const uploadReferences: readonly UploadReference[] = [
  { label: "Laporan", column: schema.reports.filePath },
  { label: "Tim", column: schema.teamMembers.image },
  { label: "Pusat Dokumen", column: schema.siteResources.filePath },
  { label: "Pusat Dokumen", column: schema.siteResources.externalUrl },
  { label: "Blog", column: schema.blogPosts.image },
  { label: "Blog", column: schema.blogPosts.contentMarkdown },
  { label: "Blog", column: schema.blogPosts.contentHtml },
  { label: "Pengumuman", column: schema.announcements.ctaUrl },
  { label: "Shortlink", column: schema.shortlinks.targetUrl },
];

export interface Sql {
  text: string;
  /** Bound in order to the `?` of `text`. */
  params: string[];
}

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** `EXISTS (SELECT 1 FROM <table> WHERE instr(<column>, ?) > 0)` for one registered column. */
function existsIn(reference: UploadReference, path: string): Sql {
  const table = quote(getTableName(reference.column.table));
  const column = quote(reference.column.name);
  return { text: `EXISTS (SELECT 1 FROM ${table} WHERE instr(${column}, ?) > 0)`, params: [path] };
}

function join(parts: Sql[], separator: string): Sql {
  return { text: parts.map((part) => part.text).join(separator), params: parts.flatMap((part) => part.params) };
}

/** True when any registered column references `path`. One expression, however many places. */
export function isReferencedSql(path: string): Sql {
  const any = join(
    uploadReferences.map((reference) => existsIn(reference, path)),
    " OR ",
  );
  return { text: `(${any.text})`, params: any.params };
}

/**
 * For the refusal message: ONE row with a 0/1 column `l<n>` per distinct menu label, `labels[n]` naming it.
 * (One row of EXISTS, not a UNION of one SELECT per menu: D1 allows only a handful of terms in a compound SELECT.)
 */
export function referencingLabelsSql(path: string): { sql: Sql; labels: string[] } {
  const labels = [...new Set(uploadReferences.map((reference) => reference.label))];
  const columns = labels.map((label, index) => {
    const found = join(
      uploadReferences.filter((reference) => reference.label === label).map((reference) => existsIn(reference, path)),
      " OR ",
    );
    return { text: `(${found.text}) AS l${index}`, params: found.params };
  });
  const select = join(columns, ", ");
  return { sql: { text: `SELECT ${select.text}`, params: select.params }, labels };
}

/** The labels whose column is 1 in the row the statement above returned. */
export function labelsInRow(labels: readonly string[], row: Record<string, unknown> | null): string[] {
  return row ? labels.filter((_, index) => row[`l${index}`] === 1) : [];
}
