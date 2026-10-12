import doc from "../../../docs/cloudflare/content-api.md?raw";

// The JSON examples of the contract, read from the document itself, so the
// tests compare the API with what the contract says and not with a copy that
// can drift. If the document changes an example, these tests notice.

function jsonBlocks(): unknown[] {
  return [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]!));
}

function blockWithKey(key: string): any {
  const found = jsonBlocks().find((block) => typeof block === "object" && block !== null && key in block);
  if (!found) throw new Error(`no JSON example with "${key}" in docs/cloudflare/content-api.md`);
  return found;
}

export const EXAMPLES = {
  team: blockWithKey("members"),
  reports: blockWithKey("reports"),
  resources: blockWithKey("resources"),
  announcement: blockWithKey("announcement"),
  blogList: blockWithKey("featured"),
  blogArticle: blockWithKey("article"),
} as const;

function inline(pattern: RegExp, what: string): string {
  const match = doc.match(pattern);
  if (!match?.[1]) throw new Error(`could not find ${what} in docs/cloudflare/content-api.md`);
  return match[1];
}

/** `{ "ok": true, "message": "..." }` of the 201 row. */
export const CONTACT_CREATED: { ok: boolean; message: string } = JSON.parse(inline(/Body `(\{ "ok": true, "message": "[^"]+" \})`/, "the 201 body"));

/** The empty blog: `{ "featured": null, "articles": [], ... }`. */
export const EMPTY_BLOG = JSON.parse(inline(/(\{ "featured": null, "articles": \[\], "page": 1[^`]*\})/, "the empty blog example"));

/** `{ "email": ["Format email belum benar"] }`. */
export const FIELD_ERRORS_EXAMPLE = JSON.parse(inline(/(\{ "email": \["Format email belum benar"\] \})/, "the fieldErrors example"));

/** The rows of the "Caching" table: the endpoint cell and its Cache-Control value. */
export function cacheControlRows(): { endpoints: string; value: string }[] {
  const section = doc.split("\n## Caching\n")[1]?.split("\n## Errors\n")[0] ?? "";
  const rows: { endpoints: string; value: string }[] = [];
  for (const line of section.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    const value = cells[2]?.match(/^`([^`]+)`$/)?.[1];
    if (line.startsWith("|") && value && cells[1] !== "Endpoint" && !line.includes("---")) rows.push({ endpoints: cells[1]!, value });
  }
  return rows;
}

/** Recursively: same keys, and for a non-null example value the same JSON type. A null example value stands for "may be null": any scalar or null is accepted. */
export function sameShape(actual: unknown, example: unknown, path = "$"): string[] {
  const problems: string[] = [];
  if (example === null) {
    if (typeof actual === "object" && actual !== null) problems.push(`${path}: expected null or a scalar`);
    return problems;
  }
  if (Array.isArray(example)) {
    if (!Array.isArray(actual)) return [`${path}: expected an array`];
    if (example.length > 0 && actual.length > 0) {
      for (const [i, item] of actual.entries()) problems.push(...sameShape(item, example[0], `${path}[${i}]`));
    }
    return problems;
  }
  if (typeof example === "object") {
    if (typeof actual !== "object" || actual === null || Array.isArray(actual)) return [`${path}: expected an object`];
    const want = Object.keys(example).sort();
    const have = Object.keys(actual).sort();
    if (JSON.stringify(want) !== JSON.stringify(have)) problems.push(`${path}: keys ${JSON.stringify(have)} differ from the example's ${JSON.stringify(want)}`);
    for (const key of want) if (key in actual) problems.push(...sameShape((actual as Record<string, unknown>)[key], (example as Record<string, unknown>)[key], `${path}.${key}`));
    return problems;
  }
  if (typeof actual !== typeof example) problems.push(`${path}: expected ${typeof example}, got ${typeof actual}`);
  return problems;
}
